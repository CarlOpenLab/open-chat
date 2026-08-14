/**
 * Agent-style web search via OpenAI function calling.
 *
 * When the client declares a `web_search` tool in the request `tools` array
 * and the gateway has a search provider configured, the chat route hands the
 * request to `runSearchAgentLoop` instead of piping the upstream stream
 * straight through.
 *
 * The loop:
 *  1. Augments the system message with a short web-search instruction.
 *  2. Streams the upstream response to the client, forwarding text/reasoning
 *     deltas verbatim while accumulating any `tool_calls` deltas.
 *  3. When the model finishes with tool calls, it runs the search, emits a
 *     custom `event: web_search` SSE frame (so the UI can render `Sources`),
 *     appends the assistant tool-call message + a `tool` result message, and
 *     re-requests. Otherwise the stream is done.
 *
 * Only the `chat/completions` API is supported (the `responses` stream
 * normaliser does not forward tool-call deltas); requests targeting other APIs
 * fall back to a normal passthrough.
 */
import type { Request, Response } from "express";
import type { ChatCompletionRequest } from "./provider";
import type { SearchProvider, WebSearchResult } from "./search";

/** Max search rounds per request to guard against runaway loops. */
const MAX_SEARCH_ROUNDS = 5;

const FINAL_ANSWER_SYSTEM_INSTRUCTION =
  "联网搜索轮次已经结束。请根据已有工具结果直接回答用户，不要再调用任何工具，也不要返回空内容。";
const EMPTY_FINAL_ANSWER = "联网搜索已完成，但模型未生成最终回答，请重试。";

const WEB_SEARCH_SYSTEM_INSTRUCTION = [
  "你拥有 `web_search` 工具，可以检索最新网络信息。",
  "当用户问题涉及实时信息、最新事件或你训练数据之外的事实时，请调用该工具；无需联网时不要调用。",
  "引用检索到的具体事实时，请在句末标注来源编号（如 [1]、[2]），编号对应工具返回结果的顺序。",
].join("");

interface AccumulatedToolCall {
  index: number;
  id: string;
  function: { name: string; arguments: string };
}

/**
 * Run the agent search loop, streaming the final answer to `res`.
 * Throws on unrecoverable upstream errors (caller is responsible for sending
 * an error response when the stream has not yet started).
 *
 * `streamRequest` performs the upstream chat/completions call and returns its
 * SSE body stream; the caller supplies it so the loop stays independent of
 * how requests are forwarded (in production it wraps the proxy's
 * `forwardChatRequest`).
 */
export async function runSearchAgentLoop(
  req: Request,
  res: Response,
  streamRequest: (body: ChatCompletionRequest) => Promise<ReadableStream<Uint8Array>>,
  body: ChatCompletionRequest,
  searchProvider: SearchProvider,
): Promise<void> {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  let clientClosed = false;
  const onClose = (): void => {
    clientClosed = true;
  };
  // Listen on the *response* close, not the request close. With `express.json`
  // the request body is fully consumed during middleware, so the `req` 'close'
  // event (which signals "request fully received") fires almost immediately
  // after the handler starts -- long before any client disconnect. Treating
  // that as a disconnect would discard every chunk. `res` 'close' only fires
  // when the client actually goes away mid-stream (or after we end normally,
  // by which point we are already done), so it is the correct signal here.
  res.on("close", onClose);

  const write = (chunk: string): void => {
    if (!clientClosed) {
      try {
        res.write(chunk);
      } catch {
        clientClosed = true;
      }
    }
  };
  const sendRawData = (dataText: string): void => write(`data: ${dataText}\n\n`);
  const sendEvent = (event: string, payload: unknown): void =>
    write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);

  const messages = withSearchSystemInstruction(body.messages);

  const streamModel = async (
    requestBody: ChatCompletionRequest,
  ): Promise<{ toolCalls: AccumulatedToolCall[]; hasText: boolean }> => {
    const upstream = await streamRequest(requestBody);
    const toolCalls: AccumulatedToolCall[] = [];
    let hasText = false;

    for await (const dataText of iterSseData(upstream)) {
      if (clientClosed) break;
      if (dataText === "[DONE]") continue;

      let parsed: unknown;
      try {
        parsed = JSON.parse(dataText);
      } catch {
        continue;
      }

      const choice = firstChoice(parsed);
      const delta = choice?.delta;
      const chunkHasText =
        (typeof delta?.content === "string" && delta.content.length > 0) ||
        (typeof delta?.reasoning_content === "string" && delta.reasoning_content.length > 0);

      if (Array.isArray(delta?.tool_calls)) {
        mergeToolCallDeltas(toolCalls, delta.tool_calls);
      }

      if (chunkHasText) {
        hasText = true;
        sendRawData(dataText);
      }
    }

    return { toolCalls, hasText };
  };

  const streamFinalAnswer = async (): Promise<void> => {
    const finalBody: ChatCompletionRequest = {
      ...body,
      messages: withFinalAnswerInstruction(messages),
      stream: true,
    };
    delete finalBody.tools;
    delete finalBody.tool_choice;

    const { hasText } = await streamModel(finalBody);
    if (clientClosed) return;

    if (!hasText) {
      sendRawData(
        JSON.stringify({
          choices: [
            {
              index: 0,
              delta: { role: "assistant", content: EMPTY_FINAL_ANSWER },
              finish_reason: "stop",
            },
          ],
        }),
      );
    }
    write("data: [DONE]\n\n");
  };

  try {
    for (let round = 0; round < MAX_SEARCH_ROUNDS; round++) {
      if (clientClosed) break;

      const reqBody: ChatCompletionRequest = {
        ...body,
        messages,
        stream: true,
      };
      const { toolCalls, hasText } = await streamModel(reqBody);

      if (clientClosed) break;

      if (toolCalls.length === 0) {
        if (hasText) write("data: [DONE]\n\n");
        else await streamFinalAnswer();
        return;
      }

      // Append the assistant tool-call message, then resolve each call.
      messages.push({
        role: "assistant",
        content: "",
        tool_calls: toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: { name: tc.function.name, arguments: tc.function.arguments },
        })),
      });

      for (const tc of toolCalls) {
        if (tc.function.name !== "web_search") {
          messages.push({ role: "tool", tool_call_id: tc.id, content: "Unknown tool" });
          continue;
        }

        const query = parseQueryArg(tc.function.arguments);
        if (!query) {
          messages.push({ role: "tool", tool_call_id: tc.id, content: "Error: missing query" });
          continue;
        }

        try {
          const { results } = await searchProvider.search(query);
          // Surface results to the UI for the Sources component.
          sendEvent("web_search", { query, results });
          messages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: formatToolResults(results),
          });
        } catch (err) {
          console.error("web_search tool execution failed:", err);
          messages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: "Search failed. Answer without web information if possible.",
          });
        }
      }
    }

    // Give the model one final tool-free pass after the search limit so it can
    // synthesize the accumulated results instead of ending with an empty reply.
    if (!clientClosed) await streamFinalAnswer();
  } catch (err) {
    console.error("Search agent loop error:", err);
    if (!clientClosed) {
      write(
        `data: ${JSON.stringify({
          error: { message: err instanceof Error ? err.message : "agent loop failed" },
        })}\n\n`,
      );
      write("data: [DONE]\n\n");
    }
  } finally {
    res.off("close", onClose);
    try {
      res.end();
    } catch {
      // response already ended
    }
  }
}

/** Ensure a system message carries the web-search instruction. */
function withSearchSystemInstruction(messages: unknown[]): unknown[] {
  const next = [...messages];
  const first = next[0];
  if (isRecord(first) && first.role === "system" && typeof first.content === "string") {
    next[0] = { ...first, content: `${first.content}\n\n${WEB_SEARCH_SYSTEM_INSTRUCTION}` };
  } else {
    next.unshift({ role: "system", content: WEB_SEARCH_SYSTEM_INSTRUCTION });
  }
  return next;
}

function withFinalAnswerInstruction(messages: unknown[]): unknown[] {
  const next = [...messages];
  const first = next[0];
  if (isRecord(first) && first.role === "system" && typeof first.content === "string") {
    next[0] = { ...first, content: `${first.content}\n\n${FINAL_ANSWER_SYSTEM_INSTRUCTION}` };
  } else {
    next.unshift({ role: "system", content: FINAL_ANSWER_SYSTEM_INSTRUCTION });
  }
  return next;
}

/** Yield the `data:` payload of every SSE frame in an upstream stream. */
async function* iterSseData(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<string, void, unknown> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      let idx: number;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const data = extractData(frame);
        if (data !== null) yield data;
      }
    }
    buffer += decoder.decode();
    const data = extractData(buffer);
    if (data !== null) yield data;
  } finally {
    try {
      await reader.cancel();
    } catch {
      // stream already closed
    }
  }
}

function extractData(frame: string): string | null {
  const dataLines = frame
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).replace(/^ /, ""));
  if (dataLines.length === 0) return null;
  return dataLines.join("\n");
}

function firstChoice(parsed: unknown): { delta?: Record<string, unknown> } | undefined {
  if (!isRecord(parsed)) return undefined;
  const choices = parsed.choices;
  if (!Array.isArray(choices) || choices.length === 0) return undefined;
  return isRecord(choices[0]) ? (choices[0] as { delta?: Record<string, unknown> }) : undefined;
}

function mergeToolCallDeltas(acc: AccumulatedToolCall[], deltas: unknown[]): void {
  for (const raw of deltas) {
    if (!isRecord(raw)) continue;
    const index = typeof raw.index === "number" ? raw.index : acc.length;
    let existing = acc.find((c) => c.index === index);
    if (!existing) {
      existing = { index, id: "", function: { name: "", arguments: "" } };
      acc.push(existing);
    }
    if (typeof raw.id === "string") existing.id = raw.id;
    const fn = raw.function;
    if (isRecord(fn)) {
      if (typeof fn.name === "string" && fn.name) existing.function.name = fn.name;
      if (typeof fn.arguments === "string") existing.function.arguments += fn.arguments;
    }
  }
}

function parseQueryArg(args: string): string {
  if (!args) return "";
  try {
    const parsed = JSON.parse(args) as { query?: unknown };
    return typeof parsed.query === "string" ? parsed.query.trim() : "";
  } catch {
    return "";
  }
}

function formatToolResults(results: WebSearchResult[]): string {
  if (results.length === 0) return "No results found.";
  return results
    .map((result, i) => {
      const num = i + 1;
      return [`[${num}] ${result.title || result.url}`, `URL: ${result.url}`, result.content].join(
        "\n",
      );
    })
    .join("\n\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

import type { ProviderApi, ProviderConfig } from "./config";
import { GatewayError } from "./error";

export interface ChatCompletionRequest {
  model?: string;
  messages: unknown[];
  stream?: boolean;
  [key: string]: unknown;
}

export interface ChatProvider {
  readonly name: string;
  readonly api: ProviderApi;
  chat(request: ChatCompletionRequest, model: string): Promise<unknown>;
  chatStream(request: ChatCompletionRequest, model: string): Promise<ReadableStream<Uint8Array>>;
}

const CHAT_COMPLETIONS_PATH: ProviderApi = "chat/completions";
const RESPONSES_PATH: ProviderApi = "responses";

export function providerApiUrl(baseUrl: string, api: ProviderApi): string {
  return `${baseUrl.replace(/\/+$/, "")}/${api}`;
}

export function chatCompletionsUrl(baseUrl: string): string {
  return providerApiUrl(baseUrl, CHAT_COMPLETIONS_PATH);
}

export function responsesUrl(baseUrl: string): string {
  return providerApiUrl(baseUrl, RESPONSES_PATH);
}

export function createProvider(config: ProviderConfig): ChatProvider {
  const args = [config.name, config.baseUrl, config.apiKey] as const;
  return config.api === RESPONSES_PATH
    ? new OpenAiResponsesProvider(...args)
    : new OpenAiChatCompletionsProvider(...args);
}

abstract class OpenAiCompatibleProvider implements ChatProvider {
  abstract readonly api: ProviderApi;

  readonly name: string;
  readonly baseUrl: string;
  readonly apiKey: string;

  constructor(name: string, baseUrl: string, apiKey: string) {
    this.name = name;
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
  }

  protected abstract buildBody(
    request: ChatCompletionRequest,
    model: string,
    stream: boolean,
  ): Record<string, unknown>;

  protected normalizeResponse(response: unknown, _model: string): unknown {
    return response;
  }

  protected normalizeStream(
    stream: ReadableStream<Uint8Array>,
    _model: string,
  ): ReadableStream<Uint8Array> {
    return stream;
  }

  async chat(request: ChatCompletionRequest, model: string): Promise<unknown> {
    const response = await this.request(request, model, false);
    const text = await response.text();

    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch (err) {
      throw GatewayError.upstream(
        `Invalid ${this.name} ${this.api} response JSON: ${(err as Error).message}`,
      );
    }

    return this.normalizeResponse(data, model);
  }

  async chatStream(
    request: ChatCompletionRequest,
    model: string,
  ): Promise<ReadableStream<Uint8Array>> {
    const response = await this.request(request, model, true);
    if (!response.body) {
      throw GatewayError.upstream(`No response body from ${this.name} ${this.api} stream`);
    }
    return this.normalizeStream(response.body, model);
  }

  private async request(
    request: ChatCompletionRequest,
    model: string,
    stream: boolean,
  ): Promise<Response> {
    const response = await fetch(providerApiUrl(this.baseUrl, this.api), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
        ...(stream ? { Accept: "text/event-stream" } : {}),
      },
      body: JSON.stringify(this.buildBody(request, model, stream)),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw GatewayError.upstream(
        `${this.name} ${this.api} request failed with status ${response.status}: ${text}`,
      );
    }

    return response;
  }
}

export class OpenAiChatCompletionsProvider extends OpenAiCompatibleProvider {
  readonly api = CHAT_COMPLETIONS_PATH;

  protected buildBody(
    request: ChatCompletionRequest,
    model: string,
    stream: boolean,
  ): Record<string, unknown> {
    const {
      model: _model,
      messages: _messages,
      stream: _stream,
      provider: _provider,
      ...extra
    } = request;
    return {
      ...extra,
      model,
      messages: request.messages,
      stream,
    };
  }
}

export class OpenAiResponsesProvider extends OpenAiCompatibleProvider {
  readonly api = RESPONSES_PATH;

  protected buildBody(
    request: ChatCompletionRequest,
    model: string,
    stream: boolean,
  ): Record<string, unknown> {
    const {
      model: _model,
      messages: _messages,
      stream: _stream,
      provider: _provider,
      max_completion_tokens: maxCompletionTokens,
      reasoning_effort: reasoningEffort,
      response_format: responseFormat,
      stream_options: _streamOptions,
      logit_bias: _logitBias,
      logprobs: _logprobs,
      modalities: _modalities,
      n: _n,
      prediction: _prediction,
      stop: _stop,
      web_search_options: _webSearchOptions,
      enable_thinking: _enableThinking,
      thinking: _thinking,
      ...responsesFields
    } = request;

    const body: Record<string, unknown> = {
      ...responsesFields,
      model,
      input: responsesFields.input ?? request.messages,
      stream,
    };

    if (body.max_output_tokens === undefined && typeof maxCompletionTokens === "number") {
      body.max_output_tokens = maxCompletionTokens;
    }
    if (body.reasoning === undefined && typeof reasoningEffort === "string") {
      body.reasoning = { effort: reasoningEffort };
    }
    if (body.text === undefined && responseFormat !== undefined) {
      const text = responsesTextConfig(responseFormat);
      if (text) body.text = text;
    }
    if (Array.isArray(body.tools)) body.tools = responsesTools(body.tools);
    if (body.tool_choice !== undefined) body.tool_choice = responsesToolChoice(body.tool_choice);

    return body;
  }

  protected normalizeResponse(response: unknown, model: string): unknown {
    if (!isRecord(response)) {
      throw GatewayError.upstream(`Invalid ${this.name} responses payload`);
    }
    if (Array.isArray(response.choices)) return response;
    if (isRecord(response.error)) {
      throw GatewayError.upstream(responseErrorMessage(response.error));
    }

    const status = typeof response.status === "string" ? response.status : "completed";
    const outputText = extractResponseOutputText(response);
    const reasoningContent = extractResponseReasoningText(response);

    return {
      id: stringValue(response.id) ?? `resp-${Date.now()}`,
      object: "chat.completion",
      created: numberValue(response.created_at) ?? Math.floor(Date.now() / 1000),
      model: stringValue(response.model) ?? model,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: outputText,
            reasoning_content: reasoningContent || null,
            refusal: extractResponseRefusal(response),
            annotations: [],
          },
          logprobs: null,
          finish_reason: responsesFinishReason(status, response),
        },
      ],
      usage: normalizeResponsesUsage(response.usage),
    };
  }

  protected normalizeStream(
    stream: ReadableStream<Uint8Array>,
    model: string,
  ): ReadableStream<Uint8Array> {
    return responsesStreamToChatCompletions(stream, model);
  }
}

function responsesTextConfig(responseFormat: unknown): Record<string, unknown> | undefined {
  if (responseFormat === "text") return { format: { type: "text" } };
  if (!isRecord(responseFormat)) return undefined;

  if (responseFormat.type === "json_object") {
    return { format: { type: "json_object" } };
  }
  if (responseFormat.type === "json_schema" && isRecord(responseFormat.json_schema)) {
    return {
      format: {
        type: "json_schema",
        ...responseFormat.json_schema,
      },
    };
  }
  return undefined;
}

function responsesTools(tools: unknown[]): unknown[] {
  return tools.map((tool) => {
    if (!isRecord(tool) || tool.type !== "function" || !isRecord(tool.function)) return tool;
    return {
      type: "function",
      ...tool.function,
    };
  });
}

function responsesToolChoice(toolChoice: unknown): unknown {
  if (
    isRecord(toolChoice) &&
    toolChoice.type === "function" &&
    isRecord(toolChoice.function) &&
    typeof toolChoice.function.name === "string"
  ) {
    return { type: "function", name: toolChoice.function.name };
  }
  return toolChoice;
}

function normalizeResponsesUsage(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  const inputTokens = numberValue(value.input_tokens) ?? 0;
  const outputTokens = numberValue(value.output_tokens) ?? 0;
  return {
    prompt_tokens: inputTokens,
    completion_tokens: outputTokens,
    total_tokens: numberValue(value.total_tokens) ?? inputTokens + outputTokens,
    prompt_tokens_details: value.input_tokens_details ?? {},
    completion_tokens_details: value.output_tokens_details ?? {},
  };
}

function extractResponseOutputText(response: Record<string, unknown>): string {
  if (typeof response.output_text === "string") return response.output_text;
  return extractResponseContent(response, new Set(["output_text", "text"]));
}

function extractResponseReasoningText(response: Record<string, unknown>): string {
  const parts: string[] = [];
  const output = Array.isArray(response.output) ? response.output : [];
  for (const item of output) {
    if (!isRecord(item) || item.type !== "reasoning") continue;
    const summary = Array.isArray(item.summary) ? item.summary : [];
    for (const part of summary) {
      if (isRecord(part) && typeof part.text === "string") parts.push(part.text);
    }
  }
  return parts.join("\n");
}

function extractResponseRefusal(response: Record<string, unknown>): string | null {
  const text = extractResponseContent(response, new Set(["refusal"]));
  return text || null;
}

function extractResponseContent(
  response: Record<string, unknown>,
  acceptedTypes: ReadonlySet<string>,
): string {
  const parts: string[] = [];
  const output = Array.isArray(response.output) ? response.output : [];
  for (const item of output) {
    if (!isRecord(item)) continue;
    const content = Array.isArray(item.content) ? item.content : [];
    for (const part of content) {
      if (!isRecord(part) || !acceptedTypes.has(String(part.type))) continue;
      const text = typeof part.text === "string" ? part.text : part.refusal;
      if (typeof text === "string") parts.push(text);
    }
  }
  return parts.join("");
}

function responsesFinishReason(status: string, response: Record<string, unknown>): string {
  if (status === "incomplete") {
    const details = isRecord(response.incomplete_details) ? response.incomplete_details : undefined;
    return details?.reason === "max_output_tokens" ? "length" : "stop";
  }
  if (status === "failed") return "stop";
  return "stop";
}

function responseErrorMessage(error: Record<string, unknown>): string {
  return stringValue(error.message) ?? stringValue(error.code) ?? "Responses API request failed";
}

function responsesStreamToChatCompletions(
  upstream: ReadableStream<Uint8Array>,
  routeModel: string,
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  let responseId = `resp-${Date.now()}`;
  let responseModel = routeModel;
  let created = Math.floor(Date.now() / 1000);
  let sentDone = false;

  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      drainSseFrames(false, controller);
    },
    flush(controller) {
      buffer += decoder.decode();
      drainSseFrames(true, controller);
      emitDone(controller);
    },
  });

  function drainSseFrames(
    flush: boolean,
    controller: TransformStreamDefaultController<Uint8Array>,
  ): void {
    while (true) {
      const match = buffer.match(/\r?\n\r?\n/);
      if (!match || match.index === undefined) break;
      const frame = buffer.slice(0, match.index);
      buffer = buffer.slice(match.index + match[0].length);
      processSseFrame(frame, controller);
    }
    if (flush && buffer.trim()) {
      processSseFrame(buffer, controller);
      buffer = "";
    }
  }

  function processSseFrame(
    frame: string,
    controller: TransformStreamDefaultController<Uint8Array>,
  ): void {
    const lines = frame.split(/\r?\n/);
    const eventName = lines
      .find((line) => line.startsWith("event:"))
      ?.slice("event:".length)
      .trim();
    const dataText = lines
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trimStart())
      .join("\n");

    if (!dataText) return;
    if (dataText === "[DONE]") {
      emitDone(controller);
      return;
    }

    let event: Record<string, unknown>;
    try {
      const parsed = JSON.parse(dataText) as unknown;
      if (!isRecord(parsed)) return;
      event = parsed;
    } catch {
      return;
    }

    const type = stringValue(event.type) ?? eventName ?? "";
    const response = isRecord(event.response) ? event.response : undefined;
    if (response) {
      responseId = stringValue(response.id) ?? responseId;
      responseModel = stringValue(response.model) ?? responseModel;
      created = numberValue(response.created_at) ?? created;
    }

    if (type === "response.created" || type === "response.in_progress") return;

    if (type === "response.output_text.delta") {
      const delta = stringValue(event.delta);
      if (delta) emitChunk(controller, { content: delta }, null);
      return;
    }

    if (
      type === "response.reasoning_summary_text.delta" ||
      type === "response.reasoning_text.delta"
    ) {
      const delta = stringValue(event.delta);
      if (delta) emitChunk(controller, { reasoning_content: delta }, null);
      return;
    }

    if (type === "response.completed" || type === "response.incomplete") {
      const status = response ? (stringValue(response.status) ?? "completed") : "completed";
      emitChunk(
        controller,
        {},
        response ? responsesFinishReason(status, response) : "stop",
        response ? normalizeResponsesUsage(response.usage) : undefined,
      );
      emitDone(controller);
      return;
    }

    if (type === "response.failed" || type === "error") {
      const error = isRecord(event.error)
        ? event.error
        : response && isRecord(response.error)
          ? response.error
          : undefined;
      emit(controller, {
        error: {
          message: error ? responseErrorMessage(error) : "Responses API stream failed",
          type: "upstream_error",
          code: "provider_error",
        },
      });
      emitDone(controller);
    }
  }

  function emitChunk(
    controller: TransformStreamDefaultController<Uint8Array>,
    delta: Record<string, unknown>,
    finishReason: string | null,
    usage?: Record<string, unknown>,
  ): void {
    emit(controller, {
      id: responseId,
      object: "chat.completion.chunk",
      created,
      model: responseModel,
      choices: [{ index: 0, delta: { role: "assistant", ...delta }, finish_reason: finishReason }],
      ...(usage ? { usage } : {}),
    });
  }

  function emit(
    controller: TransformStreamDefaultController<Uint8Array>,
    data: Record<string, unknown>,
  ): void {
    if (sentDone) return;
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
  }

  function emitDone(controller: TransformStreamDefaultController<Uint8Array>): void {
    if (sentDone) return;
    sentDone = true;
    controller.enqueue(encoder.encode("data: [DONE]\n\n"));
  }

  return upstream.pipeThrough(transform);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

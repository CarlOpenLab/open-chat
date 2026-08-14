import { EventEmitter } from "node:events";
import type { Request, Response } from "express";
import { expect, test } from "vite-plus/test";
import type { ChatCompletionRequest } from "./provider";
import { runSearchAgentLoop } from "./search-agent";
import type { SearchProvider } from "./search";

const encoder = new TextEncoder();

const sseStream = (payloads: string[]) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      payloads.forEach((payload) => controller.enqueue(encoder.encode(`data: ${payload}\n\n`)));
      controller.close();
    },
  });

const toolCallPayload = (index: number) =>
  JSON.stringify({
    choices: [
      {
        delta: {
          tool_calls: [
            {
              index: 0,
              id: `call-${index}`,
              function: {
                name: "web_search",
                arguments: JSON.stringify({ query: `query ${index}` }),
              },
            },
          ],
        },
      },
    ],
  });

const answerPayload = (content: string) =>
  JSON.stringify({
    choices: [{ index: 0, delta: { role: "assistant", content }, finish_reason: null }],
  });

class TestResponse extends EventEmitter {
  output = "";
  ended = false;

  setHeader(): this {
    return this;
  }

  flushHeaders(): void {}

  write(chunk: string): boolean {
    this.output += chunk;
    return true;
  }

  end(): this {
    this.ended = true;
    return this;
  }
}

const requestBody: ChatCompletionRequest = {
  model: "test-model",
  messages: [{ role: "user", content: "latest weather" }],
  stream: true,
  tools: [{ type: "function", function: { name: "web_search" } }],
  tool_choice: "auto",
};

const searchProvider: SearchProvider = {
  name: "test-search",
  async search(query) {
    return {
      results: [{ title: query, url: `https://example.com/${query}`, content: "result" }],
    };
  },
};

const runWithStreamRequest = async (
  streamRequest: (body: ChatCompletionRequest) => Promise<ReadableStream<Uint8Array>>,
) => {
  const response = new TestResponse();

  await runSearchAgentLoop(
    {} as Request,
    response as unknown as Response,
    streamRequest,
    requestBody,
    searchProvider,
  );

  return response;
};

test("forces a tool-free final answer after repeated searches and an empty model pass", async () => {
  const requests: ChatCompletionRequest[] = [];
  const streamRequest: (body: ChatCompletionRequest) => Promise<ReadableStream<Uint8Array>> = (
    request,
  ) => {
    requests.push(structuredClone(request));
    const requestNumber = requests.length;
    if (requestNumber <= 4)
      return Promise.resolve(sseStream([toolCallPayload(requestNumber), "[DONE]"]));
    if (requestNumber === 5) return Promise.resolve(sseStream(["[DONE]"]));
    return Promise.resolve(sseStream([answerPayload("final answer"), "[DONE]"]));
  };

  const response = await runWithStreamRequest(streamRequest);

  expect(requests).toHaveLength(6);
  expect(requests[5]?.tools).toBeUndefined();
  expect(requests[5]?.tool_choice).toBeUndefined();
  expect(response.output.match(/event: web_search/g)).toHaveLength(4);
  expect(response.output).toContain('"content":"final answer"');
  expect(response.output.endsWith("data: [DONE]\n\n")).toBe(true);
  expect(response.ended).toBe(true);
});

test("forces a tool-free answer after reaching the search round limit", async () => {
  const requests: ChatCompletionRequest[] = [];
  const streamRequest: (body: ChatCompletionRequest) => Promise<ReadableStream<Uint8Array>> = (
    request,
  ) => {
    requests.push(structuredClone(request));
    const requestNumber = requests.length;
    if (requestNumber <= 5)
      return Promise.resolve(sseStream([toolCallPayload(requestNumber), "[DONE]"]));
    return Promise.resolve(sseStream([answerPayload("answer after limit"), "[DONE]"]));
  };

  const response = await runWithStreamRequest(streamRequest);

  expect(requests).toHaveLength(6);
  expect(requests[5]?.tools).toBeUndefined();
  expect(response.output.match(/event: web_search/g)).toHaveLength(5);
  expect(response.output).toContain('"content":"answer after limit"');
  expect(response.output.endsWith("data: [DONE]\n\n")).toBe(true);
});

test("emits visible fallback text when the forced final response is also empty", async () => {
  const requests: ChatCompletionRequest[] = [];
  const streamRequest: (body: ChatCompletionRequest) => Promise<ReadableStream<Uint8Array>> = (
    request,
  ) => {
    requests.push(structuredClone(request));
    return Promise.resolve(sseStream(["[DONE]"]));
  };

  const response = await runWithStreamRequest(streamRequest);

  expect(requests).toHaveLength(2);
  expect(requests[1]?.tools).toBeUndefined();
  expect(response.output).toContain("联网搜索已完成，但模型未生成最终回答，请重试。");
  expect(response.output.endsWith("data: [DONE]\n\n")).toBe(true);
});

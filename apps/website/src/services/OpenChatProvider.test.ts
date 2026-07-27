import type { XModelMessage } from "@antdv-next/x-sdk";
import { expect, test } from "vite-plus/test";
import { OpenChatProvider, WEB_SEARCHING_MARKER } from "./OpenChatProvider";

const responseHeaders = new Headers({ "content-type": "text/event-stream" });
const provider = Object.create(OpenChatProvider.prototype) as OpenChatProvider;

const transform = (originMessage: XModelMessage | undefined, chunk: unknown) =>
  provider.transformMessage({
    originMessage,
    chunk,
    chunks: [],
    status: "updating",
    responseHeaders,
  } as Parameters<OpenChatProvider["transformMessage"]>[0]);

test("keeps the search marker for terminal frames without answer text", () => {
  const markerMessage: XModelMessage = {
    content: WEB_SEARCHING_MARKER,
    role: "assistant",
  };

  expect(transform(markerMessage, { data: "[DONE]" })).toEqual(markerMessage);
  expect(transform(markerMessage, undefined)).toEqual(markerMessage);
});

test("replaces the search marker with the first answer chunk", () => {
  const result = transform(
    { content: WEB_SEARCHING_MARKER, role: "assistant" },
    {
      data: JSON.stringify({
        choices: [{ delta: { content: "搜索后的回答", role: "assistant" } }],
      }),
    },
  );

  expect(result.content).toBe("搜索后的回答");
});

test("emits web search sources and displays the search marker", () => {
  let receivedSources: unknown;
  provider.onWebSearchSources = (sources) => {
    receivedSources = sources;
  };

  const result = transform(undefined, {
    event: "web_search",
    data: JSON.stringify({
      results: [
        {
          title: "天气预报",
          url: "https://example.com/weather",
          content: "福州明天有雨。",
        },
      ],
    }),
  });

  expect(result.content).toBe(WEB_SEARCHING_MARKER);
  expect(receivedSources).toEqual([
    {
      key: "0",
      title: "天气预报",
      url: "https://example.com/weather",
      description: "福州明天有雨。",
    },
  ]);
});

test("excludes host-only opening messages from model requests", () => {
  provider.injectGetMessages(() => [
    {
      content: "<a2ui>host-rendered form</a2ui>",
      openChatLocalOnly: true,
      role: "assistant",
    },
    { content: "[表单提交] generate_ticket_branch", role: "user" },
  ]);

  const params = provider.transformParams({ systemPrompt: "ticket branch rules" }, {
    params: {},
  } as Parameters<OpenChatProvider["transformParams"]>[1]);

  expect(params.messages).toEqual([
    { content: "ticket branch rules", role: "system" },
    { content: "[表单提交] generate_ticket_branch", role: "user" },
  ]);
});

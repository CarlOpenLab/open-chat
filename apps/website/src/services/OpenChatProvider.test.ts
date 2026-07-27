import type { XModelMessage } from "@antdv-next/x-sdk";
import { expect, test } from "vite-plus/test";
import {
  A2UI_SYSTEM_PROMPT,
  OpenChatProvider,
  WEB_SEARCHING_MARKER,
  createTicketBranchSystemPrompt,
} from "./OpenChatProvider";

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

test("requires conversation-unique A2UI surface IDs", () => {
  expect(A2UI_SYSTEM_PROMPT).toContain(
    "Every createSurface surfaceId must be unique across the entire conversation",
  );
  expect(A2UI_SYSTEM_PROMPT).toContain("next unused positive integer suffix");
});

test("numbers ticket branch form surfaces and documents replacement IDs", () => {
  const prompt = createTicketBranchSystemPrompt(new Date(2025, 11, 4));

  expect(prompt.match(/"surfaceId":"ticket-branch-form-1"/g)).toHaveLength(4);
  expect(prompt).toContain('"source":"ticket-branch-form-1"');
  expect(prompt).not.toContain('"surfaceId":"ticket-branch-form"');
  expect(prompt).toContain("ticket-branch-form-N");
  expect(prompt).toContain("下一个尚未使用的正整数后缀");
});

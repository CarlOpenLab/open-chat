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

test("emits permission requests and accumulates them on the message", () => {
  let received: unknown;
  provider.onPermissionRequest = (request) => {
    received = request;
  };

  const origin: XModelMessage = { content: "", role: "assistant" };
  const first = transform(origin, {
    event: "chat_permission",
    data: JSON.stringify({
      id: "per_1",
      version: "v1",
      permission: "bash",
      patterns: ["ls /tmp"],
      metadata: {},
    }),
  });
  const second = transform(first, {
    event: "chat_permission",
    data: JSON.stringify({
      id: "per_2",
      version: "v2",
      permission: "edit",
      patterns: ["/Users/**"],
      metadata: {},
    }),
  });

  expect(received).toEqual({
    id: "per_2",
    version: "v2",
    permission: "edit",
    patterns: ["/Users/**"],
    metadata: {},
  });
  expect((second as { pendingPermissions?: unknown[] }).pendingPermissions).toHaveLength(2);
  expect(second.content).toBe("");
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

test("preserves newlines across chunk boundaries after reasoning (regression)", () => {
  const delta = (content = "", reasoning = "") => ({
    data: JSON.stringify({
      choices: [{ delta: { content, reasoning_content: reasoning, role: "assistant" } }],
    }),
  });

  let msg: XModelMessage = { content: "", role: "assistant" };
  // 先流式思考，再分多块输出正文（每块边界带 \n）
  msg = transform(msg, delta("", "先分析现有组件的交互方式。"));
  msg = transform(msg, delta("", "再对照活动折叠模型。"));
  expect(msg.content).toBe("");
  expect((msg as { reasoningContent?: string }).reasoningContent).toBe(
    "先分析现有组件的交互方式。再对照活动折叠模型。",
  );
  expect((msg as { reasoningDone?: boolean }).reasoningDone).toBeUndefined();

  const parts = [
    "我在apps/website相关目录看到了项目情况：\n",
    "- Web应用：apps/website（Vue+Vite+），devserver运行在localhost:3000\n",
    "- Server：apps/server，运行在localhost:8082\n",
    "不过你的消息比较简短，想确认一下你的需求：\n1. Web端出现bug？\n2. 需要改某块功能？",
  ];
  for (const part of parts) {
    msg = transform(msg, delta(part));
  }

  expect(msg.content).toBe(parts.join(""));
  expect((msg as { reasoningDone?: boolean }).reasoningDone).toBe(true);
});

test("preserves exact text for multi-chunk answers without reasoning", () => {
  const delta = (content: string) => ({
    data: JSON.stringify({ choices: [{ delta: { content, role: "assistant" } }] }),
  });

  let msg: XModelMessage = { content: "", role: "assistant" };
  const parts = [
    "我想确认一下你的需",
    "求，比如：\n1. Web端出现",
    "bug/报错？请贴一下控制台。",
    "告诉我具体要做什么。",
  ];
  for (const part of parts) {
    msg = transform(msg, delta(part));
  }

  expect(msg.content).toBe(parts.join(""));
});

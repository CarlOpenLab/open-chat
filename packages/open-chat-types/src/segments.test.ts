/// <reference types="vite-plus/test/globals" />

import {
  applyMessageDelta,
  mergeContentMessages,
  mergeReasoningMessages,
  messagesToOpenAIFormat,
  summarizeMessages,
} from "./segments";
import type { TranscriptMessage } from "./types";

const T = 1_710_000_000_000;

function msg(
  role: TranscriptMessage["role"],
  overrides: Record<string, unknown> = {},
): TranscriptMessage {
  return { id: "x", timestamp: T, role, ...overrides } as TranscriptMessage;
}

describe("mergeContentMessages", () => {
  it("joins content messages with a blank line and ignores non-content", () => {
    const messages: TranscriptMessage[] = [
      msg("reasoning", { content: "hidden" }),
      msg("content", { id: "c1", content: "First" }),
      msg("tool", { id: "t1", name: "read", status: "completed" }),
      msg("content", { id: "c2", content: "Second" }),
    ];
    expect(mergeContentMessages(messages)).toBe("First\n\nSecond");
  });

  it("returns empty string when there are no content messages", () => {
    expect(mergeContentMessages([msg("tool", { id: "t", name: "x", status: "completed" })])).toBe(
      "",
    );
  });
});

describe("mergeReasoningMessages", () => {
  it("joins reasoning messages", () => {
    const messages: TranscriptMessage[] = [
      msg("reasoning", { id: "r1", content: "a" }),
      msg("content", { id: "c", content: "text" }),
      msg("reasoning", { id: "r2", content: "b" }),
    ];
    expect(mergeReasoningMessages(messages)).toBe("a\n\nb");
  });
});

describe("summarizeMessages", () => {
  it("counts commands, reasoning, plans, and files", () => {
    const messages: TranscriptMessage[] = [
      msg("reasoning", { content: "r" }),
      msg("tool", { id: "t1", name: "bash", status: "completed" }),
      msg("fileChange", { id: "fc1", path: "a.ts", additions: 1 }),
      msg("fileChange", { id: "fc2", path: "b.ts" }),
      msg("plan", { id: "p1", entries: [{ content: "p", status: "pending" }] }),
      msg("workspace", { id: "w1", files: [{ path: "w.ts", status: "complete" }], errors: [] }),
    ];
    expect(summarizeMessages(messages)).toEqual({ commands: 1, reasoning: 1, plans: 1, files: 3 });
  });
});

describe("applyMessageDelta", () => {
  it("merges adjacent content/reasoning deltas", () => {
    let messages: TranscriptMessage[] = [];
    messages = applyMessageDelta(messages, msg("content", { content: "Hel" }));
    messages = applyMessageDelta(messages, msg("content", { content: "lo" }));
    messages = applyMessageDelta(messages, msg("reasoning", { content: "th" }));
    messages = applyMessageDelta(messages, msg("reasoning", { content: "ink" }));
    expect(messages).toEqual([
      { id: "x", timestamp: T, role: "content", content: "Hello" },
      { id: "x", timestamp: T, role: "reasoning", content: "think" },
    ]);
  });

  it("upserts tool by id and keeps order", () => {
    let messages: TranscriptMessage[] = [];
    messages = applyMessageDelta(
      messages,
      msg("tool", { id: "t1", name: "read", status: "running" }),
    );
    messages = applyMessageDelta(
      messages,
      msg("tool", { id: "t1", name: "read", status: "completed", output: "ok" }),
    );
    messages = applyMessageDelta(
      messages,
      msg("tool", { id: "t2", name: "bash", status: "running" }),
    );
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({
      role: "tool",
      id: "t1",
      status: "completed",
      output: "ok",
    });
  });

  it("upserts fileChange by path", () => {
    let messages: TranscriptMessage[] = [];
    messages = applyMessageDelta(messages, msg("fileChange", { id: "fc:a.ts", path: "a.ts" }));
    messages = applyMessageDelta(
      messages,
      msg("fileChange", { id: "fc:a.ts", path: "a.ts", additions: 3 }),
    );
    expect(messages).toEqual([
      { id: "fc:a.ts", timestamp: T, role: "fileChange", path: "a.ts", additions: 3 },
    ]);
  });
});

describe("messagesToOpenAIFormat", () => {
  it("flattens content, reasoning, and tool_calls", () => {
    const messages: TranscriptMessage[] = [
      msg("reasoning", { id: "r", content: "think" }),
      msg("content", { id: "c", content: "answer" }),
      msg("tool", { id: "t1", name: "read", status: "completed", input: { path: "a.ts" } }),
    ];
    const wire = messagesToOpenAIFormat(messages);
    expect(wire.content).toBe("answer");
    expect(wire.reasoning_content).toBe("think");
    expect(wire.tool_calls).toEqual([
      { id: "t1", type: "function", function: { name: "read", arguments: '{"path":"a.ts"}' } },
    ]);
  });
});

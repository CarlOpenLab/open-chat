/// <reference types="vite-plus/test/globals" />

import type { SessionUpdate } from "@agentclientprotocol/sdk";
import { collectAcpHistoryUpdate } from "./transcript/adapters/acp";
import { convertClaudeHistory } from "./transcript/adapters/claude";
import { convertCodexThreadHistory, normalizeCodexActivity } from "./transcript/adapters/codex";
import { convertOpenCodeHistory } from "./transcript/adapters/opencode";
import { convertPiHistory } from "./transcript/adapters/pi";
import { createTranscriptCollector } from "./transcript/core";
import { nativeEventFrame } from "./nativeEvents";

describe("native CLI event stream", () => {
  it("preserves event type and payload without converting to an OpenAI chunk", () => {
    const frame = nativeEventFrame({
      type: "activity.upsert",
      activity: { id: "tool-1", name: "read", status: "running", input: { path: "a.ts" } },
    });
    expect(frame).toBe(
      `event: native_event\ndata: ${JSON.stringify({
        type: "activity.upsert",
        activity: { id: "tool-1", name: "read", status: "running", input: { path: "a.ts" } },
      })}\n\n`,
    );
  });
});

describe("convertCodexThreadHistory", () => {
  it("keeps commentary, reasoning, tools, and the final answer in one ordered turn", () => {
    const history = convertCodexThreadHistory([
      {
        items: [
          { id: "user-1", type: "userMessage", content: [{ type: "text", text: "Fix it" }] },
          { id: "comment-1", type: "agentMessage", phase: "commentary", text: "Checking." },
          { id: "reason-1", type: "reasoning", summary: [{ type: "text", text: "Found it." }] },
          {
            id: "tool-1",
            type: "commandExecution",
            status: "completed",
            command: "vp check",
            aggregatedOutput: "ok",
          },
          { id: "comment-2", type: "agentMessage", phase: "commentary", text: "Verified." },
          { id: "final-1", type: "agentMessage", phase: "final_answer", text: "Fixed." },
        ],
      },
    ]);

    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({ id: "user-1", role: "user", content: "Fix it" });
    expect(history[1]).toMatchObject({
      id: "comment-1:assistant",
      role: "assistant",
      content: "Checking.\n\nVerified.\n\nFixed.",
      reasoningContent: "Found it.",
    });
    expect(history[1]?.toolCalls).toEqual([
      expect.objectContaining({ id: "tool-1", status: "completed", output: "ok" }),
    ]);
  });

  it("keeps unphased agent messages as visible assistant content", () => {
    const history = convertCodexThreadHistory([
      {
        items: [
          { id: "progress", type: "agentMessage", text: "Working." },
          { id: "final", type: "agentMessage", text: "Done." },
        ],
      },
    ]);

    expect(history).toEqual([
      {
        id: "progress:assistant",
        role: "assistant",
        content: "Working.\n\nDone.",
        reasoningContent: undefined,
        timeline: [
          {
            kind: "content",
            id: "content-progress:assistant",
            content: "Working.\n\nDone.",
          },
        ],
      },
    ]);
  });
});

describe("provider transcript adapters", () => {
  it("normalizes Codex file changes into presentation metadata", () => {
    const activity = normalizeCodexActivity(
      {
        id: "patch-1",
        type: "fileChange",
        changes: [
          {
            path: "src/app.ts",
            diff: "@@ -1 +1,2 @@\n-old\n+new\n+more",
          },
        ],
        status: "completed",
      },
      true,
    );

    expect(activity).toMatchObject({
      kind: "fileChange",
      fileChanges: [{ path: "src/app.ts", additions: 2, deletions: 1 }],
    });
  });

  it("merges Claude tool results and final text into one assistant turn", () => {
    const history = convertClaudeHistory([
      { uuid: "user", message: { role: "user", content: "Inspect it" } },
      {
        uuid: "assistant-tool",
        message: {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "I should read it." },
            { type: "tool_use", id: "read-1", name: "read", input: { path: "a.ts" } },
          ],
        },
      },
      {
        uuid: "tool-result",
        message: {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "read-1", content: "source" }],
        },
      },
      {
        uuid: "assistant-final",
        message: { role: "assistant", content: [{ type: "text", text: "Done." }] },
      },
    ]);

    expect(history).toHaveLength(2);
    expect(history[1]).toMatchObject({
      role: "assistant",
      content: "Done.",
      reasoningContent: "I should read it.",
      toolCalls: [{ id: "read-1", name: "read", status: "completed", output: "source" }],
    });
  });

  it("merges Pi tool results and final text into one assistant turn", () => {
    const history = convertPiHistory([
      { type: "message", id: "user", message: { role: "user", content: "Inspect it" } },
      {
        type: "message",
        id: "assistant-tool",
        message: {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "Reading." },
            { type: "toolCall", id: "read-1", name: "read", arguments: { path: "a.ts" } },
          ],
        },
      },
      {
        type: "message",
        message: {
          role: "toolResult",
          toolCallId: "read-1",
          toolName: "read",
          content: [{ type: "text", text: "source" }],
          isError: false,
        },
      },
      {
        type: "message",
        id: "assistant-final",
        message: { role: "assistant", content: [{ type: "text", text: "Done." }] },
      },
    ]);

    expect(history).toHaveLength(2);
    expect(history[1]).toMatchObject({
      role: "assistant",
      content: "Done.",
      reasoningContent: "Reading.",
      toolCalls: [{ id: "read-1", name: "read", status: "completed", output: "source" }],
    });
  });

  it("normalizes OpenCode text, reasoning, and tool state", () => {
    const history = convertOpenCodeHistory([
      { info: { id: "user", role: "user", content: "Inspect it" } },
      {
        info: { id: "assistant", role: "assistant" },
        parts: [
          { type: "reasoning", text: "Reading." },
          {
            type: "tool",
            callID: "read-1",
            tool: "read",
            state: { status: "completed", input: { path: "a.ts" }, output: "source" },
          },
          { type: "text", text: "Done." },
        ],
      },
    ]);

    expect(history).toHaveLength(2);
    expect(history[1]).toMatchObject({
      role: "assistant",
      content: "Done.",
      reasoningContent: "Reading.",
      toolCalls: [{ id: "read-1", name: "read", status: "completed", output: "source" }],
    });
  });

  it("collects ACP chunks and tool updates into the active assistant message", () => {
    const collector = createTranscriptCollector();
    const updates = [
      { sessionUpdate: "user_message_chunk", content: { type: "text", text: "Inspect it" } },
      { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "Reading." } },
      {
        sessionUpdate: "tool_call",
        toolCallId: "read-1",
        title: "read",
        status: "in_progress",
        rawInput: { path: "a.ts" },
      },
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "read-1",
        title: "read",
        status: "completed",
        rawOutput: "source",
      },
      { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Done." } },
    ] as SessionUpdate[];
    for (const update of updates) collectAcpHistoryUpdate(collector, update);

    expect(collector.messages).toHaveLength(2);
    expect(collector.messages[1]).toMatchObject({
      role: "assistant",
      content: "Done.",
      reasoningContent: "Reading.",
      toolCalls: [{ id: "read-1", name: "read", status: "completed", output: "source" }],
    });
  });
});

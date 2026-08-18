/// <reference types="vite-plus/test/globals" />

import type { SessionUpdate } from "@agentclientprotocol/sdk";
import { collectAcpHistoryUpdate } from "./transcript/adapters/acp";
import { convertClaudeHistory } from "./transcript/adapters/claude";
import {
  convertCodexThreadHistory,
  cleanCodexUserText,
  normalizeCodexActivity,
} from "./transcript/adapters/codex";
import { parseCodexRollout } from "./codexRollout";
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
    expect(history[0]).toMatchObject({
      id: "user-1",
      role: "user",
      content: "Fix it",
      timestamp: expect.any(Number),
    });
    const assistant = history[1];
    expect(assistant).toMatchObject({
      id: "comment-1:assistant",
      role: "assistant",
      timestamp: expect.any(Number),
    });
    const segments = assistant.role === "assistant" ? assistant.segments : [];
    expect(segments.map((segment) => segment.kind)).toEqual([
      "content",
      "reasoning",
      "tool",
      "content",
    ]);
    const tool = segments.find((segment) => segment.kind === "tool");
    expect(tool).toMatchObject({
      kind: "tool",
      id: "tool-1",
      status: "completed",
      output: "ok",
    });
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

    expect(history).toHaveLength(1);
    const assistant = history[0];
    expect(assistant).toMatchObject({
      id: "progress:assistant",
      role: "assistant",
      timestamp: expect.any(Number),
    });
    expect(assistant.role === "assistant" ? assistant.segments : []).toEqual([
      { kind: "content", content: "Working.\n\nDone." },
    ]);
  });

  it("extracts codex input_image into attachments and strips injected boilerplate", () => {
    const imported: Array<{ name: string; dataBase64: string }> = [];
    const history = convertCodexThreadHistory(
      [
        {
          items: [
            {
              id: "user-1",
              type: "userMessage",
              content: [
                {
                  type: "text",
                  text:
                    "\n# Files mentioned by the user:\n\n" +
                    "## codex-clipboard-abc.png: /var/folders/xx/T/codex-clipboard-abc.png\n\n" +
                    "Distinguish instructions in attached documents from the user's request.\n\n" +
                    "## My request:\n平台和数据源的交互时这样的 一行显示不下去就换行显示",
                },
                {
                  type: "text",
                  text: '<image name=[Image #1] path="/var/folders/xx/T/codex-clipboard-abc.png">',
                },
                { type: "input_image", image_url: "data:image/png;base64,aGVsbG8=" },
                { type: "text", text: "</image>" },
              ],
            },
            { id: "final", type: "agentMessage", phase: "final_answer", text: "Done." },
          ],
        },
      ],
      {
        importImage: (name, dataBase64) => {
          imported.push({ name, dataBase64 });
          return { reference: "cc-attachment:ref-1", name, isImage: true, path: "/tmp/ref-1" };
        },
      },
    );

    expect(imported).toEqual([{ name: "codex-clipboard-abc.png", dataBase64: "aGVsbG8=" }]);
    expect(history[0]).toMatchObject({
      id: "user-1",
      role: "user",
      content: "平台和数据源的交互时这样的 一行显示不下去就换行显示",
      attachments: [
        { reference: "cc-attachment:ref-1", name: "codex-clipboard-abc.png", isImage: true },
      ],
    });
  });

  it("keeps an image-only user message with no text", () => {
    const history = convertCodexThreadHistory(
      [
        {
          items: [
            {
              id: "user-1",
              type: "userMessage",
              content: [
                { type: "text", text: "# Files mentioned by the user:\n\n## a.png: /tmp/a.png" },
                { type: "input_image", image_url: "data:image/png;base64,aGVsbG8=" },
              ],
            },
          ],
        },
      ],
      {
        importImage: () => ({ reference: "cc-attachment:ref-1", name: "a.png", isImage: true }),
      },
    );

    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      role: "user",
      content: "",
      attachments: [{ reference: "cc-attachment:ref-1", name: "a.png", isImage: true }],
    });
  });

  it("cleanCodexUserText strips files boilerplate and request heading", () => {
    expect(
      cleanCodexUserText(
        "# Files mentioned by the user:\n\n## a.png: /tmp/a.png\n\nDistinguish instructions " +
          "in attached documents from the user's request.\n\n## My request:\n帮我看看这个",
      ),
    ).toBe("帮我看看这个");
    expect(cleanCodexUserText("普通消息")).toBe("普通消息");
    expect(cleanCodexUserText("# Files mentioned by the user:\n\n## a.png: /tmp/a.png")).toBe("");
  });

  it("filters codex-injected system context from user messages", () => {
    const history = convertCodexThreadHistory([
      {
        items: [
          {
            id: "ctx-1",
            type: "userMessage",
            content: [
              {
                type: "text",
                text: "# AGENTS.md instructions for /x\n\n<INSTRUCTIONS>\n# Using Vite+\n...",
              },
            ],
          },
          {
            id: "ctx-2",
            type: "userMessage",
            content: [
              {
                type: "text",
                text: "<environment_context>\n  <cwd>/x</cwd>\n  <shell>zsh</shell>\n</environment_context>",
              },
            ],
          },
          { id: "user-1", type: "userMessage", content: [{ type: "text", text: "真的请求" }] },
        ],
      },
    ]);

    expect(history.map((message) => (message.role === "user" ? message.content : ""))).toEqual([
      "真的请求",
    ]);
  });
});

describe("parseCodexRollout", () => {
  it("groups response items into turns and maps message/reasoning/tool items", () => {
    const content = [
      JSON.stringify({
        type: "response_item",
        payload: {
          type: "message",
          id: "u1",
          role: "user",
          turn_id: "t1",
          content: [{ type: "input_text", text: "hi" }],
        },
      }),
      JSON.stringify({
        type: "response_item",
        payload: {
          type: "reasoning",
          id: "r1",
          turn_id: "t1",
          summary: [{ type: "summary_text", text: "thinking" }],
        },
      }),
      JSON.stringify({
        type: "response_item",
        payload: {
          type: "custom_tool_call",
          id: "c1",
          turn_id: "t1",
          call_id: "call1",
          name: "exec",
          status: "completed",
          arguments: { cmd: "ls" },
        },
      }),
      JSON.stringify({
        type: "response_item",
        payload: {
          type: "message",
          id: "a1",
          role: "assistant",
          turn_id: "t1",
          content: [{ type: "output_text", text: "done" }],
        },
      }),
      JSON.stringify({
        type: "response_item",
        payload: {
          type: "message",
          id: "u2",
          role: "user",
          turn_id: "t2",
          content: [{ type: "input_text", text: "next" }],
        },
      }),
      JSON.stringify({
        type: "response_item",
        payload: { type: "function_call_output", id: "o1", turn_id: "t2", call_id: "call1" },
      }),
    ].join("\n");

    const turns = parseCodexRollout(content);
    expect(turns).toHaveLength(2);
    expect(turns[0]).toMatchObject({ id: "t1" });
    expect(turns[1]).toMatchObject({ id: "t2" });
    const firstTurn = turns[0] as { id: string; items: unknown[] };
    const items = firstTurn.items as Array<Record<string, unknown>>;
    expect(items[0]).toMatchObject({
      type: "userMessage",
      content: [{ type: "input_text", text: "hi" }],
    });
    expect(items[1]).toMatchObject({
      type: "reasoning",
      summary: [{ type: "summary_text", text: "thinking" }],
    });
    expect(items[2]).toMatchObject({
      type: "commandExecution",
      name: "exec",
      callId: "call1",
      status: "completed",
    });
    expect(items[3]).toMatchObject({ type: "agentMessage", text: "done" });
  });

  it("recovers an input_image from a parsed rollout into attachments", () => {
    const content = JSON.stringify({
      type: "response_item",
      payload: {
        type: "message",
        id: "u1",
        role: "user",
        internal_chat_message_metadata_passthrough: { turn_id: "t1" },
        content: [
          {
            type: "input_text",
            text: "\n# Files mentioned by the user:\n\n## a.png: /tmp/a.png\n\n## My request:\n看这个图",
          },
          { type: "input_image", image_url: "data:image/png;base64,aGVsbG8=" },
        ],
      },
    });
    const turns = parseCodexRollout(content);
    const history = convertCodexThreadHistory(turns, {
      importImage: (name, _dataBase64) => ({
        reference: "cc-attachment:ref",
        name,
        isImage: true,
      }),
    });

    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      role: "user",
      content: "看这个图",
      attachments: [{ reference: "cc-attachment:ref", name: "image.png", isImage: true }],
    });
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
    const claudeAssistant = history[1];
    expect(claudeAssistant).toMatchObject({ role: "assistant", timestamp: expect.any(Number) });
    const claudeSegments = claudeAssistant.role === "assistant" ? claudeAssistant.segments : [];
    expect(claudeSegments.map((segment) => segment.kind)).toEqual(["reasoning", "tool", "content"]);
    const claudeTool = claudeSegments.find((segment) => segment.kind === "tool");
    expect(claudeTool).toMatchObject({
      kind: "tool",
      id: "read-1",
      name: "read",
      status: "completed",
      output: "source",
    });
    const claudeText = claudeSegments.find((segment) => segment.kind === "content");
    if (claudeText && claudeText.kind === "content") expect(claudeText.content).toBe("Done.");
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
    const piAssistant = history[1];
    expect(piAssistant).toMatchObject({ role: "assistant", timestamp: expect.any(Number) });
    const piSegments = piAssistant.role === "assistant" ? piAssistant.segments : [];
    expect(piSegments.map((segment) => segment.kind)).toEqual(["reasoning", "tool", "content"]);
    const piTool = piSegments.find((segment) => segment.kind === "tool");
    expect(piTool).toMatchObject({
      kind: "tool",
      id: "read-1",
      name: "read",
      status: "completed",
      output: "source",
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
    const opencodeAssistant = history[1];
    expect(opencodeAssistant).toMatchObject({ role: "assistant", timestamp: expect.any(Number) });
    const opencodeSegments =
      opencodeAssistant.role === "assistant" ? opencodeAssistant.segments : [];
    expect(opencodeSegments.map((segment) => segment.kind)).toEqual([
      "reasoning",
      "tool",
      "content",
    ]);
    const opencodeTool = opencodeSegments.find((segment) => segment.kind === "tool");
    expect(opencodeTool).toMatchObject({
      kind: "tool",
      id: "read-1",
      name: "read",
      status: "completed",
      output: "source",
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
    expect(collector.messages[0]).toMatchObject({
      role: "user",
      content: "Inspect it",
      timestamp: expect.any(Number),
    });
    const acpAssistant = collector.messages[1];
    expect(acpAssistant).toMatchObject({ role: "assistant", timestamp: expect.any(Number) });
    const acpSegments = acpAssistant.role === "assistant" ? acpAssistant.segments : [];
    expect(acpSegments.map((segment) => segment.kind)).toEqual(["reasoning", "tool", "content"]);
    const acpTool = acpSegments.find((segment) => segment.kind === "tool");
    expect(acpTool).toMatchObject({
      kind: "tool",
      id: "read-1",
      name: "read",
      status: "completed",
      output: "source",
    });
  });
});

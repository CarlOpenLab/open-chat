/// <reference types="vite-plus/test/globals" />

import type { TranscriptMessage } from "./types";
import { synthesizeSessionEvents, validateSessionEvents } from "./sessionEvents";
import { convertSessionEventsHistory, parseEventArguments } from "./adapters/sessionEvents";

const createdAt = 1_710_000_000_000;

function options(overrides: Partial<Parameters<typeof synthesizeSessionEvents>[1]> = {}) {
  return {
    meta: { id: "session-1", createdAt },
    provider: "codex",
    model: "gpt-5",
    ...overrides,
  };
}

function sampleHistory(): TranscriptMessage[] {
  return [
    { id: "u1", timestamp: createdAt, role: "user", content: "Inspect the repo" },
    {
      id: "a1",
      timestamp: createdAt + 1,
      role: "assistant",
      segments: [
        { kind: "reasoning", content: "First, find the layout." },
        { kind: "content", content: "Let me look." },
        {
          kind: "tool",
          id: "tool-1",
          name: "read",
          status: "completed",
          input: { path: "src/index.ts" },
          output: "export const x = 1;",
        },
      ],
    },
    { id: "u2", timestamp: createdAt + 2, role: "user", content: "Now fix the test" },
    {
      id: "a2",
      timestamp: createdAt + 3,
      role: "assistant",
      segments: [
        { kind: "content", content: "Done." },
        {
          kind: "tool",
          id: "tool-2",
          name: "bash",
          status: "error",
          input: { command: "vp check" },
          error: "exit code 1",
        },
      ],
    },
  ];
}

function assistantSegments(message: TranscriptMessage) {
  return message.role === "assistant" ? message.segments : [];
}

describe("synthesizeSessionEvents", () => {
  it("emits balanced turn/step events with continuous seq and surface ops", () => {
    const result = synthesizeSessionEvents(sampleHistory(), options());
    expect(result.validation.ok).toBe(true);
    expect(result.messages).toBe(6); // 2 user + 2 assistant + 2 tool/result
    expect(result.toolCalls).toBe(2);

    const types = result.events.map((ev) => ev.type);
    expect(types).toContain("turn/start");
    expect(types).toContain("step/start");
    expect(types).toContain("assistant/message");
    expect(types).toContain("tool/call");
    expect(types).toContain("tool/result");
    expect(types).toContain("turn/end");

    const surface = result.events.filter((ev) => ev.surfaceOp !== undefined);
    expect(surface).toHaveLength(6);
    expect(surface.every((ev) => ev.surfaceOp === "append")).toBe(true);

    // 每个 tool/result 都通过 sourceEventSeqs 指向自己的 tool/call
    for (const ev of result.events) {
      if (ev.type !== "tool/result") continue;
      expect(Array.isArray(ev.sourceEventSeqs)).toBe(true);
      const target = result.events.find((candidate) => candidate.seq === ev.sourceEventSeqs![0]);
      expect(target?.type).toBe("tool/call");
    }
  });

  it("maps reasoning, tool input/output, and error results into content blocks", () => {
    const result = synthesizeSessionEvents(sampleHistory(), options());
    const assistant = result.events.find((ev) => ev.type === "assistant/message")!;
    const blocks = assistant.data.message as { content: Array<Record<string, unknown>> };
    expect(blocks.content[0]).toMatchObject({ type: "reasoning", text: "First, find the layout." });
    expect(blocks.content[1]).toMatchObject({ type: "text", text: "Let me look." });
    expect(blocks.content[2]).toMatchObject({
      type: "tool-call",
      id: "tool-1",
      name: "read",
      arguments: JSON.stringify({ path: "src/index.ts" }),
    });

    const errorResult = result.events.filter((ev) => ev.type === "tool/result")[1];
    const resultMessage = errorResult.data.message as { content: Array<Record<string, unknown>> };
    expect(resultMessage.content[0]).toMatchObject({
      type: "tool-result",
      toolCallId: "tool-2",
      isError: true,
    });
  });

  it("writes a session/imported marker when imported metadata is provided", () => {
    const result = synthesizeSessionEvents(
      sampleHistory(),
      options({ imported: { tool: "codex", sourceId: "src-9" } }),
    );
    const marker = result.events[0];
    expect(marker.type).toBe("session/imported");
    expect(marker.ignorable).toBe(true);
    expect(marker.data).toMatchObject({ tool: "codex", sourceId: "src-9" });
  });

  it("backs pending/running tool calls with an empty result to keep the pairing invariant", () => {
    const history: TranscriptMessage[] = [
      { id: "u1", timestamp: createdAt, role: "user", content: "Run it" },
      {
        id: "a1",
        timestamp: createdAt + 1,
        role: "assistant",
        segments: [
          {
            kind: "tool",
            id: "tool-p",
            name: "bash",
            status: "running",
            input: { command: "make" },
          },
        ],
      },
    ];
    const result = synthesizeSessionEvents(history, options());
    expect(result.validation.ok).toBe(true);
    const results = result.events.filter((ev) => ev.type === "tool/result");
    expect(results).toHaveLength(1);
    const message = results[0].data.message as { content: Array<Record<string, unknown>> };
    expect(message.content[0]).toMatchObject({ type: "tool-result", toolCallId: "tool-p" });
    expect(result.degradations).toContainEqual(
      expect.objectContaining({ id: "pending-tool-result", count: 1 }),
    );
  });

  it("reports plan and attachment degradation instead of silently dropping them", () => {
    const history: TranscriptMessage[] = [
      {
        id: "u1",
        timestamp: createdAt,
        role: "user",
        content: "Plan this",
        attachments: [{ reference: "data:image/png;base64,aa", name: "shot.png", isImage: true }],
      },
      {
        id: "a1",
        timestamp: createdAt + 1,
        role: "assistant",
        segments: [
          { kind: "content", content: "Plan:" },
          { kind: "plan", entries: [{ content: "step 1", status: "pending" }] },
        ],
      },
    ];
    const result = synthesizeSessionEvents(history, options());
    const degradations = result.degradations ?? [];
    expect(degradations).toContainEqual(
      expect.objectContaining({ id: "attachment-skipped", count: 1 }),
    );
    expect(degradations).toContainEqual(expect.objectContaining({ id: "plan-skipped", count: 1 }));
  });

  it("returns undefined degradations when nothing was lost", () => {
    const result = synthesizeSessionEvents(sampleHistory(), options());
    expect(result.degradations).toBeUndefined();
  });

  it("writes a pinned session/title event when a title is provided", () => {
    const result = synthesizeSessionEvents(sampleHistory(), options({ title: "Repo audit" }));
    const title = result.events.find((ev) => ev.type === "session/title");
    expect(title).toMatchObject({ data: { title: "Repo audit" } });
  });
});

describe("validateSessionEvents", () => {
  it("accepts synthesized events", () => {
    const result = synthesizeSessionEvents(sampleHistory(), options());
    expect(validateSessionEvents(result.events).ok).toBe(true);
  });

  it("flags duplicate seq, seq gaps, and missing surface ops", () => {
    const result = synthesizeSessionEvents(sampleHistory(), options());
    const events = result.events.map((ev) => ({ ...ev }));
    events[3] = { ...events[3], seq: events[2].seq };
    events[4] = { ...events[4], seq: 999, surfaceOp: undefined };
    const { ok, problems } = validateSessionEvents(events);
    expect(ok).toBe(false);
    const kinds = problems.map((p) => p.kind);
    expect(kinds).toContain("duplicate-seq");
    expect(kinds).toContain("seq-gap");
    expect(kinds).toContain("missing-surface-op");
  });
});

describe("convertSessionEventsHistory", () => {
  it("round-trips a synthesized session back into the canonical history", () => {
    const history = sampleHistory();
    const result = synthesizeSessionEvents(history, options());
    const lines = result.events.map(
      (ev) => JSON.parse(JSON.stringify(ev)) as Record<string, unknown>,
    );
    const restored = convertSessionEventsHistory(lines);

    expect(restored).toHaveLength(4);
    expect(restored[0]).toMatchObject({
      role: "user",
      content: "Inspect the repo",
      timestamp: expect.any(Number),
    });
    const a1 = restored[1];
    expect(a1).toMatchObject({ role: "assistant", timestamp: expect.any(Number) });
    expect(assistantSegments(a1).map((s) => s.kind)).toEqual(["reasoning", "content", "tool"]);
    const tool1 = assistantSegments(a1).find((s) => s.kind === "tool");
    expect(tool1).toMatchObject({
      kind: "tool",
      id: "tool-1",
      name: "read",
      status: "completed",
      output: "export const x = 1;",
    });
    if (tool1 && tool1.kind === "tool") expect(tool1.input).toEqual({ path: "src/index.ts" });
    const tool2 = assistantSegments(restored[3]).find((s) => s.kind === "tool");
    expect(tool2).toMatchObject({
      kind: "tool",
      id: "tool-2",
      name: "bash",
      status: "error",
      error: "exit code 1",
    });
  });

  it("merges adjacent assistant fragments and preserves segment order", () => {
    const result = synthesizeSessionEvents(sampleHistory(), options());
    const lines = result.events.map(
      (ev) => JSON.parse(JSON.stringify(ev)) as Record<string, unknown>,
    );
    const restored = convertSessionEventsHistory(lines);
    const assistant = restored[1];
    const segments = assistantSegments(assistant);
    expect(segments.map((s) => s.kind)).toEqual(["reasoning", "content", "tool"]);
    const tool = segments.find((s) => s.kind === "tool");
    if (tool && tool.kind === "tool") expect(tool.status).toBe("completed");
  });

  it("fills tool name/arguments from tool/call events when the block lacks them", () => {
    const lines: Array<Record<string, unknown>> = [
      { type: "turn/start", seq: 0, time: createdAt, data: { turn: 1 } },
      {
        type: "user/message",
        seq: 1,
        time: createdAt,
        surfaceOp: "append",
        data: {
          id: "u1",
          role: "user",
          content: [{ type: "text", text: "Run" }],
          source: { kind: "user" },
        },
      },
      {
        type: "assistant/message",
        seq: 2,
        time: createdAt,
        surfaceOp: "append",
        data: {
          turn: 1,
          step: 1,
          message: {
            id: "a1",
            role: "assistant",
            content: [{ type: "tool-call", id: "t1" }],
            source: { kind: "model", provider: "codex", model: "gpt-5" },
          },
        },
      },
      {
        type: "tool/call",
        seq: 3,
        time: createdAt,
        data: { turn: 1, step: 1, callId: "t1", name: "bash", arguments: '{"command":"make"}' },
      },
      {
        type: "tool/result",
        seq: 4,
        time: createdAt,
        surfaceOp: "append",
        sourceEventSeqs: [3],
        data: {
          turn: 1,
          step: 1,
          message: {
            id: "r1",
            role: "user",
            content: [
              { type: "tool-result", toolCallId: "t1", content: [{ type: "text", text: "ok" }] },
            ],
            source: { kind: "tool", callId: "t1" },
          },
        },
      },
    ];
    const restored = convertSessionEventsHistory(lines);
    const assistant = restored[1];
    const tool = assistantSegments(assistant).find((s) => s.kind === "tool");
    expect(tool).toMatchObject({
      kind: "tool",
      id: "t1",
      name: "bash",
      status: "completed",
      output: "ok",
    });
    if (tool && tool.kind === "tool") expect(tool.input).toEqual({ command: "make" });
  });
});

describe("parseEventArguments", () => {
  it("parses JSON strings and leaves non-JSON values alone", () => {
    expect(parseEventArguments('{"a":1}')).toEqual({ a: 1 });
    expect(parseEventArguments("plain text")).toBe("plain text");
    expect(parseEventArguments(undefined)).toBeUndefined();
    expect(parseEventArguments("")).toBe("");
  });
});

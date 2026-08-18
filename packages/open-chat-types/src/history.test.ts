/// <reference types="vite-plus/test/globals" />

import { extractWorkspaceFromContent, flattenHistory, segmentHistory } from "./history";
import type { TranscriptMessage } from "./types";
import type { HistoryRecord } from "./history";

const T = 1_710_000_000_000;

function sampleMessages(): TranscriptMessage[] {
  return [
    { id: "u1", timestamp: T, role: "user", content: "Fix it" },
    {
      id: "a1",
      timestamp: T + 1,
      role: "assistant",
      segments: [
        { kind: "reasoning", content: "think a" },
        { kind: "content", content: "First answer." },
        { kind: "tool", id: "t1", name: "read", status: "completed", output: "ok" },
        { kind: "content", content: "Second answer." },
        { kind: "fileChange", path: "src/a.ts", additions: 2 },
      ],
    },
    { id: "u2", timestamp: T + 2, role: "user", content: "Done" },
  ];
}

describe("flattenHistory", () => {
  it("flattens messages into top-level timestamp-ordered records", () => {
    const records = flattenHistory(sampleMessages());
    expect(records.map((r) => r.kind)).toEqual([
      "user",
      "reasoning",
      "content",
      "tool",
      "content",
      "fileChange",
      "user",
    ]);
    const tool = records[3];
    expect(tool).toMatchObject({
      kind: "tool",
      id: "t1",
      name: "read",
      status: "completed",
      output: "ok",
    });
    const file = records[5];
    expect(file).toMatchObject({ kind: "fileChange", path: "src/a.ts", additions: 2 });
    expect(records.every((r) => typeof r.id === "string" && typeof r.timestamp === "number")).toBe(
      true,
    );
  });
});

describe("segmentHistory", () => {
  it("regroups flat records back into user/assistant messages", () => {
    const records = flattenHistory(sampleMessages());
    const messages = segmentHistory(records);
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(messages[0]).toMatchObject({ id: "u1", role: "user", content: "Fix it" });
    const assistant = messages[1];
    expect(assistant.role).toBe("assistant");
    if (assistant.role === "assistant") {
      expect(assistant.segments.map((s) => s.kind)).toEqual([
        "reasoning",
        "content",
        "tool",
        "content",
        "fileChange",
      ]);
      const tool = assistant.segments[2];
      if (tool.kind === "tool") expect(tool).toMatchObject({ id: "t1", output: "ok" });
    }
  });

  it("merges adjacent content/reasoning records", () => {
    const messages = segmentHistory([
      { id: "u1", timestamp: T, kind: "user", content: "hi" },
      { id: "a0", timestamp: T, kind: "reasoning", content: "r1" },
      { id: "a1", timestamp: T, kind: "reasoning", content: "r2" },
      { id: "a2", timestamp: T, kind: "content", content: "c1" },
      { id: "a3", timestamp: T, kind: "content", content: "c2" },
    ]);
    const assistant = messages[1];
    expect(assistant.role).toBe("assistant");
    if (assistant.role === "assistant") {
      expect(assistant.segments).toEqual([
        { kind: "reasoning", content: "r1r2" },
        { kind: "content", content: "c1\n\nc2" },
      ]);
    }
  });

  it("upserts tool by id across records", () => {
    const messages = segmentHistory([
      { id: "u1", timestamp: T, kind: "user", content: "go" },
      { id: "t1", timestamp: T, kind: "tool", name: "read", status: "running" },
      { id: "t1", timestamp: T, kind: "tool", name: "read", status: "completed", output: "ok" },
    ]);
    const assistant = messages[1];
    if (assistant.role === "assistant") {
      expect(assistant.segments).toEqual([
        { kind: "tool", id: "t1", name: "read", status: "completed", output: "ok" },
      ]);
    }
  });

  it("extracts workspace blocks from content records", () => {
    const records: HistoryRecord[] = [
      { id: "u1", timestamp: T, kind: "user", content: "write files" },
      {
        id: "a1",
        timestamp: T,
        kind: "content",
        content:
          'before\n<files>\n<file path="a.ts" language="typescript">\nconst x = 1;\n</file>\n</files>\nafter',
      },
    ];
    const messages = segmentHistory(records);
    const assistant = messages[1];
    if (assistant.role === "assistant") {
      const kinds = assistant.segments.map((s) => s.kind);
      expect(kinds).toContain("content");
      expect(kinds).toContain("workspace");
      const workspace = assistant.segments.find((s) => s.kind === "workspace");
      if (workspace && workspace.kind === "workspace") {
        expect(workspace.files).toEqual([
          {
            path: "a.ts",
            content: "const x = 1;",
            language: "typescript",
            status: "complete",
          },
        ]);
      }
      const content = assistant.segments.find((s) => s.kind === "content");
      if (content && content.kind === "content") {
        expect(content.content).toBe("before\nafter");
      }
    }
  });
});

describe("extractWorkspaceFromContent", () => {
  it("parses files and strips the block from markdown", () => {
    const result = extractWorkspaceFromContent(
      'lead\n<files>\n<file path="src/app.ts">\nconst a = 1;\n</file>\n</files>\ntail',
    );
    expect(result.hasWorkspaceBlock).toBe(true);
    expect(result.files).toHaveLength(1);
    expect(result.files[0]).toMatchObject({ path: "src/app.ts", status: "complete" });
    expect(result.markdown).toBe("lead\ntail");
  });

  it("returns no workspace when there is no block", () => {
    const result = extractWorkspaceFromContent("plain text");
    expect(result.hasWorkspaceBlock).toBe(false);
    expect(result.files).toHaveLength(0);
    expect(result.markdown).toBe("plain text");
  });
});

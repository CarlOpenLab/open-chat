/// <reference types="vite-plus/test/globals" />

import { legacyToMessages } from "./legacy";

describe("legacyToMessages", () => {
  it("maps timeline items in order", () => {
    const messages = legacyToMessages({
      content: "answer",
      reasoningContent: "think",
      toolCalls: [
        {
          id: "t1",
          name: "read",
          status: "completed",
          fileChanges: [{ path: "a.ts", additions: 2 }],
        },
      ],
      timeline: [
        { kind: "reasoning", id: "r", content: "think" },
        { kind: "tool", id: "t1", activity: { id: "t1", name: "read", status: "completed" } },
        { kind: "content", id: "c", content: "answer" },
      ],
    });
    expect(messages.map((m) => m.role)).toEqual(["reasoning", "tool", "content"]);
  });

  it("splits tool fileChanges into fileChange messages and drops them from the tool", () => {
    const messages = legacyToMessages({
      content: "",
      toolCalls: [
        {
          id: "t1",
          name: "edit",
          status: "completed",
          fileChanges: [{ path: "a.ts", additions: 2 }, { path: "b.ts" }],
        },
      ],
    });
    expect(messages.map((m) => m.role)).toEqual(["tool", "fileChange", "fileChange"]);
    const tool = messages[0];
    expect(tool).toMatchObject({ role: "tool", id: "t1", name: "edit", status: "completed" });
    expect(tool).not.toHaveProperty("fileChanges");
  });

  it("converts fileChange-kind activities into fileChange messages only", () => {
    const messages = legacyToMessages({
      content: "",
      toolCalls: [
        {
          id: "fc1",
          name: "file_change",
          kind: "fileChange",
          status: "completed",
          fileChanges: [{ path: "a.ts", additions: 1 }],
        },
      ],
    });
    expect(messages).toEqual([
      {
        id: "fc:a.ts",
        timestamp: expect.any(Number),
        role: "fileChange",
        path: "a.ts",
        additions: 1,
      },
    ]);
  });
});

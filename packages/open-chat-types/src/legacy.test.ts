/// <reference types="vite-plus/test/globals" />

import { legacyToSegments } from "./legacy";

describe("legacyToSegments", () => {
  it("maps timeline items in order", () => {
    const segments = legacyToSegments({
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
    expect(segments.map((s) => s.kind)).toEqual(["reasoning", "tool", "content"]);
  });

  it("splits tool fileChanges into fileChange segments and drops them from the tool", () => {
    const segments = legacyToSegments({
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
    expect(segments).toEqual([
      { kind: "tool", id: "t1", name: "edit", status: "completed" },
      { kind: "fileChange", path: "a.ts", additions: 2 },
      { kind: "fileChange", path: "b.ts" },
    ]);
  });

  it("converts fileChange-kind activities into fileChange segments only", () => {
    const segments = legacyToSegments({
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
    expect(segments).toEqual([{ kind: "fileChange", path: "a.ts", additions: 1 }]);
  });
});

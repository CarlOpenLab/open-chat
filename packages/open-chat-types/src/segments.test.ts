/// <reference types="vite-plus/test/globals" />

import {
  applySegmentDelta,
  buildTimelineItems,
  mergeContentSegments,
  mergeReasoningContent,
  segmentsToOpenAIFormat,
  summarizeActivities,
} from "./segments";
import type { TranscriptSegment } from "./types";

describe("mergeContentSegments", () => {
  it("joins content segments with a blank line and ignores non-content", () => {
    const segments: TranscriptSegment[] = [
      { kind: "reasoning", content: "hidden" },
      { kind: "content", content: "First" },
      { kind: "tool", id: "t1", name: "read", status: "completed" },
      { kind: "content", content: "Second" },
    ];
    expect(mergeContentSegments(segments)).toBe("First\n\nSecond");
  });

  it("returns empty string when there are no content segments", () => {
    expect(mergeContentSegments([{ kind: "tool", id: "t", name: "x", status: "completed" }])).toBe(
      "",
    );
  });
});

describe("mergeReasoningContent", () => {
  it("joins reasoning segments", () => {
    const segments: TranscriptSegment[] = [
      { kind: "reasoning", content: "a" },
      { kind: "content", content: "text" },
      { kind: "reasoning", content: "b" },
    ];
    expect(mergeReasoningContent(segments)).toBe("a\n\nb");
  });
});

describe("summarizeActivities", () => {
  it("counts commands, reasoning, plans, and files", () => {
    const segments: TranscriptSegment[] = [
      { kind: "reasoning", content: "r" },
      { kind: "tool", id: "t1", name: "bash", status: "completed" },
      { kind: "fileChange", path: "a.ts", additions: 1 },
      { kind: "fileChange", path: "b.ts" },
      { kind: "plan", entries: [{ content: "p", status: "pending" }] },
      {
        kind: "workspace",
        files: [{ path: "w.ts", status: "complete" }],
        errors: [],
      },
    ];
    expect(summarizeActivities(segments)).toEqual({
      commands: 1,
      reasoning: 1,
      plans: 1,
      files: 3,
    });
  });
});

describe("applySegmentDelta", () => {
  it("merges adjacent content/reasoning deltas", () => {
    let segments: TranscriptSegment[] = [];
    segments = applySegmentDelta(segments, { kind: "content", content: "Hel" });
    segments = applySegmentDelta(segments, { kind: "content", content: "lo" });
    segments = applySegmentDelta(segments, { kind: "reasoning", content: "th" });
    segments = applySegmentDelta(segments, { kind: "reasoning", content: "ink" });
    expect(segments).toEqual([
      { kind: "content", content: "Hello" },
      { kind: "reasoning", content: "think" },
    ]);
  });

  it("upserts tool by id and keeps order", () => {
    let segments: TranscriptSegment[] = [];
    segments = applySegmentDelta(segments, {
      kind: "tool",
      id: "t1",
      name: "read",
      status: "running",
    });
    segments = applySegmentDelta(segments, {
      kind: "tool",
      id: "t1",
      name: "read",
      status: "completed",
      output: "ok",
    });
    segments = applySegmentDelta(segments, {
      kind: "tool",
      id: "t2",
      name: "bash",
      status: "running",
    });
    expect(segments).toHaveLength(2);
    expect(segments[0]).toMatchObject({
      kind: "tool",
      id: "t1",
      status: "completed",
      output: "ok",
    });
  });

  it("upserts fileChange by path", () => {
    let segments: TranscriptSegment[] = [];
    segments = applySegmentDelta(segments, { kind: "fileChange", path: "a.ts" });
    segments = applySegmentDelta(segments, { kind: "fileChange", path: "a.ts", additions: 3 });
    expect(segments).toEqual([{ kind: "fileChange", path: "a.ts", additions: 3 }]);
  });
});

describe("segmentsToOpenAIFormat", () => {
  it("flattens content, reasoning, and tool_calls", () => {
    const segments: TranscriptSegment[] = [
      { kind: "reasoning", content: "think" },
      { kind: "content", content: "answer" },
      { kind: "tool", id: "t1", name: "read", status: "completed", input: { path: "a.ts" } },
    ];
    const wire = segmentsToOpenAIFormat(segments);
    expect(wire.content).toBe("answer");
    expect(wire.reasoning_content).toBe("think");
    expect(wire.tool_calls).toEqual([
      { id: "t1", type: "function", function: { name: "read", arguments: '{"path":"a.ts"}' } },
    ]);
  });
});

describe("buildTimelineItems", () => {
  it("maps segments to ordered timeline entries including file changes", () => {
    const segments: TranscriptSegment[] = [
      { kind: "reasoning", content: "r" },
      { kind: "content", content: "c" },
      { kind: "fileChange", path: "a.ts", additions: 2, deletions: 1 },
    ];
    const timeline = buildTimelineItems(segments, "m1");
    expect(timeline.map((item) => item.kind)).toEqual(["reasoning", "content", "tool"]);
    const fileEntry = timeline[2];
    expect(fileEntry).toMatchObject({
      kind: "tool",
      activity: { kind: "fileChange", fileChanges: [{ path: "a.ts", additions: 2, deletions: 1 }] },
    });
  });
});

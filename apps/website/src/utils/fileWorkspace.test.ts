import { describe, expect, test } from "vite-plus/test";
import { collectWorkspaceDiffStats } from "./fileWorkspace";

const file = (originalContent: string, content: string) => ({
  originalContent,
  content,
  dirty: originalContent !== content,
});

describe("collectWorkspaceDiffStats", () => {
  test("reports nothing when there are no files", () => {
    expect(collectWorkspaceDiffStats([])).toEqual({ added: 0, removed: 0 });
  });

  test("ignores files that are not dirty", () => {
    expect(collectWorkspaceDiffStats([file("a\nb", "a\nb")])).toEqual({ added: 0, removed: 0 });
  });

  test("counts appended lines as additions", () => {
    expect(collectWorkspaceDiffStats([file("a\nb", "a\nb\nc\nd")])).toEqual({
      added: 2,
      removed: 0,
    });
  });

  test("counts dropped lines as removals", () => {
    expect(collectWorkspaceDiffStats([file("a\nb\nc", "a")])).toEqual({ added: 0, removed: 2 });
  });

  test("counts an edited line as one addition and one removal", () => {
    expect(collectWorkspaceDiffStats([file("a\nb\nc", "a\nB\nc")])).toEqual({
      added: 1,
      removed: 1,
    });
  });

  test("does not count pure reordering", () => {
    expect(collectWorkspaceDiffStats([file("a\nb\nc", "c\nb\na")])).toEqual({
      added: 0,
      removed: 0,
    });
  });

  test("sums across several dirty files", () => {
    expect(
      collectWorkspaceDiffStats([
        file("a", "a\nb"),
        file("x\ny", "x"),
        file("same", "same"),
        file("1\n2", "1\n2\n3\n4"),
      ]),
    ).toEqual({ added: 3, removed: 1 });
  });
});

/// <reference types="vite-plus/test/globals" />

import { extractWorkspaceFromContent } from "./history";

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

  it("marks an unclosed block as pending", () => {
    const result = extractWorkspaceFromContent('before\n<files>\n<file path="a.ts">\nconst x = 1;');
    expect(result.hasWorkspaceBlock).toBe(true);
    expect(result.hasPendingBlock).toBe(true);
    expect(result.files).toHaveLength(1);
    expect(result.files[0].status).toBe("streaming");
  });
});

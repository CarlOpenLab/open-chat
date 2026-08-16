/// <reference types="vite-plus/test/globals" />

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readGitWorkspace, switchGitBranch } from "./gitWorkspace";

describe("git workspace", () => {
  let directory = "";

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "open-chat-git-"));
    git(directory, "init", "-b", "main");
    git(directory, "config", "user.name", "Open Chat Test");
    git(directory, "config", "user.email", "open-chat@example.test");
    writeFileSync(join(directory, "README.md"), "initial\n");
    git(directory, "add", "README.md");
    git(directory, "commit", "-m", "initial");
    git(directory, "branch", "feature/test");
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it("reads repository state and switches an existing local branch", async () => {
    writeFileSync(join(directory, "README.md"), "changed\n");

    const initial = await readGitWorkspace(directory);
    expect(initial).toMatchObject({
      isRepository: true,
      currentBranch: "main",
      branches: ["feature/test", "main"],
      dirty: true,
      detached: false,
    });

    const switched = await switchGitBranch(directory, "feature/test");
    expect(switched.currentBranch).toBe("feature/test");
  });

  it("returns a non-repository state for an ordinary directory", async () => {
    const plainDirectory = mkdtempSync(join(tmpdir(), "open-chat-plain-"));
    try {
      await expect(readGitWorkspace(plainDirectory)).resolves.toEqual({
        isRepository: false,
        branches: [],
        dirty: false,
        detached: false,
      });
    } finally {
      rmSync(plainDirectory, { recursive: true, force: true });
    }
  });
});

function git(directory: string, ...args: string[]): void {
  execFileSync("git", args, { cwd: directory, stdio: "ignore" });
}

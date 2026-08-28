/// <reference types="vite-plus/test/globals" />

import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveExecutable } from "./commandEnv";

function makeTempBin(): string {
  return mkdtempSync(join(tmpdir(), "open-chat-bin-"));
}

function makeExecutable(dir: string, name: string): string {
  const file = join(dir, name);
  writeFileSync(file, "#!/bin/sh\nexit 0\n");
  chmodSync(file, 0o755);
  return file;
}

describe("resolveExecutable", () => {
  const savedPath = process.env.PATH;

  afterEach(() => {
    if (savedPath === undefined) delete process.env.PATH;
    else process.env.PATH = savedPath;
  });

  it("resolves a bare command from PATH", () => {
    const dir = makeTempBin();
    const bin = makeExecutable(dir, "fake-agent");
    process.env.PATH = dir;
    expect(resolveExecutable("fake-agent")).toBe(bin);
  });

  it("returns null when the command is not on PATH", () => {
    process.env.PATH = makeTempBin();
    expect(resolveExecutable("definitely-not-installed-xyz")).toBeNull();
  });

  it("prefers an absolute path over PATH lookup", () => {
    const bin = makeExecutable(makeTempBin(), "abs-agent");
    process.env.PATH = makeTempBin();
    expect(resolveExecutable(bin)).toBe(bin);
  });

  it("skips PATH entries that are not executable", () => {
    const dir = makeTempBin();
    writeFileSync(join(dir, "not-exec"), "#!/bin/sh\nexit 0\n");
    process.env.PATH = dir;
    expect(resolveExecutable("not-exec")).toBeNull();
  });
});

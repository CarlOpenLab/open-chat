#!/usr/bin/env node
// Guarantees the vendored acp-hub submodule is present before `build:vendor`
// runs. A clone without `--recurse-submodules` (or a checkout that empties the
// submodule) leaves `vendor/acp-hub` as an empty directory, which makes the
// `acp-hub-*` workspace packages vanish and the server fail at runtime with
// ERR_MODULE_NOT_FOUND: Cannot find package 'acp-hub-core'.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const submodule = "vendor/acp-hub";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = join(root, submodule, "package.json");

if (existsSync(manifest)) process.exit(0);

const result = spawnSync("git", ["submodule", "update", "--init", "--recursive", submodule], {
  cwd: root,
  stdio: "inherit",
});

if (!existsSync(manifest)) {
  console.error(
    [
      `[ensure-vendor] ${submodule} is missing.`,
      result.error ? `git failed: ${result.error.message}` : `git exited with ${result.status}.`,
      "Run `git submodule update --init --recursive` in a clone of the repository,",
      "or fetch https://github.com/CarlOpenLab/acp-hub manually.",
    ].join("\n"),
  );
  process.exit(1);
}

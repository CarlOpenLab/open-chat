#!/usr/bin/env node
/**
 * open-chat 启动器。
 *
 * 优先加载 esbuild 打包产物（dist/cli.js）；未构建时回退到 tsx 直接跑
 * TypeScript 源码，方便仓库内开箱即用（`pnpm open-chat`）。
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const dist = join(dir, "..", "dist", "cli.cjs");

if (existsSync(dist)) {
  await import(dist);
} else {
  try {
    const { tsImport } = await import("tsx/esm/api");
    await tsImport("../src/cli.ts", import.meta.url);
  } catch (err) {
    console.error("open-chat: 未找到构建产物，且 tsx 不可用。");
    console.error(
      "  请先运行 `pnpm install`，然后 `pnpm open-chat`（自动走 tsx）或 `pnpm build`。",
    );
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

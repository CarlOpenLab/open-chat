import { cpSync, existsSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(packageDir, "../..");
const websiteSource = join(repoRoot, "apps", "website", "dist");
const websiteTarget = join(packageDir, "website-dist");

if (!existsSync(join(websiteSource, "index.html"))) {
  throw new Error(`网站构建产物不存在：${websiteSource}`);
}

rmSync(websiteTarget, { force: true, recursive: true });
cpSync(websiteSource, websiteTarget, { recursive: true });
console.log(`已准备 npm 包网站资源：${websiteTarget}`);

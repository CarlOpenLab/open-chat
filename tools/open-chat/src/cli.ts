/**
 * open-chat CLI：本地一键启动 Open Chat 工作区。
 *
 * 输入 `open-chat` 即可：
 *  1. 启动本地网关（Express，apps/server）
 *  2. 在同一端口托管已构建的 Web UI（apps/website/dist，同源无需 CORS）
 *  3. 自动打开浏览器
 *  4. Ctrl+C 优雅退出（停止 opencode / agent 子进程并关闭端口）
 *
 * 纯本地运行，不面向服务器部署。开发模式用 `open-chat --dev`
 * （另起 Vite dev server，走 http://localhost:3000 + /api 代理）。
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startGateway, type GatewayHandle } from "server/app";

const CLI_DIR =
  typeof __dirname !== "undefined" ? __dirname : dirname(fileURLToPath(import.meta.url));

/**
 * 源码仓库根目录。npm 包没有仓库根目录，因此这里只把它作为开发/构建能力使用。
 */
function findRepoRoot(start: string): string | undefined {
  let dir = start;
  for (let i = 0; i < 12; i += 1) {
    if (existsSync(join(dir, "pnpm-workspace.yaml")) && existsSync(join(dir, "apps", "server"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

const REPO_ROOT = findRepoRoot(CLI_DIR);
const PACKAGE_ROOT = resolve(CLI_DIR, "..");
const WEBSITE_DIST = REPO_ROOT
  ? join(REPO_ROOT, "apps", "website", "dist")
  : join(PACKAGE_ROOT, "website-dist");
const DEV_URL = "http://localhost:3000";

interface CliOptions {
  port?: number;
  host?: string;
  websiteDir?: string;
  open: boolean;
  dev: boolean;
  build: boolean;
  help: boolean;
  version: boolean;
  verbose: boolean;
}

const HELP = `open-chat — 本地启动 Open Chat 工作区（网关 + Web UI）

无需配置文件：默认自动发现本机已安装的 CLI agents
（codex / claude / pi / opencode / omp）。

用法:
  open-chat [选项]

选项:
  --port <port>        网关端口（默认 8082，0 = 自动分配）
  --host <host>        网关监听地址（默认 127.0.0.1）
  --website-dir <dir>  静态站点目录（默认使用内置网站资源）
  --dev                启动 Vite 开发服务器并打开 http://localhost:3000
  --build              构建网站与 CLI 后退出（open-chat build）
  --no-open            不自动打开浏览器
  --verbose            打印更多日志
  -v, --version        打印版本
  -h, --help           显示帮助

环境变量:
  OPEN_CHAT_WEBSITE_DIR    覆盖静态站点目录
`;

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    open: true,
    dev: false,
    build: false,
    help: false,
    version: false,
    verbose: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const eq = arg.indexOf("=");
    const key = eq >= 0 ? arg.slice(0, eq) : arg;
    const inline = eq >= 0 ? arg.slice(eq + 1) : undefined;
    const take = (name: string): string => {
      if (inline !== undefined) return inline;
      const next = argv[i + 1];
      if (next === undefined) {
        console.error(`open-chat: 缺少参数值: ${name}`);
        process.exit(1);
      }
      i += 1;
      return next;
    };
    switch (key) {
      case "--port":
        opts.port = Number(take("--port"));
        if (!Number.isInteger(opts.port) || opts.port < 0 || opts.port > 65535) {
          console.error(`open-chat: 无效端口: ${opts.port}`);
          process.exit(1);
        }
        break;
      case "--host":
        opts.host = take("--host");
        break;
      case "--website-dir":
        opts.websiteDir = take("--website-dir");
        break;
      case "--dev":
        opts.dev = true;
        break;
      case "--build":
        opts.build = true;
        break;
      case "--no-open":
        opts.open = false;
        break;
      case "--verbose":
        opts.verbose = true;
        break;
      case "-v":
      case "--version":
        opts.version = true;
        break;
      case "-h":
      case "--help":
        opts.help = true;
        break;
      default:
        console.error(`open-chat: 未知参数 ${arg}\n运行 open-chat --help 查看用法。`);
        process.exit(1);
    }
  }
  return opts;
}

function printVersion(): void {
  const pkg = join(CLI_DIR, "..", "package.json");
  try {
    const json = JSON.parse(readFileSync(pkg, "utf8")) as { version?: string };
    console.log(`open-chat ${json.version ?? "unknown"}`);
  } catch {
    console.log("open-chat (unknown version)");
  }
}

function resolveWebsiteDir(opts: CliOptions): string {
  if (opts.websiteDir) return resolve(opts.websiteDir);
  if (process.env.OPEN_CHAT_WEBSITE_DIR) return resolve(process.env.OPEN_CHAT_WEBSITE_DIR);
  return WEBSITE_DIST;
}

function resolvePnpm(): string {
  const execPath = process.env.npm_execpath;
  if (execPath && /pnpm/.test(execPath)) return execPath;
  return "pnpm";
}

function runProcess(command: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, stdio: "inherit", env: process.env });
    child.on("error", (err) => reject(err));
    child.on("exit", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

async function buildAll(): Promise<void> {
  if (!REPO_ROOT) {
    throw new Error(
      "npm 安装版不支持构建，请在 Open Chat 源码仓库中运行 `pnpm open-chat --build`。",
    );
  }
  const pnpm = resolvePnpm();
  console.log("构建网站…");
  await runProcess(pnpm, ["--filter", "website", "run", "build"], REPO_ROOT);
  console.log("构建 CLI…");
  await runProcess(pnpm, ["--filter", "@cc-heart/open-chat", "run", "build"], REPO_ROOT);
  console.log("构建完成。运行 `open-chat` 启动。");
}

/** 轮询等待 HTTP 服务就绪（Vite dev server 用）。 */
async function waitForHttp(url: string, timeoutMs = 30_000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return true;
    } catch {
      // 服务尚未就绪，继续轮询
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  }
  return false;
}

/** 等 Vite 就绪；dev server 提前退出（如端口被占）时直接报错。 */
async function waitDevReady(child: ChildProcess, url: string): Promise<void> {
  const exited = new Promise<never>((_, reject) => {
    child.on("exit", (code) =>
      reject(new Error(`Vite dev server 提前退出（code ${code}），请检查 ${url} 端口是否被占用。`)),
    );
    child.on("error", (err) => reject(err));
  });
  const ready = waitForHttp(url).then((ok) => {
    if (!ok) throw new Error(`Vite dev server 未在 ${url} 就绪（30s 超时）。`);
  });
  await Promise.race([ready, exited]);
}

function openBrowser(url: string): void {
  const platform = process.platform;
  const isWindows = platform === "win32";
  const command = isWindows ? "cmd" : platform === "darwin" ? "open" : "xdg-open";
  const args = isWindows ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  child.on("error", (err) => console.warn(`无法自动打开浏览器: ${err.message}`));
  child.unref();
}

function printBanner(url: string): void {
  const width = Math.max(46, url.length + 14);
  const pad = (text: string): string => `│  ${text.padEnd(width - 4)}│`;
  console.log("");
  console.log(`┌${"─".repeat(width - 2)}┐`);
  console.log(pad("Open Chat · AI CLI Workspace"));
  console.log(pad(""));
  console.log(pad(url));
  console.log(pad(""));
  console.log(pad("按 Ctrl+C 停止"));
  console.log(`└${"─".repeat(width - 2)}┘`);
  console.log("");
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(HELP);
    return;
  }
  if (opts.version) {
    printVersion();
    return;
  }
  if (opts.build) {
    await buildAll();
    return;
  }

  // 提前挂信号处理：避免 Ctrl+C 时子进程（dev server）成为孤儿。
  let devChild: ChildProcess | undefined;
  let gateway: GatewayHandle | undefined;
  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n收到 ${signal}，正在停止 Open Chat…`);
    if (devChild && !devChild.killed) {
      devChild.kill("SIGTERM");
      setTimeout(() => {
        if (!devChild?.killed) devChild?.kill("SIGKILL");
      }, 3000).unref();
    }
    void gateway?.stop().then(() => process.exit(0));
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  try {
    if (opts.dev) {
      if (!REPO_ROOT) {
        throw new Error(
          "npm 安装版不支持开发模式，请在 Open Chat 源码仓库中运行 `open-chat --dev`。",
        );
      }
      devChild = spawn(resolvePnpm(), ["--filter", "website", "run", "dev"], {
        cwd: REPO_ROOT,
        stdio: ["ignore", "inherit", "inherit"],
        env: { ...process.env, FORCE_COLOR: "1" },
      });
      await waitDevReady(devChild, DEV_URL);
    }

    let websiteDir: string | undefined;
    if (!opts.dev) {
      websiteDir = resolveWebsiteDir(opts);
      const indexFile = join(websiteDir, "index.html");
      if (!existsSync(indexFile)) {
        console.error(`open-chat: 网站未构建（缺少 ${indexFile}）。`);
        console.error("  请先运行 `pnpm open-chat --build`（或 `pnpm build`）。");
        process.exit(1);
      }
    }

    gateway = await startGateway({
      host: opts.host,
      port: opts.port,
      staticDir: websiteDir,
    });

    const targetUrl = opts.dev ? DEV_URL : gateway.url;
    if (opts.verbose) {
      console.log(`[open-chat] website: ${websiteDir ?? "vite dev server"}`);
    }
    printBanner(targetUrl);
    if (opts.open) openBrowser(targetUrl);
  } catch (err) {
    // 任何启动失败：清掉已拉起的子进程再退出。
    if (devChild && !devChild.killed) devChild.kill("SIGTERM");
    throw err;
  }
}

main().catch((err) => {
  console.error("open-chat: 启动失败");
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});

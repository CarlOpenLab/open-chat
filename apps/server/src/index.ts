/**
 * 独立网关入口（开发：`tsx watch src/index.ts --dev`；生产：`node dist/index.cjs`）。
 *
 * 无配置文件，使用内置默认配置（自动发现本机 CLI）。
 * 业务逻辑在 app.ts（`startGateway` / `createGatewayApp`），
 * CLI（tools/open-chat）也复用同一套入口。
 *
 * 可选参数：
 *   --port <port>  监听端口（默认 8082，0 = 自动分配）
 *   --host <host>  监听地址（默认 0.0.0.0，可从局域网访问）
 *   --dev          开发模式：不生成访问密码，Web 界面直接放行
 */
import { startGateway } from "./app";

function parseArg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] !== undefined ? process.argv[index + 1] : undefined;
}

const portRaw = parseArg("--port");
const host = parseArg("--host") ?? "0.0.0.0";
const dev = process.argv.includes("--dev") || process.env.NODE_ENV === "development";
const port = portRaw !== undefined ? Number(portRaw) : undefined;
if (port !== undefined && (!Number.isInteger(port) || port < 0 || port > 65535)) {
  console.error(`无效端口: ${portRaw}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const gateway = await startGateway({ host, port, dev });
  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\nReceived ${signal}, shutting down…`);
    const hardExit = setTimeout(() => process.exit(1), 5000).unref();
    void gateway
      .stop()
      .then(() => {
        clearTimeout(hardExit);
        process.exit(0);
      })
      .catch(() => {
        clearTimeout(hardExit);
        process.exit(1);
      });
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGHUP", () => shutdown("SIGHUP"));
  process.on("SIGQUIT", () => shutdown("SIGQUIT"));
}

main().catch((err) => {
  console.error("Failed to start gateway:", err instanceof Error ? err.message : err);
  process.exit(1);
});

/**
 * 终端直开的 provider 会话历史读取（按原生存储格式）。
 *
 * 实时回合全部走 ACP（acp-hub），但已持久化的会话仍从各 CLI 的本地存储读取：
 * claude → ~/.claude/projects JSONL，pi/omp → ~/.pi|~/.omp session JSONL，
 * codex → app-server thread/read（含 rollout 回退）。这些读取与传输层解耦。
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createReadStream } from "node:fs";
import { readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { homedir } from "node:os";
import { createInterface } from "node:readline";
import type { AcpAgentConfig } from "./config";
import { cliSpawnOptions, resolveExecutable } from "./commandEnv";
import { convertClaudeHistory } from "./transcript/adapters/claude";
import { convertCodexThreadHistory } from "./transcript/adapters/codex";
import { readCodexRolloutTurns } from "./codexRollout";
import { convertPiHistory } from "./transcript/adapters/pi";
import type { TranscriptMessage, TranscriptAttachment } from "./transcript/types";
import { attachmentStore } from "./attachments";

export type FileHistoryTransport = "codex" | "claude" | "pi" | "omp";

const RPC_TIMEOUT_MS = 15_000;

/** 读取 provider 持久化历史；transport 不支持或读取失败时返回空数组。 */
export async function readProviderFileHistory(
  agent: AcpAgentConfig,
  sessionId: string,
  cwd: string,
  enabled: boolean,
): Promise<TranscriptMessage[]> {
  if (!enabled) return [];
  try {
    switch (agent.transport) {
      case "codex":
        return await readCodexSessionHistory(agent, sessionId, cwd);
      case "claude":
        return await readClaudeSessionHistory(sessionId);
      case "pi":
      case "omp":
        return await readPiSessionHistory(sessionId, cwd, agent.transport);
      default:
        return [];
    }
  } catch (error) {
    console.error(`[${agent.id}] session history read failed:`, error);
    return [];
  }
}

/** pi / omp 的会话存储根目录：pi 在 ~/.pi/agent/sessions，omp 在 ~/.omp/agent/sessions。 */
function piSessionRoot(transport: FileHistoryTransport): string {
  return join(homedir(), transport === "omp" ? ".omp" : ".pi", "agent", "sessions");
}

async function findPiSessionPath(
  sessionId: string,
  cwd: string,
  transport: FileHistoryTransport,
): Promise<string | null> {
  const root = piSessionRoot(transport);
  const preferred = join(root, encodePiProjectPath(cwd, transport));
  const dirs = await readdir(root, { withFileTypes: true }).catch(() => []);
  const ordered = [
    ...(dirs.find((dir) => dir.isDirectory() && dir.name === basename(preferred))
      ? [basename(preferred)]
      : []),
    ...dirs
      .filter((dir) => dir.isDirectory() && dir.name !== basename(preferred))
      .map((dir) => dir.name),
  ];
  for (const dir of ordered) {
    const files = await readdir(join(root, dir), { withFileTypes: true }).catch(() => []);
    for (const file of files) {
      if (!file.isFile() || !file.name.endsWith(".jsonl")) continue;
      const fullPath = join(root, dir, file.name);
      const first = (await readJsonLines(fullPath, 10)).find((line) => line.type === "session");
      if (stringValue(first?.id) === sessionId || basename(file.name, ".jsonl") === sessionId) {
        return fullPath;
      }
    }
  }
  return null;
}

async function readClaudeSessionHistory(sessionId: string): Promise<TranscriptMessage[]> {
  const root = join(homedir(), ".claude", "projects");
  const dirs = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    const file = join(root, dir.name, `${sessionId}.jsonl`);
    const lines = await readJsonLines(file);
    if (lines.length > 0) return convertClaudeHistory(lines);
  }
  return [];
}

async function readPiSessionHistory(
  sessionId: string,
  cwd: string,
  transport: FileHistoryTransport,
): Promise<TranscriptMessage[]> {
  const file = await findPiSessionPath(sessionId, cwd, transport);
  if (!file) return [];
  return convertPiHistory(await readJsonLines(file));
}

async function readJsonLines(
  file: string,
  limit = Number.POSITIVE_INFINITY,
): Promise<Array<Record<string, unknown>>> {
  const values: Array<Record<string, unknown>> = [];
  const input = createReadStream(file, { encoding: "utf8" });
  const lines = createInterface({ input, crlfDelay: Number.POSITIVE_INFINITY });
  try {
    for await (const line of lines) {
      try {
        const value = asRecord(JSON.parse(line) as unknown);
        if (value) values.push(value);
      } catch {
        // Ignore an isolated malformed JSONL record and keep the usable history.
      }
      if (values.length >= limit) break;
    }
  } catch {
    return [];
  } finally {
    lines.close();
    input.destroy();
  }
  return values;
}

function encodePiProjectPath(value: string, transport: FileHistoryTransport): string {
  if (transport === "omp") {
    // omp 的会话目录名：`-` + 相对 $HOME 的路径（`/` 转 `-`），例如
    // /Users/me/Desktop/proj → -Desktop-proj。不在 $HOME 下时回退到全路径编码。
    const home = homedir();
    const relative = value.startsWith(`${home}/`) ? value.slice(home.length + 1) : value;
    return `-${relative.replace(/^\/+/, "").replaceAll("/", "-")}`;
  }
  return `--${value.replace(/^\/+/, "").replaceAll("/", "-")}--`;
}

async function readCodexSessionHistory(
  agent: AcpAgentConfig,
  threadId: string,
  cwd: string,
): Promise<TranscriptMessage[]> {
  const executable = resolveExecutable(agent.cliCommand || agent.command);
  if (!executable || !threadId) return [];
  const turns = await readCodexTurns(executable, threadId, cwd);
  return convertCodexThreadHistory(turns, { importImage: importCodexImageAttachment });
}

/** 把 codex user 消息里的 base64 图片持久化为网关标准附件（按内容去重）。 */
function importCodexImageAttachment(name: string, dataBase64: string): TranscriptAttachment | null {
  try {
    const bytes = Buffer.from(dataBase64, "base64");
    if (bytes.length === 0) return null;
    const stored = attachmentStore.importBytesDeduped(name || "image.png", bytes);
    return {
      reference: stored.reference,
      name: stored.name,
      isImage: stored.isImage,
      ...(stored.path ? { path: stored.path } : {}),
    };
  } catch (error) {
    console.error("[codex] image attachment import failed:", error);
    return null;
  }
}

/**
 * `thread/read` blocks while a thread has an active writer, so bound it well
 * below RPC_TIMEOUT_MS and let the `thread/turns/list` fallback take over for
 * sessions that are open in another Codex client. Unblocked reads return in
 * milliseconds.
 */
const CODEX_READ_TURNS_TIMEOUT_MS = 6_000;

/**
 * 读取一个已持久化 thread 的 turns。
 *
 * 优先级：`thread/read` → 本地 rollout 文件 → `thread/turns/list` 摘要。
 * app-server 的启动/握手失败（CLI 缺失、被本机包装脚本改写参数等）与
 * `thread/read` 阻塞（会话被另一个 Codex 客户端占用）都只降级、不中断：
 * rollout 是纯文件读取，与 app-server 无关，仍能拿到完整 turns（含图片）。
 *
 * 注意：这里只能传 codex CLI 自己的参数——`command`/`args` 是 ACP 桥接
 * （npx acp-extension-codex）的启动命令，透传给 CLI 会直接 usage 报错退出。
 */
async function readCodexTurns(
  executable: string,
  threadId: string,
  cwd: string,
): Promise<unknown[]> {
  const rpc = new JsonRpcProcess(executable, ["app-server", "--stdio"], cwd, () => {});
  try {
    try {
      await rpc.request("initialize", {
        clientInfo: { name: "open-chat", title: "Open Chat", version: "0.1.0" },
        capabilities: { experimentalApi: true },
      });
      rpc.notify("initialized", {});
      const response = await rpc.request(
        "thread/read",
        { threadId, includeTurns: true },
        CODEX_READ_TURNS_TIMEOUT_MS,
      );
      const thread = asRecord(response.result)?.thread;
      const turns = Array.isArray(asRecord(thread)?.turns)
        ? (asRecord(thread)?.turns as unknown[])
        : [];
      if (turns.length > 0) return turns;
    } catch (error) {
      console.error(
        `[codex] thread/read unavailable (app-server exited or another Codex client ` +
          `holds the session), falling back to local rollout: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    }
    // 回退 1：直接读本地 rollout 文件。app-server 不可用/被占用时也能拿到完整 turns。
    const rolloutTurns = await readCodexRolloutTurns(threadId);
    if (rolloutTurns.length > 0) return rolloutTurns;
    console.error(
      `[codex] local rollout read empty for ${threadId}, falling back to thread/turns/list`,
    );
    // 回退 2：分页列出 turn 摘要（需要 app-server 仍在线）。
    const summaryTurns = await listCodexTurns(rpc, threadId).catch(() => []);
    if (summaryTurns.length > 0) return summaryTurns;
    throw new Error(`Codex 会话 ${threadId} 历史读取失败（thread/read 与回退读取均无返回）`);
  } finally {
    rpc.close();
  }
}

/** Pages `thread/turns/list` (newest-first) and returns chronological turns. */
async function listCodexTurns(rpc: JsonRpcProcess, threadId: string): Promise<unknown[]> {
  const turns: unknown[] = [];
  const seen = new Set<string>();
  let cursor = "";
  for (let page = 0; page < 100; page += 1) {
    const response = await rpc.request("thread/turns/list", {
      threadId,
      limit: 100,
      sortDirection: "desc",
      ...(cursor ? { backwardsCursor: cursor } : {}),
    });
    const result = asRecord(response.result) ?? {};
    const pageTurns = Array.isArray(result.data) ? (result.data as unknown[]) : [];
    for (const turn of pageTurns) {
      const id = stringValue(asRecord(turn)?.id);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      turns.push(turn);
    }
    cursor = stringValue(result.backwardsCursor);
    if (!cursor || pageTurns.length < 100) break;
  }
  // History adapters expect chronological order; `thread/turns/list` desc is newest-first.
  return turns.reverse();
}

/**
 * 历史读取专用的 Codex app-server JSON-RPC 客户端（newline-delimited）。
 * 仅用于读取持久化 thread；实时回合不走此协议。
 */
class JsonRpcProcess {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<
    string,
    {
      resolve: (value: Record<string, unknown>) => void;
      reject: (error: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();
  private nextId = 1;

  constructor(
    executable: string,
    args: string[],
    cwd: string,
    onNotification: (message: Record<string, unknown>) => void,
  ) {
    this.child = spawn(executable, args, {
      cwd,
      ...cliSpawnOptions(executable),
      stdio: ["pipe", "pipe", "pipe"],
    });
    // app-server 先退出时后续写入会 EPIPE；请求本身的失败由 failAll 上报。
    this.child.stdin.on("error", () => {});
    let buffer = "";
    this.child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
        if (!line) continue;
        let message: Record<string, unknown>;
        try {
          message = JSON.parse(line) as Record<string, unknown>;
        } catch {
          continue;
        }
        const id = rpcId(message.id);
        if (id && this.pending.has(id)) {
          const entry = this.pending.get(id)!;
          this.pending.delete(id);
          clearTimeout(entry.timer);
          if (message.error) {
            entry.reject(new Error(stringValue(message.error) || "Codex app-server RPC 错误"));
          } else {
            entry.resolve(message);
          }
        } else {
          onNotification(message);
        }
      }
    });
    this.child.on("error", (error) => {
      this.failAll(error);
    });
    this.child.on("exit", (code, signal) => {
      this.failAll(new Error(`Codex app-server 进程已退出（${signal || `code ${code}`}）`));
    });
  }

  request(
    method: string,
    params: Record<string, unknown>,
    timeoutMs = RPC_TIMEOUT_MS,
  ): Promise<Record<string, unknown>> {
    const id = String(this.nextId++);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex app-server RPC 超时：${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(`${JSON.stringify({ id: Number(id), method, params })}\n`);
    });
  }

  notify(method: string, params: Record<string, unknown>): void {
    this.child.stdin.write(`${JSON.stringify({ method, params })}\n`);
  }

  close(): void {
    this.child.kill("SIGTERM");
  }

  private failAll(error: Error): void {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.pending.clear();
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function rpcId(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

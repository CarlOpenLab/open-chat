/**
 * Codex 会话 rollout 文件的本地读取器。
 *
 * `codex app-server` 的 `thread/read` 在会话被其他客户端（终端、桌面 App、
 * 另一个 app-server）占用时会一直阻塞。rollout 是 codex 在磁盘上按行追加的
 * JSONL（`~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<threadId>.jsonl`），即使
 * 会话正被写入也可安全读取，并且包含完整的 `input_image` 字节。这里把 rollout
 * 解析成与 `thread/read` 相同的 turns 形状，供 codex 历史适配器复用。
 */
import { randomUUID } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { asRecord, stringValue } from "./transcript/value";

/** `~/.codex/sessions/YYYY/MM/DD` 的目录深度。 */
const SESSION_DIR_DEPTH = 3;

/** 按线程 id 找到最常更新的 rollout 文件（可能有多份/被 compact 重写）。 */
export async function findCodexRolloutFile(threadId: string): Promise<string | null> {
  if (!threadId) return null;
  const codexHome = process.env.CODEX_HOME?.trim() || join(homedir(), ".codex");
  const root = join(codexHome, "sessions");
  const suffix = `-${threadId}.jsonl`;
  const matches: Array<{ file: string; mtime: number }> = [];
  const scan = async (dir: string, depth: number): Promise<void> => {
    if (depth > SESSION_DIR_DEPTH) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        await scan(join(dir, entry.name), depth + 1);
      } else if (entry.isFile() && entry.name.endsWith(suffix)) {
        const file = join(dir, entry.name);
        const info = await stat(file).catch(() => null);
        matches.push({ file, mtime: info?.mtimeMs ?? 0 });
      }
    }
  };
  await scan(root, 0);
  if (matches.length === 0) return null;
  matches.sort((left, right) => right.mtime - left.mtime);
  return matches[0]?.file ?? null;
}

/** 读取并解析线程的 rollout 为 turns；找不到文件或读取失败时返回空数组。 */
export async function readCodexRolloutTurns(threadId: string): Promise<unknown[]> {
  const file = await findCodexRolloutFile(threadId);
  if (!file) return [];
  const content = await readFile(file, "utf8").catch(() => "");
  return parseCodexRollout(content);
}

/**
 * 解析 rollout 文本为 turns 数组，形状与 `thread/read` 的
 * `[{ id, items }]` 一致，供 `convertCodexThreadHistory` 使用。
 * 未知/不支持的类型被安全跳过。
 */
export function parseCodexRollout(content: string): unknown[] {
  const turnsById = new Map<string, unknown[]>();
  const order: string[] = [];
  const turnFor = (id: string): unknown[] => {
    let items = turnsById.get(id);
    if (!items) {
      items = [];
      turnsById.set(id, items);
      order.push(id);
    }
    return items;
  };

  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    let record: Record<string, unknown>;
    try {
      record = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue; // 写入中的末尾半行
    }
    if (record.type !== "response_item") continue;
    const payload = asRecord(record.payload);
    if (!payload) continue;
    const ptype = stringValue(payload.type);
    const passthrough = asRecord(payload.internal_chat_message_metadata_passthrough);
    const turnId = stringValue(payload.turn_id) || stringValue(passthrough?.turn_id);
    if (!turnId) continue;
    const items = turnFor(turnId);
    const id = stringValue(payload.id) || randomUUID();
    // codex 每条 response_item 记录带顶层 timestamp（epoch 秒），透传给适配器。
    const timestamp = record.timestamp;

    if (ptype === "message") {
      const role = stringValue(payload.role);
      if (role === "user") {
        items.push({ id, timestamp, type: "userMessage", content: payload.content });
      } else if (role === "assistant") {
        items.push({ id, timestamp, type: "agentMessage", text: outputText(payload.content) });
      }
      // developer / system：系统上下文，不作为对话内容。
    } else if (ptype === "reasoning") {
      items.push({ id, timestamp, type: "reasoning", summary: payload.summary });
    } else if (
      ptype === "custom_tool_call" ||
      ptype === "function_call" ||
      ptype === "local_shell_call"
    ) {
      items.push({
        id: stringValue(payload.call_id) || id,
        timestamp,
        type: "commandExecution",
        name: stringValue(payload.name) || ptype,
        status: stringValue(payload.status) || "completed",
        callId: stringValue(payload.call_id),
        arguments: payload.arguments ?? payload.input,
      });
    } else if (ptype === "web_search") {
      items.push({
        id,
        timestamp,
        type: "webSearch",
        name: "web_search",
        status: stringValue(payload.status) || "completed",
      });
    } else if (ptype === "file_change") {
      items.push({
        id,
        timestamp,
        type: "fileChange",
        name: "file_change",
        status: stringValue(payload.status) || "completed",
        input: payload.changes ?? payload.file_changes,
      });
    }
    // function_call_output / custom_tool_call_output 等结果记录忽略，工具活动按调用合并。
  }

  return order.map((id) => ({ id, items: turnsById.get(id) }));
}

function outputText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      const record = asRecord(part);
      return stringValue(record?.text);
    })
    .filter(Boolean)
    .join("\n");
}

/**
 * 网关侧状态持久化：Web UI 的结构化状态（任务看板、会话索引、看板筛选、
 * 项目历史）整体落在数据根目录 `~/.cc-hearts-open-code/state/<name>.json`。
 *
 * 这样浏览器保持无状态：局域网内任意设备打开同一网关看到的是同一份数据，
 * 换浏览器 / 清站点数据不再丢任务。约定：
 * - 写入先落 `.tmp` 再原子 rename，进程中断不留半截文件；
 * - 更新以整体覆盖为准（last-write-wins）：浏览器侧已有防抖合并，
 *   单用户单网关场景足够；
 * - 状态名走白名单，杜绝路径穿越；
 * - 每个文件一个 `{ updatedAt, data }` 信封，便于排查与将来做版本协商。
 */
import fs from "node:fs";
import path from "node:path";
import { dataRootDir } from "./attachments";

const STATE_DIR_NAME = "state";

/** 允许持久化的状态名白名单。 */
const ALLOWED_STATE_NAMES = new Set([
  "chat-state",
  "tasks",
  "task-filters",
  "project-paths",
  "providers",
  "board-assistant",
]);

export interface StoredStateEnvelope {
  updatedAt: number;
  data: unknown;
}

function stateDir(): string {
  return path.join(dataRootDir(), STATE_DIR_NAME);
}

function stateFile(name: string): string {
  return path.join(stateDir(), `${name}.json`);
}

export function isAllowedStateName(name: string): boolean {
  return ALLOWED_STATE_NAMES.has(name);
}

/** 读取状态；不存在或损坏返回 null（不抛）。 */
export function readState(name: string): StoredStateEnvelope | null {
  if (!isAllowedStateName(name)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(stateFile(name), "utf8")) as StoredStateEnvelope;
    if (!parsed || typeof parsed !== "object" || !("data" in parsed)) return null;
    return {
      updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : 0,
      data: parsed.data,
    };
  } catch {
    return null;
  }
}

/** 整体覆盖写入；状态名不在白名单时抛错（路由层先校验，双保险）。 */
export function writeState(name: string, data: unknown): StoredStateEnvelope {
  if (!isAllowedStateName(name)) throw new Error(`Unknown state: ${name}`);
  fs.mkdirSync(stateDir(), { recursive: true });
  const envelope: StoredStateEnvelope = { updatedAt: Date.now(), data };
  const file = stateFile(name);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(envelope), "utf8");
  fs.renameSync(tmp, file);
  return envelope;
}

/** 删除状态文件（清除后回到「未初始化」，客户端可再次迁移/重建）。 */
export function deleteState(name: string): void {
  if (!isAllowedStateName(name)) throw new Error(`Unknown state: ${name}`);
  fs.rmSync(stateFile(name), { force: true });
}

/**
 * 看板任务的网关侧 REST 操作：为看板 AI 助手（本地 ACP agent 经 curl 调用）
 * 提供任务 CRUD。校验规则镜像前端 `apps/website/src/services/taskStorage.ts`
 * 的 normalizeTask，保证 agent 写入的数据与手动创建的任务同构。
 *
 * 存储复用 stateStore 的 "tasks" 状态（与浏览器看板共享同一份数据），
 * 读-改-写整体覆盖（last-write-wins，与浏览器侧 saveTasks 语义一致）。
 */
import { randomBytes } from "node:crypto";
import { readState, writeState } from "./stateStore";

/** 与前端 taskStorage 的 Task 同构（保持字段约束一致）。 */
export interface BoardTask {
  id: string;
  title: string;
  status: "todo" | "doing" | "review" | "done" | "archived";
  priority: "P0" | "P1" | "P2" | "P3" | null;
  tags: string[];
  dueAt: number | null;
  description: string;
  projectPath: string | null;
  createdAt: number;
  updatedAt: number;
  sessionKeys: string[];
}

const TASK_STATUSES = new Set(["todo", "doing", "review", "done", "archived"]);
const TASK_PRIORITIES = new Set(["P0", "P1", "P2", "P3"]);

function nanoid(size = 12): string {
  const chars = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const bytes = randomBytes(size);
  let out = "";
  for (let i = 0; i < size; i += 1) out += chars[bytes[i] % chars.length];
  return out;
}

function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const tag = item.trim().slice(0, 30);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    result.push(tag);
  }
  return result;
}

function normalizeProjectPath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, 500);
  return trimmed ? trimmed : null;
}

function normalizeDueAt(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function readTasks(): BoardTask[] {
  const envelope = readState("tasks");
  const data = envelope?.data;
  if (!Array.isArray(data)) return [];
  return data.filter((item): item is BoardTask => Boolean(normalizeTask(item)));
}

function writeTasks(tasks: BoardTask[]): void {
  writeState("tasks", JSON.parse(JSON.stringify(tasks)) as BoardTask[]);
}

/** 校验并规范化一条任务记录；字段不合法时按前端同样的回退规则修正。 */
export function normalizeTask(value: unknown): BoardTask | null {
  if (!value || typeof value !== "object") return null;
  const obj = value as Record<string, unknown>;
  const id = typeof obj.id === "string" && obj.id.trim() ? obj.id.trim().slice(0, 64) : "";
  if (!id) return null;
  const rawStatus = typeof obj.status === "string" ? obj.status : "";
  const status = TASK_STATUSES.has(rawStatus) ? (rawStatus as BoardTask["status"]) : "todo";
  const rawPriority = typeof obj.priority === "string" ? obj.priority : "";
  const priority = TASK_PRIORITIES.has(rawPriority) ? (rawPriority as BoardTask["priority"]) : null;
  const createdAt =
    typeof obj.createdAt === "number" && Number.isFinite(obj.createdAt)
      ? obj.createdAt
      : Date.now();
  return {
    id,
    title:
      typeof obj.title === "string" && obj.title.trim()
        ? obj.title.trim().slice(0, 200)
        : "未命名任务",
    status,
    priority,
    tags: normalizeTags(obj.tags),
    dueAt: normalizeDueAt(obj.dueAt),
    description: typeof obj.description === "string" ? obj.description.slice(0, 8000) : "",
    projectPath: normalizeProjectPath(obj.projectPath),
    createdAt,
    updatedAt:
      typeof obj.updatedAt === "number" && Number.isFinite(obj.updatedAt)
        ? obj.updatedAt
        : createdAt,
    sessionKeys: Array.isArray(obj.sessionKeys)
      ? obj.sessionKeys.filter((k): k is string => typeof k === "string" && k.trim().length > 0)
      : [],
  };
}

/** 从创建/更新请求体提取合法字段（未提供的字段不进入结果）。 */
function extractPatch(body: unknown): Partial<Omit<BoardTask, "id" | "createdAt">> | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const obj = body as Record<string, unknown>;
  const patch: Partial<Omit<BoardTask, "id" | "createdAt">> = {};
  if ("title" in obj) {
    if (typeof obj.title !== "string") return null;
    patch.title = obj.title.trim().slice(0, 200) || "未命名任务";
  }
  if ("status" in obj) {
    if (typeof obj.status !== "string" || !TASK_STATUSES.has(obj.status)) return null;
    patch.status = obj.status as BoardTask["status"];
  }
  if ("priority" in obj) {
    if (obj.priority !== null) {
      if (typeof obj.priority !== "string" || !TASK_PRIORITIES.has(obj.priority)) return null;
      patch.priority = obj.priority as BoardTask["priority"];
    } else {
      patch.priority = null;
    }
  }
  if ("tags" in obj) {
    if (!Array.isArray(obj.tags)) return null;
    patch.tags = normalizeTags(obj.tags);
  }
  if ("dueAt" in obj) patch.dueAt = normalizeDueAt(obj.dueAt);
  if ("description" in obj) {
    if (typeof obj.description !== "string") return null;
    patch.description = obj.description.slice(0, 8000);
  }
  if ("projectPath" in obj) patch.projectPath = normalizeProjectPath(obj.projectPath);
  return patch;
}

export function listBoardTasks(): BoardTask[] {
  return readTasks().sort((a, b) => b.updatedAt - a.updatedAt);
}

/** 创建任务；请求体至少要能给出 title。返回 null 表示请求体非法。 */
export function createBoardTask(body: unknown): BoardTask | null {
  const patch = extractPatch(body);
  if (!patch || patch.title === undefined) return null;
  const now = Date.now();
  const task: BoardTask = {
    id: nanoid(),
    title: patch.title,
    status: patch.status ?? "todo",
    priority: patch.priority ?? null,
    tags: patch.tags ?? [],
    dueAt: patch.dueAt ?? null,
    description: patch.description ?? "",
    projectPath: patch.projectPath ?? null,
    createdAt: now,
    updatedAt: now,
    sessionKeys: [],
  };
  writeTasks([task, ...readTasks()]);
  return task;
}

/** 更新任务；不存在返回 undefined，请求体非法返回 null。 */
export function patchBoardTask(id: string, body: unknown): BoardTask | undefined | null {
  const patch = extractPatch(body);
  if (!patch) return null;
  const tasks = readTasks();
  const index = tasks.findIndex((task) => task.id === id);
  if (index < 0) return undefined;
  const current = tasks[index];
  const next: BoardTask = {
    ...current,
    ...patch,
    id: current.id,
    createdAt: current.createdAt,
    updatedAt: Date.now(),
  };
  tasks[index] = next;
  writeTasks(tasks);
  return next;
}

/** 删除任务；返回是否删除成功（任务存在）。 */
export function deleteBoardTask(id: string): boolean {
  const tasks = readTasks();
  const next = tasks.filter((task) => task.id !== id);
  if (next.length === tasks.length) return false;
  writeTasks(next);
  return true;
}

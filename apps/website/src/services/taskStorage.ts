import {
  deleteTaskValue,
  readAllTasks,
  readLocalValue,
  writeLocalValue,
  writeTaskValue,
  clearAllTasks,
} from "./localDatabase";
import {
  isTaskStatus,
  normalizeTaskPriority,
  normalizeTaskStatus,
  type TaskPriority,
  type TaskStatus,
} from "../utils/taskStatus";

export interface Task {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  tags: string[];
  dueAt: number | null;
  description: string;
  projectPath: string | null;
  createdAt: number;
  updatedAt: number;
  sessionKeys: string[];
}

export type TaskTemplateId = "blank" | "bug" | "feature" | "refactor";

export const TASK_TEMPLATES: Record<
  TaskTemplateId,
  { title: string; tags: string[]; description: string }
> = {
  blank: { title: "", tags: [], description: "" },
  bug: {
    title: "修复：",
    tags: ["bug"],
    description: "## 现象\n\n## 预期\n\n## 复现步骤\n1. \n",
  },
  feature: {
    title: "功能：",
    tags: ["feature"],
    description: "## 背景\n\n## 需求\n\n## 验收标准\n- [ ] \n",
  },
  refactor: {
    title: "重构：",
    tags: ["refactor"],
    description: "## 动机\n\n## 范围\n\n## 风险\n\n",
  },
};

const TASK_FILTER_KEY = "task-board-filters-v1";

export interface TaskBoardFilters {
  search: string;
  priority: TaskPriority[];
  tags: string[];
  projectPath: string | null;
  status: TaskStatus[];
  sortBy: "updatedAt" | "dueAt" | "priority" | "createdAt";
  sortDir: "desc" | "asc";
}

export const DEFAULT_TASK_FILTERS: TaskBoardFilters = {
  search: "",
  priority: [],
  tags: [],
  projectPath: null,
  status: [],
  sortBy: "updatedAt",
  sortDir: "desc",
};

function nanoid(size = 12): string {
  const chars = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let out = "";
  const arr = new Uint8Array(size);
  crypto.getRandomValues(arr);
  for (let i = 0; i < size; i += 1) out += chars[arr[i] % chars.length];
  return out;
}

function normalizeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of tags) {
    if (typeof item !== "string") continue;
    const t = item.trim().slice(0, 30);
    if (!t || seen.has(t)) continue;
    seen.add(t);
    result.push(t);
  }
  return result;
}

function normalizeProjectPath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim().slice(0, 500);
  return t ? t : null;
}

export function normalizeTask(value: unknown): Task | null {
  if (!value || typeof value !== "object") return null;
  const obj = value as Record<string, unknown>;
  const id = typeof obj.id === "string" && obj.id.trim() ? obj.id.trim().slice(0, 64) : "";
  if (!id) return null;
  const title = typeof obj.title === "string" ? obj.title.slice(0, 200) : "";
  const status = isTaskStatus(obj.status) ? obj.status : "todo";
  const priority = normalizeTaskPriority(obj.priority);
  const tags = normalizeTags(obj.tags);
  const dueAt =
    typeof obj.dueAt === "number" && Number.isFinite(obj.dueAt) && obj.dueAt > 0 ? obj.dueAt : null;
  const description = typeof obj.description === "string" ? obj.description.slice(0, 8000) : "";
  const projectPath = normalizeProjectPath(obj.projectPath);
  const createdAt =
    typeof obj.createdAt === "number" && Number.isFinite(obj.createdAt)
      ? obj.createdAt
      : Date.now();
  const updatedAt =
    typeof obj.updatedAt === "number" && Number.isFinite(obj.updatedAt) ? obj.updatedAt : createdAt;
  const sessionKeys = Array.isArray(obj.sessionKeys)
    ? obj.sessionKeys
        .filter((k): k is string => typeof k === "string" && k.trim().length > 0)
        .slice(0, 200)
    : [];
  return {
    id,
    title: title.trim() ? title : "未命名任务",
    status,
    priority,
    tags,
    dueAt,
    description,
    projectPath,
    createdAt,
    updatedAt,
    sessionKeys,
  };
}

export function createTaskInput(
  overrides: Partial<Task> & { templateId?: TaskTemplateId } = {},
): Task {
  const now = Date.now();
  const template = overrides.templateId ? TASK_TEMPLATES[overrides.templateId] : undefined;
  const baseTitle = overrides.title ?? template?.title ?? "";
  const baseTags = overrides.tags ?? template?.tags ?? [];
  const baseDesc = overrides.description ?? template?.description ?? "";
  return {
    id: overrides.id ?? nanoid(),
    title: (baseTitle || "未命名任务").slice(0, 200),
    status: normalizeTaskStatus(overrides.status, "todo"),
    priority: normalizeTaskPriority(overrides.priority),
    tags: normalizeTags(baseTags),
    dueAt: typeof overrides.dueAt === "number" && overrides.dueAt > 0 ? overrides.dueAt : null,
    description: typeof baseDesc === "string" ? baseDesc.slice(0, 8000) : "",
    projectPath: normalizeProjectPath(overrides.projectPath),
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
    sessionKeys: Array.isArray(overrides.sessionKeys) ? [...overrides.sessionKeys] : [],
  };
}

export async function loadTasks(): Promise<Task[]> {
  try {
    const raw = await readAllTasks<unknown>();
    if (Array.isArray(raw) && raw.length > 0) {
      const normalized = raw.map(normalizeTask).filter((t): t is Task => Boolean(t));
      // fallback to legacy array stored in app-state if tasks store still empty but legacy exists
      if (normalized.length > 0) return normalized.sort((a, b) => b.updatedAt - a.updatedAt);
    }
  } catch {
    // ignore, fallback to legacy
  }
  try {
    const legacy = await readLocalValue<unknown>("tasks-v1");
    if (Array.isArray(legacy)) {
      const normalized = legacy.map(normalizeTask).filter((t): t is Task => Boolean(t));
      if (normalized.length > 0) {
        // migrate legacy to new store
        for (const t of normalized) {
          try {
            await writeTaskValue(t);
          } catch {
            // ignore
          }
        }
        return normalized.sort((a, b) => b.updatedAt - a.updatedAt);
      }
    }
  } catch {
    // ignore
  }
  return [];
}

export async function saveTasks(tasks: Task[]): Promise<void> {
  // write through both stores for compatibility
  const plain = JSON.parse(JSON.stringify(tasks)) as Task[];
  await writeLocalValue("tasks-v1", plain);
  // also sync to object store (clear + put)
  try {
    await clearAllTasks();
    for (const t of plain) {
      await writeTaskValue(t);
    }
  } catch {
    // ignore task store sync error, legacy still has data
  }
}

export async function putTask(task: Task): Promise<void> {
  const normalized = normalizeTask(task);
  if (!normalized) throw new Error("Invalid task");
  normalized.updatedAt = Date.now();
  await writeTaskValue(normalized);
  // keep legacy array in sync
  try {
    const all = await loadTasks();
    const idx = all.findIndex((t) => t.id === normalized.id);
    if (idx >= 0) all[idx] = normalized;
    else all.unshift(normalized);
    await writeLocalValue("tasks-v1", JSON.parse(JSON.stringify(all)));
  } catch {
    // ignore
  }
}

export async function removeTask(id: string): Promise<void> {
  await deleteTaskValue(id);
  try {
    const all = await readLocalValue<Task[]>("tasks-v1");
    if (Array.isArray(all)) {
      const next = all.filter((t) => t.id !== id);
      await writeLocalValue("tasks-v1", JSON.parse(JSON.stringify(next)));
    }
  } catch {
    // ignore
  }
}

export function updateTaskInList(
  tasks: Task[],
  id: string,
  patch: Partial<Omit<Task, "id" | "createdAt">> & { projectPathImmutableCheck?: boolean },
): Task[] {
  const idx = tasks.findIndex((t) => t.id === id);
  if (idx < 0) return tasks;
  const current = tasks[idx];
  if (patch.projectPath !== undefined && patch.projectPath !== current.projectPath) {
    // projectPath immutable after creation
    throw new Error("projectPath immutable after creation");
  }
  const next: Task = {
    ...current,
    ...(patch.title !== undefined
      ? { title: patch.title.slice(0, 200).trim() || "未命名任务" }
      : {}),
    ...(patch.status !== undefined ? { status: normalizeTaskStatus(patch.status) } : {}),
    ...(patch.priority !== undefined ? { priority: normalizeTaskPriority(patch.priority) } : {}),
    ...(patch.tags !== undefined ? { tags: normalizeTags(patch.tags) } : {}),
    ...(patch.dueAt !== undefined
      ? { dueAt: patch.dueAt && patch.dueAt > 0 ? patch.dueAt : null }
      : {}),
    ...(patch.description !== undefined ? { description: patch.description.slice(0, 8000) } : {}),
    ...(patch.sessionKeys !== undefined ? { sessionKeys: [...patch.sessionKeys] } : {}),
    updatedAt: Date.now(),
  };
  const copy = [...tasks];
  copy[idx] = next;
  return copy;
}

export async function loadTaskFilters(): Promise<TaskBoardFilters> {
  try {
    const raw = await readLocalValue<Partial<TaskBoardFilters>>(TASK_FILTER_KEY);
    if (!raw || typeof raw !== "object") return { ...DEFAULT_TASK_FILTERS };
    return {
      search: typeof raw.search === "string" ? raw.search.slice(0, 200) : "",
      priority: Array.isArray(raw.priority)
        ? (raw.priority.filter(
            (p) => p === "P0" || p === "P1" || p === "P2" || p === "P3",
          ) as TaskPriority[])
        : [],
      tags: Array.isArray(raw.tags) ? normalizeTags(raw.tags) : [],
      projectPath:
        typeof raw.projectPath === "string" && raw.projectPath.trim()
          ? raw.projectPath.trim()
          : null,
      status: Array.isArray(raw.status) ? raw.status.filter(isTaskStatus) : [],
      sortBy:
        raw.sortBy === "dueAt" || raw.sortBy === "priority" || raw.sortBy === "createdAt"
          ? raw.sortBy
          : "updatedAt",
      sortDir: raw.sortDir === "asc" ? "asc" : "desc",
    };
  } catch {
    return { ...DEFAULT_TASK_FILTERS };
  }
}

export async function saveTaskFilters(filters: TaskBoardFilters): Promise<void> {
  await writeLocalValue(TASK_FILTER_KEY, JSON.parse(JSON.stringify(filters)));
}

export function duplicateTask(task: Task): Task {
  const now = Date.now();
  return {
    ...task,
    id: nanoid(),
    title: task.title ? `${task.title} (副本)` : "未命名任务 (副本)",
    status: "todo",
    sessionKeys: [],
    createdAt: now,
    updatedAt: now,
  };
}

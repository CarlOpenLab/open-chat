/**
 * 人任务状态（Task）—— 与 AI 会话的 SessionStatus 解耦
 * 看板按此分列；AI 的 running/permission 等仅作卡片内徽标
 */
export type TaskStatus = "todo" | "doing" | "review" | "done" | "archived";
export type TaskPriority = "P0" | "P1" | "P2" | "P3" | null;

export const TASK_STATUS_ORDER: TaskStatus[] = ["todo", "doing", "review", "done", "archived"];

export const TASK_STATUS_META: Record<TaskStatus, { name: string; hint: string }> = {
  todo: { name: "待办", hint: "待开始" },
  doing: { name: "进行中", hint: "任务执行中" },
  review: { name: "待验收", hint: "AI 已交付待人验收" },
  done: { name: "已完成", hint: "已验收" },
  archived: { name: "已归档", hint: "已沉淀" },
};

export const TASK_PRIORITY_ORDER: Exclude<TaskPriority, null>[] = ["P0", "P1", "P2", "P3"];

export const TASK_PRIORITY_META: Record<
  Exclude<TaskPriority, null>,
  { label: string; color: string }
> = {
  P0: { label: "P0 紧急", color: "#ef4444" },
  P1: { label: "P1 高", color: "#f97316" },
  P2: { label: "P2 中", color: "#3b82f6" },
  P3: { label: "P3 低", color: "#9ca3af" },
};

export interface TaskStatusInput {
  status?: TaskStatus;
}

export function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === "string" && (TASK_STATUS_ORDER as string[]).includes(value);
}

export function normalizeTaskStatus(value: unknown, fallback: TaskStatus = "todo"): TaskStatus {
  return isTaskStatus(value) ? value : fallback;
}

export function isTaskPriority(value: unknown): value is TaskPriority {
  if (value === null) return true;
  return typeof value === "string" && (TASK_PRIORITY_ORDER as string[]).includes(value);
}

export function normalizeTaskPriority(value: unknown): TaskPriority {
  if (value === null) return null;
  if (typeof value === "string" && (TASK_PRIORITY_ORDER as string[]).includes(value))
    return value as TaskPriority;
  return null;
}

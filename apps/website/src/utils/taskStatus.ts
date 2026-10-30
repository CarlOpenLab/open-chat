/**
 * 任务（人）的状态与优先级展示元数据 —— 与 AI 会话的 SessionStatus 解耦：
 * 看板按任务状态分列；AI 的 running / permission 等只作为卡片内徽标。
 * 类型与枚举定义在共享包，前后端使用同一份。
 */
import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  type TaskPriorityLevel,
  type TaskStatus,
} from "@cc-heart/open-chat-types";

export type { TaskPriority, TaskPriorityLevel, TaskStatus } from "@cc-heart/open-chat-types";

export const TASK_STATUS_ORDER: readonly TaskStatus[] = TASK_STATUSES;

export const TASK_STATUS_META: Record<TaskStatus, { name: string; hint: string; color: string }> = {
  todo: { name: "待办", hint: "待开始", color: "var(--oc-status-todo)" },
  doing: { name: "进行中", hint: "任务执行中", color: "var(--oc-status-doing)" },
  review: { name: "待验收", hint: "AI 已交付待人验收", color: "var(--oc-status-review)" },
  done: { name: "已完成", hint: "已验收", color: "var(--oc-status-done)" },
  archived: { name: "已归档", hint: "已沉淀", color: "var(--oc-status-archived)" },
};

export const TASK_PRIORITY_ORDER: readonly TaskPriorityLevel[] = TASK_PRIORITIES;

export const TASK_PRIORITY_META: Record<TaskPriorityLevel, { label: string; color: string }> = {
  P0: { label: "P0 紧急", color: "var(--oc-priority-p0)" },
  P1: { label: "P1 高", color: "var(--oc-priority-p1)" },
  P2: { label: "P2 中", color: "var(--oc-priority-p2)" },
  P3: { label: "P3 低", color: "var(--oc-priority-p3)" },
};

export type TaskTemplateId = "blank" | "bug" | "feature" | "refactor";

/** 新建任务模板：预填标题前缀、标签与 markdown 备注骨架。 */
export const TASK_TEMPLATES: Record<
  TaskTemplateId,
  { label: string; title: string; tags: string[]; description: string }
> = {
  blank: { label: "空白任务", title: "", tags: [], description: "" },
  bug: {
    label: "修 Bug",
    title: "修复：",
    tags: ["bug"],
    description: "## 现象\n\n## 预期\n\n## 复现步骤\n1. \n",
  },
  feature: {
    label: "新功能",
    title: "功能：",
    tags: ["feature"],
    description: "## 背景\n\n## 需求\n\n## 验收标准\n- [ ] \n",
  },
  refactor: {
    label: "重构",
    title: "重构：",
    tags: ["refactor"],
    description: "## 动机\n\n## 范围\n\n## 风险\n\n",
  },
};

/**
 * @description 判断字符串是否为模板 id。
 * @param {unknown} value - 待检查的值
 * @returns {boolean} 是已知模板时为 true
 */
export function isTaskTemplateId(value: unknown): value is TaskTemplateId {
  return typeof value === "string" && value in TASK_TEMPLATES;
}

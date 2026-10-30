/**
 * 任务看板存储（tasks 表）。
 *
 * 任务与会话的关联不在任务上冗余保存：会话行的 task_id 是唯一事实来源，
 * `sessionKeys` 读取时由会话派生（按会话创建时间升序，已归档会话不计入）。
 * 删除任务时外键 ON DELETE SET NULL 自动解除关联，会话本身保留。
 */
import {
  TASK_LIMITS,
  UNTITLED_TASK,
  isTaskPriorityLevel,
  isTaskStatus,
  normalizeTaskTags,
  type Task,
  type TaskCreateInput,
  type TaskInput,
  type TaskPriority,
  type TaskStatus,
} from "@cc-heart/open-chat-types";
import { GatewayError } from "../error";
import { parseJsonColumn, type Database } from "../db/database";
import { createId, isValidClientId } from "./ids";

interface TaskRow {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  tags: string;
  due_at: number | null;
  description: string;
  project_path: string | null;
  created_at: number;
  updated_at: number;
}

/** 已规范化、可直接写库的任务字段（不含派生的 sessionKeys）。 */
export type TaskRecord = Omit<Task, "sessionKeys">;

/**
 * @description 规范化标题：去首尾空白、截断，空标题回落为「未命名任务」。
 * @param {string} value - 原始标题
 * @returns {string} 可持久化的标题
 */
function normalizeTitle(value: string): string {
  return value.trim().slice(0, TASK_LIMITS.title) || UNTITLED_TASK;
}

/**
 * @description 规范化项目目录：非字符串或空串视为未关联。
 * @param {unknown} value - 原始目录
 * @returns {string | null} 截断后的目录或 null
 */
function normalizeProjectPath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, TASK_LIMITS.projectPath);
  return trimmed || null;
}

/**
 * @description 规范化截止时间：只接受正的有限数，其余视为无截止。
 * @param {unknown} value - 原始时间戳
 * @returns {number | null} epoch 毫秒或 null
 */
function normalizeDueAt(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * @description 从请求体提取任务的可写字段：出现的字段必须类型合法，未出现的字段不进入结果。
 * 规则与看板 AI 助手文档一致：枚举非法 / 类型错误整体拒绝，长度超限与空值按约定修正。
 * @param {unknown} body - 请求体
 * @returns {TaskInput} 规范化后的字段集合
 * @throws {GatewayError} 请求体不是对象或包含非法字段时抛出 400
 */
export function parseTaskInput(body: unknown): TaskInput {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw GatewayError.invalidRequest("请求体必须是 JSON 对象");
  }
  const obj = body as Record<string, unknown>;
  const input: TaskInput = {};
  if ("title" in obj) {
    if (typeof obj.title !== "string") throw GatewayError.invalidRequest("title 必须是字符串");
    input.title = normalizeTitle(obj.title);
  }
  if ("status" in obj) {
    if (!isTaskStatus(obj.status)) {
      throw GatewayError.invalidRequest("status 必须是 todo / doing / review / done / archived");
    }
    input.status = obj.status;
  }
  if ("priority" in obj) {
    if (obj.priority !== null && !isTaskPriorityLevel(obj.priority)) {
      throw GatewayError.invalidRequest("priority 必须是 P0 / P1 / P2 / P3 或 null");
    }
    input.priority = obj.priority;
  }
  if ("tags" in obj) {
    if (!Array.isArray(obj.tags)) throw GatewayError.invalidRequest("tags 必须是字符串数组");
    input.tags = normalizeTaskTags(obj.tags);
  }
  if ("dueAt" in obj) input.dueAt = normalizeDueAt(obj.dueAt);
  if ("description" in obj) {
    if (typeof obj.description !== "string") {
      throw GatewayError.invalidRequest("description 必须是字符串");
    }
    input.description = obj.description.slice(0, TASK_LIMITS.description);
  }
  if ("projectPath" in obj) input.projectPath = normalizeProjectPath(obj.projectPath);
  return input;
}

/**
 * @description 解析新建任务请求体：在可写字段之外要求 title，并校验可选的客户端 id。
 * @param {unknown} body - 请求体
 * @returns {TaskCreateInput} 规范化后的新建参数
 * @throws {GatewayError} 缺少 title、字段非法或 id 格式错误时抛出 400
 */
export function parseTaskCreateInput(body: unknown): TaskCreateInput {
  const input: TaskCreateInput = parseTaskInput(body);
  if (input.title === undefined) throw GatewayError.invalidRequest("请求体需包含 title 字段");
  const id = (body as Record<string, unknown>).id;
  if (id !== undefined) {
    if (!isValidClientId(id)) {
      throw GatewayError.invalidRequest("id 只能包含字母、数字、- 与 _，且不超过 64 个字符");
    }
    input.id = id;
  }
  return input;
}

/**
 * @description 宽松规范化旧数据中的任务（JSON 状态文件 / 浏览器 IndexedDB），字段非法时回落默认值。
 * 旧版把截止日期存成 UTC 零点，本地时区当天就会被判逾期：识别后迁移为本地当天 23:59:59.999。
 * @param {unknown} value - 旧任务对象
 * @returns {TaskRecord | null} 规范化后的记录；缺少 id 时返回 null
 */
export function normalizeLegacyTask(value: unknown): TaskRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  const rawId = typeof obj.id === "string" ? obj.id.trim().slice(0, TASK_LIMITS.id) : "";
  if (!rawId) return null;
  const createdAt =
    typeof obj.createdAt === "number" && Number.isFinite(obj.createdAt)
      ? obj.createdAt
      : Date.now();
  let dueAt = normalizeDueAt(obj.dueAt);
  if (dueAt !== null) {
    const due = new Date(dueAt);
    if (
      due.getUTCHours() === 0 &&
      due.getUTCMinutes() === 0 &&
      due.getUTCSeconds() === 0 &&
      due.getUTCMilliseconds() === 0
    ) {
      dueAt = new Date(
        due.getUTCFullYear(),
        due.getUTCMonth(),
        due.getUTCDate(),
        23,
        59,
        59,
        999,
      ).getTime();
    }
  }
  return {
    id: rawId,
    title: normalizeTitle(typeof obj.title === "string" ? obj.title : ""),
    status: isTaskStatus(obj.status) ? obj.status : "todo",
    priority: isTaskPriorityLevel(obj.priority) ? obj.priority : null,
    tags: normalizeTaskTags(obj.tags),
    dueAt,
    description:
      typeof obj.description === "string" ? obj.description.slice(0, TASK_LIMITS.description) : "",
    projectPath: normalizeProjectPath(obj.projectPath),
    createdAt,
    updatedAt:
      typeof obj.updatedAt === "number" && Number.isFinite(obj.updatedAt)
        ? obj.updatedAt
        : createdAt,
  };
}

/**
 * @description 把数据库行转换为任务对象（关联会话由调用方补齐）。
 * @param {TaskRow} row - tasks 表的一行
 * @param {string[]} sessionKeys - 该任务的关联会话 key
 * @returns {Task} 任务对象
 */
function rowToTask(row: TaskRow, sessionKeys: string[]): Task {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    priority: row.priority,
    tags: parseJsonColumn<string[]>(row.tags, []),
    dueAt: row.due_at,
    description: row.description,
    projectPath: row.project_path,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sessionKeys,
  };
}

export class TaskStore {
  constructor(private readonly db: Database) {}

  /**
   * @description 列出全部任务（按更新时间倒序），附带派生的关联会话。
   * @returns {Task[]} 任务列表
   */
  list(): Task[] {
    const rows = this.db
      .prepare("SELECT * FROM tasks ORDER BY updated_at DESC, rowid DESC")
      .all() as unknown as TaskRow[];
    const sessions = this.sessionKeysByTask();
    return rows.map((row) => rowToTask(row, sessions.get(row.id) ?? []));
  }

  /**
   * @description 读取单个任务。
   * @param {string} id - 任务 id
   * @returns {Task | null} 任务；不存在时为 null
   */
  get(id: string): Task | null {
    const row = this.db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as unknown as
      | TaskRow
      | undefined;
    if (!row) return null;
    const keys = this.db
      .prepare(
        `SELECT key FROM conversations
         WHERE task_id = ? AND archived_at IS NULL
         ORDER BY created_at, rowid`,
      )
      .all(id) as Array<{ key: string }>;
    return rowToTask(
      row,
      keys.map((item) => item.key),
    );
  }

  /**
   * @description 新建任务；未提供的字段使用默认值。
   * @param {TaskCreateInput} input - 已经过 parseTaskCreateInput 校验的参数
   * @param {number} now - 创建时间（测试可注入）
   * @returns {Task} 新建的任务
   * @throws {GatewayError} 客户端指定的 id 已存在时抛出 409
   */
  create(input: TaskCreateInput, now = Date.now()): Task {
    const id = input.id ?? createId();
    if (input.id && this.exists(input.id)) {
      throw new GatewayError({
        status: 409,
        message: `任务已存在：${input.id}`,
        type: "invalid_request_error",
        code: "conflict",
      });
    }
    this.insert({
      id,
      title: input.title ?? UNTITLED_TASK,
      status: input.status ?? "todo",
      priority: input.priority ?? null,
      tags: input.tags ?? [],
      dueAt: input.dueAt ?? null,
      description: input.description ?? "",
      projectPath: input.projectPath ?? null,
      createdAt: now,
      updatedAt: now,
    });
    return this.get(id)!;
  }

  /**
   * @description 局部更新任务，只覆盖 patch 中出现的字段并刷新 updatedAt。
   * @param {string} id - 任务 id
   * @param {TaskInput} patch - 已校验的字段集合
   * @param {number} now - 更新时间（测试可注入）
   * @returns {Task | null} 更新后的任务；不存在时为 null
   */
  update(id: string, patch: TaskInput, now = Date.now()): Task | null {
    const current = this.get(id);
    if (!current) return null;
    const next: TaskRecord = {
      ...current,
      ...patch,
      id: current.id,
      createdAt: current.createdAt,
      updatedAt: Math.max(now, current.updatedAt),
    };
    this.db
      .prepare(
        `UPDATE tasks SET title = ?, status = ?, priority = ?, tags = ?, due_at = ?,
           description = ?, project_path = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        next.title,
        next.status,
        next.priority,
        JSON.stringify(next.tags),
        next.dueAt,
        next.description,
        next.projectPath,
        next.updatedAt,
        id,
      );
    return this.get(id);
  }

  /**
   * @description 删除任务；关联会话由外键自动解除关联，会话本身保留。
   * @param {string} id - 任务 id
   * @returns {boolean} 任务存在并已删除时为 true
   */
  delete(id: string): boolean {
    return Number(this.db.prepare("DELETE FROM tasks WHERE id = ?").run(id).changes) > 0;
  }

  /**
   * @description 旧数据导入：任务不存在时写入，已存在时保留网关版本。
   * @param {TaskRecord} task - 规范化后的任务
   * @returns {boolean} 实际写入时为 true
   */
  insertIfAbsent(task: TaskRecord): boolean {
    if (this.exists(task.id)) return false;
    this.insert(task);
    return true;
  }

  /**
   * @description 统计任务数量。
   * @returns {number} 任务总数
   */
  count(): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM tasks").get() as { n: number }).n;
  }

  /**
   * @description 判断任务是否存在。
   * @param {string} id - 任务 id
   * @returns {boolean} 存在时为 true
   */
  exists(id: string): boolean {
    return Boolean(this.db.prepare("SELECT 1 FROM tasks WHERE id = ?").get(id));
  }

  private insert(task: TaskRecord): void {
    this.db
      .prepare(
        `INSERT INTO tasks (id, title, status, priority, tags, due_at, description,
           project_path, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        task.id,
        task.title,
        task.status,
        task.priority,
        JSON.stringify(task.tags),
        task.dueAt,
        task.description,
        task.projectPath,
        task.createdAt,
        task.updatedAt,
      );
  }

  private sessionKeysByTask(): Map<string, string[]> {
    const rows = this.db
      .prepare(
        `SELECT task_id, key FROM conversations
         WHERE task_id IS NOT NULL AND archived_at IS NULL
         ORDER BY created_at, rowid`,
      )
      .all() as Array<{ task_id: string; key: string }>;
    const map = new Map<string, string[]>();
    for (const row of rows) {
      const keys = map.get(row.task_id);
      if (keys) keys.push(row.key);
      else map.set(row.task_id, [row.key]);
    }
    return map;
  }
}

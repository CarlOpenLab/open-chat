/**
 * 任务看板状态：网关 SQLite 是唯一事实来源，前端乐观更新。
 *
 * - 每个操作先改本地列表（界面立即响应），再发对应的 REST 请求；
 * - 同一任务的请求串行执行（拖拽后紧接着改标题也不会乱序）；
 * - 请求失败时提示并从网关重载，本地与网关重新对齐。
 */
import {
  TASK_LIMITS,
  UNTITLED_TASK,
  normalizeTaskTags,
  type Task,
  type TaskCreateInput,
  type TaskInput,
} from "@cc-heart/open-chat-types";
import { message } from "antdv-next";
import { ref } from "vue";
import { tasksApi } from "../services/workspaceApi";
import { TASK_TEMPLATES, type TaskTemplateId } from "../utils/taskStatus";

const ID_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

/**
 * @description 生成客户端任务 id（与网关 id 同字母表、同长度）。
 * @returns {string} 12 位随机 id
 */
function createTaskId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (byte) => ID_ALPHABET[byte % ID_ALPHABET.length]).join("");
}

/**
 * @description 按网关同样的规则在本地预先规范化字段，乐观更新与最终落库结果一致。
 * @param {TaskInput} input - 原始字段
 * @returns {TaskInput} 规范化后的字段
 */
function normalizeInput(input: TaskInput): TaskInput {
  return {
    ...input,
    ...(input.title !== undefined
      ? { title: input.title.trim().slice(0, TASK_LIMITS.title) || UNTITLED_TASK }
      : {}),
    ...(input.tags !== undefined ? { tags: normalizeTaskTags(input.tags) } : {}),
    ...(input.dueAt !== undefined
      ? { dueAt: input.dueAt && input.dueAt > 0 ? input.dueAt : null }
      : {}),
    ...(input.description !== undefined
      ? { description: input.description.slice(0, TASK_LIMITS.description) }
      : {}),
    ...(input.projectPath !== undefined
      ? { projectPath: input.projectPath?.trim().slice(0, TASK_LIMITS.projectPath) || null }
      : {}),
  };
}

export interface TaskCreateOptions extends TaskInput {
  templateId?: TaskTemplateId;
}

export function useTaskStore() {
  /** 网关任务列表（sessionKeys 由容器按会话的 taskId 重新派生）。 */
  const tasks = ref<Task[]>([]);
  /** 每个任务的请求链。 */
  const chains = new Map<string, Promise<unknown>>();

  /**
   * @description 把请求追加到任务的请求链；失败时提示并从网关重载。
   * @param {string} id - 任务 id
   * @param {() => Promise<unknown>} request - 请求
   * @param {string} failure - 失败提示前缀
   * @returns {void}
   */
  const enqueue = (id: string, request: () => Promise<unknown>, failure: string) => {
    const next = (chains.get(id) ?? Promise.resolve()).catch(() => undefined).then(request);
    chains.set(id, next);
    next
      .catch((error: unknown) => {
        console.error(`${failure}:`, error);
        message.error(error instanceof Error ? `${failure}：${error.message}` : failure);
        void reload();
      })
      .finally(() => {
        if (chains.get(id) === next) chains.delete(id);
      });
  };

  /**
   * @description 从网关加载全部任务。
   * @returns {Promise<void>}
   */
  const load = async () => {
    tasks.value = await tasksApi.list();
  };

  /**
   * @description 等待进行中的写请求完成后从网关重载（看板助手改过任务后调用）。
   * @returns {Promise<void>}
   */
  const reload = async () => {
    await Promise.allSettled(chains.values());
    try {
      await load();
    } catch (error) {
      console.error("Failed to reload tasks:", error);
    }
  };

  /**
   * @description 新建任务（可基于模板预填），本地立即出现在列表最前。
   * @param {TaskCreateOptions} options - 任务字段与可选模板
   * @returns {Task} 新任务（本地乐观版本）
   */
  const create = (options: TaskCreateOptions): Task => {
    const { templateId, ...fields } = options;
    const template = templateId ? TASK_TEMPLATES[templateId] : undefined;
    const now = Date.now();
    const input: TaskCreateInput = {
      id: createTaskId(),
      ...normalizeInput({
        ...fields,
        title: fields.title || template?.title || UNTITLED_TASK,
        tags: fields.tags ?? template?.tags ?? [],
        description: fields.description ?? template?.description ?? "",
      }),
    };
    const task: Task = {
      id: input.id!,
      title: input.title ?? UNTITLED_TASK,
      status: input.status ?? "todo",
      priority: input.priority ?? null,
      tags: input.tags ?? [],
      dueAt: input.dueAt ?? null,
      description: input.description ?? "",
      projectPath: input.projectPath ?? null,
      createdAt: now,
      updatedAt: now,
      sessionKeys: [],
    };
    tasks.value = [task, ...tasks.value];
    enqueue(task.id, () => tasksApi.create(input), "任务创建失败");
    return task;
  };

  /**
   * @description 局部更新任务（空补丁只刷新更新时间，用于会话关联变化时置顶任务）。
   * @param {string} id - 任务 id
   * @param {TaskInput} patch - 需要修改的字段
   * @returns {void}
   */
  const update = (id: string, patch: TaskInput) => {
    const index = tasks.value.findIndex((task) => task.id === id);
    if (index < 0) return;
    const normalized = normalizeInput(patch);
    const next = [...tasks.value];
    next[index] = { ...next[index], ...normalized, updatedAt: Date.now() };
    tasks.value = next;
    enqueue(id, () => tasksApi.update(id, normalized), "任务保存失败");
  };

  /**
   * @description 删除任务（调用方负责二次确认）；关联会话保留并自动解除关联。
   * @param {string} id - 任务 id
   * @returns {void}
   */
  const remove = (id: string) => {
    tasks.value = tasks.value.filter((task) => task.id !== id);
    enqueue(id, () => tasksApi.remove(id), "任务删除失败");
  };

  /**
   * @description 基于已有任务再建一个（重置为待办、不带会话）。
   * @param {string} id - 源任务 id
   * @returns {Task | null} 新任务；源任务不存在时为 null
   */
  const duplicate = (id: string): Task | null => {
    const source = tasks.value.find((task) => task.id === id);
    if (!source) return null;
    return create({
      title: `${source.title} (副本)`,
      status: "todo",
      priority: source.priority,
      tags: source.tags,
      dueAt: source.dueAt,
      description: source.description,
      projectPath: source.projectPath,
    });
  };

  return { tasks, load, reload, create, update, remove, duplicate };
}

/**
 * 工作区数据模型：任务看板、会话索引、模型服务商与工作区偏好。
 *
 * 网关把它们持久化在本机 SQLite（`~/.cc-hearts-open-code/open-chat.db`），
 * 浏览器只通过 REST 读写、不再落本地存储。字段约束（长度上限、枚举）在这里
 * 声明一次，网关校验与前端乐观更新共用同一份规则。
 */

export const TASK_STATUSES = ["todo", "doing", "review", "done", "archived"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ["P0", "P1", "P2", "P3"] as const;
export type TaskPriorityLevel = (typeof TASK_PRIORITIES)[number];
/** null 表示未设置优先级。 */
export type TaskPriority = TaskPriorityLevel | null;

/** 任务字段长度 / 数量上限（超出部分截断，而不是拒绝）。 */
export const TASK_LIMITS = {
  id: 64,
  title: 200,
  description: 8000,
  tag: 30,
  tags: 50,
  projectPath: 500,
} as const;

export const UNTITLED_TASK = "未命名任务";

export interface Task {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  tags: string[];
  /** 截止时间（epoch 毫秒，本地时区当天 23:59:59.999）；null 表示无截止。 */
  dueAt: number | null;
  description: string;
  projectPath: string | null;
  createdAt: number;
  updatedAt: number;
  /** 关联会话 key（按会话创建时间升序）。由会话的 taskId 派生，只读。 */
  sessionKeys: string[];
}

/** 新建 / 更新任务时可写的字段。 */
export type TaskInput = Partial<
  Pick<Task, "title" | "status" | "priority" | "tags" | "dueAt" | "description" | "projectPath">
>;

/** 新建任务：可携带客户端生成的 id（乐观更新），缺省由网关分配。 */
export interface TaskCreateInput extends TaskInput {
  id?: string;
}

/**
 * @description 判断任意值是否为合法的任务状态。
 * @param {unknown} value - 待检查的值
 * @returns {boolean} 是 TASK_STATUSES 之一时为 true
 */
export function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === "string" && (TASK_STATUSES as readonly string[]).includes(value);
}

/**
 * @description 判断任意值是否为合法的优先级档位（不含 null）。
 * @param {unknown} value - 待检查的值
 * @returns {boolean} 是 P0~P3 之一时为 true
 */
export function isTaskPriorityLevel(value: unknown): value is TaskPriorityLevel {
  return typeof value === "string" && (TASK_PRIORITIES as readonly string[]).includes(value);
}

/**
 * @description 规范化标签列表：去空白、截断单个标签长度、去重并限制数量。
 * @param {unknown} value - 原始标签（非数组按空列表处理）
 * @returns {string[]} 可直接持久化的标签列表
 */
export function normalizeTaskTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const tag = item.trim().slice(0, TASK_LIMITS.tag);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
    if (tags.length >= TASK_LIMITS.tags) break;
  }
  return tags;
}

/** 消息附件引用（与网关附件存储的 `cc-attachment:` 引用对应）。 */
export interface MessageAttachmentRef {
  reference: string;
  name: string;
  isImage: boolean;
}

/** 会话运行中排队等待发送的消息。 */
export interface QueuedMessage {
  id: string;
  content: string;
  createdAt: number;
  attachments?: MessageAttachmentRef[];
}

/**
 * 会话索引记录：会话正文由各 agent 自己的存储提供（按 providerSessionId 拉取），
 * 网关只保存索引与运行元数据；Model API 会话的正文另存为 transcript。
 */
export interface ConversationRecord {
  key: string;
  title: string;
  pinned: boolean;
  agentId: string;
  modelId: string;
  providerSessionId: string | null;
  projectPath: string | null;
  systemPrompt: string;
  /** 所属任务；任务删除后自动置空。 */
  taskId: string | null;
  /** 看板手动归列的覆盖状态（SessionStatus）。 */
  statusOverride: string | null;
  /** 出错或手动停止的持久标记，驱动看板「已终止」。 */
  lastError: string | null;
  queuePaused: boolean;
  queuedMessages: QueuedMessage[];
  createdAt: number;
  updatedAt: number;
  /** 归档时间；仅在网关导出等全量读取时出现，列表接口不返回归档会话。 */
  archivedAt?: number | null;
}

export const CONVERSATION_LIMITS = {
  key: 200,
  title: 200,
  systemPrompt: 20000,
  queuedMessages: 100,
  queuedContent: 100000,
  /** Model API 会话 transcript 序列化后的字节上限。 */
  transcriptBytes: 8 * 1024 * 1024,
} as const;

export type ProviderApi = "chat/completions" | "responses";

export interface ProviderModel {
  id: string;
  name?: string;
  contextLength?: number;
}

/** 对外展示的服务商（API Key 只返回掩码，明文不离开网关）。 */
export interface ProviderView {
  id: string;
  name: string;
  baseUrl: string;
  api: ProviderApi;
  models: ProviderModel[];
  hasKey: boolean;
  apiKeyMasked: string;
  createdAt: number;
  updatedAt: number;
}

export interface ProviderInput {
  name?: string;
  baseUrl?: string;
  /** 明文 Key；更新时留空或省略表示保留原值。 */
  apiKey?: string;
  api?: ProviderApi;
  models?: ProviderModel[];
}

/** 看板 AI 助手的会话归属（agent + ACP 会话 id），跨刷新续接上下文。 */
export interface BoardAssistantSession {
  agentId: string;
  providerSessionId: string;
}

/** 工作区偏好：跨设备共享的工作状态（主题等纯显示偏好仍按设备保存）。 */
export interface WorkspacePreferences {
  /** 上次使用的 agent；空串表示未选择。 */
  activeAgentId: string;
  /** 每个 agent 记住的默认模型，新会话优先使用。 */
  agentDefaultModels: Record<string, string>;
  /** Model API 当前选中的模型。 */
  currentModel: string;
  boardAssistant: BoardAssistantSession | null;
}

export const DEFAULT_WORKSPACE_PREFERENCES: WorkspacePreferences = {
  activeAgentId: "",
  agentDefaultModels: {},
  currentModel: "",
  boardAssistant: null,
};

/** 数据库概况（设置页「数据」展示）。 */
export interface WorkspaceInfo {
  databasePath: string;
  sizeBytes: number;
  schemaVersion: number;
  counts: {
    tasks: number;
    conversations: number;
    providers: number;
    projectPaths: number;
  };
}

/**
 * 浏览器旧数据（IndexedDB / localStorage）一次性导入网关的载荷。
 * 各字段保持旧版原始形态，由网关按「缺失才写入」的规则合并。
 */
export interface LegacyImportPayload {
  chatState?: unknown;
  tasks?: unknown;
  projectPaths?: unknown;
  providers?: unknown;
  boardAssistant?: unknown;
  activeAgentId?: unknown;
  agentDefaultModels?: unknown;
}

export interface LegacyImportResult {
  tasks: number;
  conversations: number;
  transcripts: number;
  providers: number;
  projectPaths: number;
  preferences: number;
}

/**
 * 工作区数据模型：会话索引、模型服务商与工作区偏好。
 *
 * 网关把它们持久化在本机 SQLite（`~/.cc-hearts-open-code/open-chat.db`），
 * 浏览器只通过 REST 读写、不再落本地存储。字段约束（长度上限、枚举）在这里
 * 声明一次，网关校验与前端乐观更新共用同一份规则。
 */

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
  /** 出错或手动停止的持久标记。 */
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

/** 工作区偏好：跨设备共享的工作状态（主题等纯显示偏好仍按设备保存）。 */
export interface WorkspacePreferences {
  /** 上次使用的 agent；空串表示未选择。 */
  activeAgentId: string;
  /** 每个 agent 记住的默认模型，新会话优先使用。 */
  agentDefaultModels: Record<string, string>;
  /** Model API 当前选中的模型。 */
  currentModel: string;
}

export const DEFAULT_WORKSPACE_PREFERENCES: WorkspacePreferences = {
  activeAgentId: "",
  agentDefaultModels: {},
  currentModel: "",
};

/** 数据库概况（设置页「数据」展示）。 */
export interface WorkspaceInfo {
  databasePath: string;
  sizeBytes: number;
  schemaVersion: number;
  counts: {
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
  projectPaths?: unknown;
  providers?: unknown;
  activeAgentId?: unknown;
  agentDefaultModels?: unknown;
}

export interface LegacyImportResult {
  conversations: number;
  transcripts: number;
  providers: number;
  projectPaths: number;
  preferences: number;
}

/** Open Chat 扁平消息模型的 canonical 类型。server 与 website 共享。
 *
 * 每条消息都是独立顶层记录，`role` 同时承担「消息来源」与「渲染分派」：
 * 前端按 role 选择渲染组件（reasoning → 思考、content → markdown、
 * tool → 工具调用、plan → 计划、fileChange → 文件修改、workspace → 工作区）。
 * assistant 输出不再聚合进 segments，而是逐条平铺为独立消息。
 */

export type TranscriptRole =
  | "user"
  | "reasoning"
  | "content"
  | "tool"
  | "plan"
  | "fileChange"
  | "workspace";

export type SegmentStatus = "pending" | "running" | "completed" | "error";

export type PlanEntryStatus = "pending" | "in_progress" | "completed";

export type WorkspaceFileStatus = "streaming" | "complete";

/** 消息携带的附件（图片/文件）。reference 为网关附件引用或 data:/http(s) 地址。 */
export interface TranscriptAttachment {
  reference: string;
  name: string;
  isImage: boolean;
  /** 网关侧绝对路径（仅供同机 agent 读取，前端不使用）。 */
  path?: string;
}

/** 工作区生成的文件。 */
export interface WorkspaceFile {
  path: string;
  content?: string;
  language?: string;
  status: WorkspaceFileStatus;
}

/** 用户消息。 */
export interface UserMessage {
  id: string;
  timestamp: number;
  role: "user";
  content: string;
  attachments?: TranscriptAttachment[];
  /** 进模型上下文但不渲染（如 a2ui-submission 遗留能力）。 */
  hidden?: boolean;
}

/** 思考消息：模型推理过程，渲染为思考组件，不展示为正文。 */
export interface ReasoningMessage {
  id: string;
  timestamp: number;
  role: "reasoning";
  content: string;
}

/** 正文消息：assistant 可见输出，渲染为 markdown。 */
export interface ContentMessage {
  id: string;
  timestamp: number;
  role: "content";
  content: string;
  attachments?: TranscriptAttachment[];
}

/** 工具执行消息。文件修改不挂在此消息上，由 FileChangeMessage 表达。 */
export interface ToolMessage {
  id: string;
  timestamp: number;
  role: "tool";
  name: string;
  status: SegmentStatus;
  /** 提供方原始工具类型（edit / bash / webfetch / commandExecution…）。 */
  providerKind?: string;
  input?: unknown;
  output?: string;
  error?: string;
  durationMs?: number;
  displayTarget?: string;
}

/** 计划消息。 */
export interface PlanMessage {
  id: string;
  timestamp: number;
  role: "plan";
  entries: Array<{ content: string; status: PlanEntryStatus }>;
}

/** 文件修改消息：单文件原子（一个工具改多个文件 = 多条消息）。 */
export interface FileChangeMessage {
  id: string;
  timestamp: number;
  role: "fileChange";
  path: string;
  additions?: number;
  deletions?: number;
  status?: SegmentStatus;
  /** 该文件的 unified diff 文本（X CodeHighlighter 以 diff 语言高亮）；存在时才可展示内容。 */
  patch?: string;
}

/** 工作区生成消息（opencode 等提供的文件工作区块）。 */
export interface WorkspaceMessage {
  id: string;
  timestamp: number;
  role: "workspace";
  files: WorkspaceFile[];
  errors: string[];
  hasPendingBlock?: boolean;
}

export type TranscriptMessage =
  | UserMessage
  | ReasoningMessage
  | ContentMessage
  | ToolMessage
  | PlanMessage
  | FileChangeMessage
  | WorkspaceMessage;

export function isUserMessage(message: TranscriptMessage): message is UserMessage {
  return message.role === "user";
}

/** 非 user 消息（reasoning/content/tool/plan/fileChange/workspace 均为 assistant 侧输出）。 */
export function isAssistantRole(role: TranscriptRole): boolean {
  return role !== "user";
}

/** 服务端 live 累积 collector（按 role 追加/合并消息）。 */
export interface TranscriptHistoryCollector {
  messages: TranscriptMessage[];
  nextId: number;
  activeRole: TranscriptRole | null;
}

// ── 过渡期 / 事件桥接类型（不属于消息联合体）──

/** 工具活动 payload（live native_event 与过渡期使用）。 */
export interface TranscriptActivity extends Record<string, unknown> {
  id: string;
  name: string;
  status: SegmentStatus;
  kind?: string;
  input?: unknown;
  output?: string;
  error?: string;
  durationMs?: number;
  displayTarget?: string;
  /** 过渡期保留：文件修改信息（新模型下请用 FileChangeMessage）。 */
  fileChanges?: TranscriptFileChange[];
}

export interface TranscriptFileChange {
  path: string;
  additions?: number;
  deletions?: number;
  /** 该文件的 unified diff 文本（X CodeHighlighter 以 diff 语言高亮）。 */
  patch?: string;
}

export interface TranscriptPlan extends Record<string, unknown> {
  entries?: Array<{ content: string; status: PlanEntryStatus }>;
}

/** 过渡期时间线条目（新旧模型桥接用）。 */
export type TranscriptTimelineItem =
  | { kind: "reasoning"; id: string; content: string }
  | { kind: "content"; id: string; content: string }
  | { kind: "tool"; id: string; activity: TranscriptActivity }
  | { kind: "plan"; id: string; plan: TranscriptPlan };

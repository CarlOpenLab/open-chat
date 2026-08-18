/** Open Chat 扁平消息模型的 canonical 类型。server 与 website 共享。 */

export type TranscriptRole = "user" | "assistant";

export type SegmentStatus = "pending" | "running" | "completed" | "error";

export type PlanEntryStatus = "pending" | "in_progress" | "completed";

export type WorkspaceFileStatus = "streaming" | "complete";

/** 思考段：模型推理过程（不展示为正文）。 */
export interface ReasoningSegment {
  kind: "reasoning";
  content: string;
}

/** 正文段：可见的 assistant 文本，相邻 content 段由前端合并为正文。 */
export interface ContentSegment {
  kind: "content";
  content: string;
}

/** 工具执行段。文件修改不挂在此段上，由 FileChangeSegment 表达。 */
export interface ToolSegment {
  kind: "tool";
  id: string;
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

/** 计划段。 */
export interface PlanSegment {
  kind: "plan";
  entries: Array<{ content: string; status: PlanEntryStatus }>;
}

/** 文件修改段：单文件原子（一个工具改多个文件 = 多个段）。 */
export interface FileChangeSegment {
  kind: "fileChange";
  path: string;
  additions?: number;
  deletions?: number;
  status?: SegmentStatus;
}

/** 工作区生成段（opencode 等提供的文件工作区块）。 */
export interface WorkspaceSegment {
  kind: "workspace";
  files: Array<{
    path: string;
    content?: string;
    language?: string;
    status: WorkspaceFileStatus;
  }>;
  errors: string[];
  hasPendingBlock?: boolean;
}

export type TranscriptSegment =
  | ReasoningSegment
  | ContentSegment
  | ToolSegment
  | PlanSegment
  | FileChangeSegment
  | WorkspaceSegment;

/** 消息携带的附件（图片/文件）。reference 为网关附件引用或 data:/http(s) 地址。 */
export interface TranscriptAttachment {
  reference: string;
  name: string;
  isImage: boolean;
  /** 网关侧绝对路径（仅供同机 agent 读取，前端不使用）。 */
  path?: string;
}

/** 用户消息：保持简单，content + attachments。 */
export interface UserMessage {
  id: string;
  /** Unix 毫秒时间戳。 */
  timestamp: number;
  role: "user";
  content: string;
  attachments?: TranscriptAttachment[];
  /** 进模型上下文但不渲染（如 a2ui-submission 遗留能力）。 */
  hidden?: boolean;
}

/** assistant 消息：只有扁平 segments，正文由前端合并 content 段得出。 */
export interface AssistantMessage {
  id: string;
  /** Unix 毫秒时间戳。 */
  timestamp: number;
  role: "assistant";
  segments: TranscriptSegment[];
  attachments?: TranscriptAttachment[];
}

export type TranscriptMessage = UserMessage | AssistantMessage;

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
  /** 过渡期保留：文件修改信息（新模型下请用 FileChangeSegment）。 */
  fileChanges?: TranscriptFileChange[];
}

export interface TranscriptFileChange {
  path: string;
  additions?: number;
  deletions?: number;
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

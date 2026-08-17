export type TranscriptRole = "user" | "assistant";

export type TranscriptActivityStatus = "pending" | "running" | "completed" | "error";

export interface TranscriptFileChange {
  path: string;
  additions?: number;
  deletions?: number;
}

export interface TranscriptActivity extends Record<string, unknown> {
  id: string;
  name: string;
  status: TranscriptActivityStatus;
  kind?: string;
  input?: unknown;
  output?: string;
  error?: string;
  durationMs?: number;
  fileChanges?: TranscriptFileChange[];
  displayTarget?: string;
}

export interface TranscriptPlanEntry {
  content: string;
  status: "pending" | "in_progress" | "completed";
}

export interface TranscriptPlan extends Record<string, unknown> {
  entries?: TranscriptPlanEntry[];
}

export type TranscriptTimelineItem =
  | { kind: "reasoning"; id: string; content: string }
  | { kind: "content"; id: string; content: string }
  | { kind: "tool"; id: string; activity: TranscriptActivity }
  | { kind: "plan"; id: string; plan: TranscriptPlan };

/** 消息携带的附件（图片/文件）。reference 为网关附件引用或 data:/http(s) 地址。 */
export interface TranscriptAttachment {
  reference: string;
  name: string;
  isImage: boolean;
  /** 网关侧绝对路径（仅供同机 agent 读取，前端不使用）。 */
  path?: string;
}

/** Canonical message shape consumed by every history adapter and the web client. */
export interface TranscriptMessage {
  id: string;
  role: TranscriptRole;
  content: string;
  reasoningContent?: string;
  toolCalls?: TranscriptActivity[];
  agentPlan?: TranscriptPlan;
  timeline?: TranscriptTimelineItem[];
  attachments?: TranscriptAttachment[];
}

export interface TranscriptHistoryCollector {
  messages: TranscriptMessage[];
  nextId: number;
  activeRole: TranscriptRole | null;
}

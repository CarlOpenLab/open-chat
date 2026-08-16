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

/** Canonical message shape consumed by every history adapter and the web client. */
export interface TranscriptMessage {
  id: string;
  role: TranscriptRole;
  content: string;
  reasoningContent?: string;
  toolCalls?: TranscriptActivity[];
  agentPlan?: TranscriptPlan;
  timeline?: TranscriptTimelineItem[];
}

export interface TranscriptHistoryCollector {
  messages: TranscriptMessage[];
  nextId: number;
  activeRole: TranscriptRole | null;
}

export type TranscriptRole = "user" | "assistant";

export type TranscriptActivityStatus = "pending" | "running" | "completed" | "error";

export interface TranscriptActivity extends Record<string, unknown> {
  id: string;
  name: string;
  status: TranscriptActivityStatus;
  input?: unknown;
  output?: string;
  error?: string;
  durationMs?: number;
}

export interface TranscriptPlanEntry {
  content: string;
  status: "pending" | "in_progress" | "completed";
}

export interface TranscriptPlan extends Record<string, unknown> {
  entries?: TranscriptPlanEntry[];
}

/** Canonical message shape consumed by every history adapter and the web client. */
export interface TranscriptMessage {
  id: string;
  role: TranscriptRole;
  content: string;
  reasoningContent?: string;
  toolCalls?: TranscriptActivity[];
  agentPlan?: TranscriptPlan;
}

export interface TranscriptHistoryCollector {
  messages: TranscriptMessage[];
  nextId: number;
  activeRole: TranscriptRole | null;
}

export type TranscriptStreamEvent =
  | { type: "message.append"; message: TranscriptMessage }
  | { type: "content.delta"; content: string }
  | { type: "reasoning.delta"; content: string }
  | { type: "activity.upsert"; activity: TranscriptActivity }
  | { type: "plan.updated"; plan: TranscriptPlan }
  | { type: "turn.completed"; stopReason?: string }
  | { type: "turn.failed"; message: string };

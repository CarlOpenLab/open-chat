// Types shared with the Go host (internal/host/types.go).

export type Status = "idle" | "connecting" | "ready" | "running" | "error";

export interface AgentOverride {
  disabled?: boolean;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface CustomAgent {
  id: string;
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface Settings {
  theme: "system" | "light" | "dark";
  sendKey: "enter" | "modEnter";
  autoAllow: boolean;
  defaultAgent: string;
  recentDirs: string[] | null;
  nodePath?: string;
  agents: Record<string, AgentOverride>;
  customAgents: CustomAgent[] | null;
}

export interface AgentInfo {
  id: string;
  name: string;
  description: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  homepage?: string;
  probe: string;
  available: boolean;
  resolved?: string;
  custom?: boolean;
  demo?: boolean;
  disabled?: boolean;
}

export interface Meta {
  id: string;
  title: string;
  titleLocked?: boolean;
  agentId: string;
  agentName: string;
  cwd: string;
  createdAt: number;
  updatedAt: number;
  pinned?: boolean;
  acpSessionId?: string;
  preview?: string;
  status: Status;
  pending?: number;
}

export interface Mode {
  id: string;
  name: string;
  description?: string;
}

export interface ConfigSelectOption {
  value: string;
  name: string;
  description?: string | null;
}

export interface ConfigOption {
  id: string;
  name: string;
  description?: string | null;
  category?: string | null;
  type: "select" | "boolean";
  currentValue: string | boolean;
  options?: ConfigSelectOption[] | { group: string; name: string; options: ConfigSelectOption[] }[];
}

export interface Usage {
  costUsd?: number;
  contextWindow?: { used: number; total: number };
  inputTokens?: number;
  outputTokens?: number;
}

export interface LiveState {
  status: Status;
  error?: string;
  agentInfo: { name: string; version: string } | null;
  capabilities: { loadSession: boolean; image: boolean; audio: boolean; embeddedContext: boolean };
  modes: { currentModeId: string; availableModes: Mode[] } | null;
  configOptions: ConfigOption[];
  commands: { name: string; description?: string }[] | null;
  usage?: Usage;
  resumed: boolean;
  turnStartedAt?: number;
}

export type Block =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string; uri?: string }
  | { type: "resource_link"; uri: string; name: string; mimeType?: string; size?: number }
  | { type: "resource"; resource: { uri: string; text: string; mimeType?: string } };

export interface ToolCall {
  toolCallId: string;
  status: "pending" | "in_progress" | "completed" | "failed";
  kind?: string;
  title?: string;
  rawInput?: unknown;
  rawOutput?: unknown;
  content?: ToolContent[];
  locations?: { path: string; line?: number | null }[];
}

export type ToolContent =
  | { type: "content"; content: { type: string; text?: string; data?: string; mimeType?: string } }
  | { type: "diff"; path: string; oldText?: string | null; newText: string }
  | { type: "terminal"; terminalId: string };

export interface PermissionOption {
  optionId: string;
  name: string;
  kind: string;
}

export interface PlanEntry {
  content: string;
  priority: "high" | "medium" | "low";
  status: "pending" | "in_progress" | "completed";
}

/** One entry of a transcript, as the host stores and pushes it. */
export type HostEvent = { t?: number } & (
  | { type: "user_message"; id: string; blocks: Block[] }
  | { type: "message_delta"; text: string }
  | { type: "thought_delta"; text: string }
  | { type: "tool_call" | "tool_call_update"; toolCall: ToolCall }
  | { type: "plan"; entries: PlanEntry[] }
  | {
      type: "permission_request";
      requestId: string;
      toolCall?: ToolCall;
      options: PermissionOption[];
      resolved?: { optionId: string | null; auto?: boolean };
    }
  | { type: "permission_resolved"; requestId: string; optionId: string | null; auto?: boolean }
  | { type: "turn_end"; stopReason: string; error?: string; durationMs?: number }
  | { type: "notice"; level: "info" | "warn" | "error"; text: string }
  | { type: "agent_error"; message: string }
  | { type: "session_info"; title?: string }
  | { type: "mode_update" | "commands_update" | "config_update" | "usage" | "raw"; [k: string]: unknown }
);

export interface Conversation {
  meta: Meta;
  events: HostEvent[] | null;
  live: LiveState;
}

export interface Bootstrap {
  version: string;
  platform: string;
  mode: "desktop" | "web";
  home: string;
  settings: Settings;
  agents: AgentInfo[];
  conversations: Meta[] | null;
  nodeVersion: string;
  nodeError?: string;
}

export interface DirListing {
  path: string;
  parent: string;
  dirs: string[];
  isRepo: boolean;
}

export type Push =
  | { kind: "events"; conversationId: string; events: HostEvent[] }
  | { kind: "live"; conversationId: string; live: LiveState }
  | { kind: "meta"; conversationId: string; meta: Meta }
  | { kind: "removed"; conversationId: string }
  | { kind: "settings"; settings: Settings };
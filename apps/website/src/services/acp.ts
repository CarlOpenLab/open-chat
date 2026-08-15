import { API_BASE_URL, GATEWAY_API_KEY } from "./ai";

export interface AcpAgentView {
  id: string;
  name: string;
  description: string;
  installed: boolean;
  available: boolean;
  enabled: boolean;
  transport: "stdio" | "http";
  protocol: string;
  command: string;
  adapterHint?: string;
}

export interface AgentView extends AcpAgentView {
  kind: "api" | "acp";
}

export interface AcpConfigSelectOption {
  value: string;
  name: string;
  description?: string | null;
}

export interface AcpConfigSelectGroup {
  group: string;
  name: string;
  options: AcpConfigSelectOption[];
}

interface AcpConfigOptionBase {
  id: string;
  name: string;
  description?: string | null;
  category?: string | null;
}

export type AcpConfigOption =
  | (AcpConfigOptionBase & {
      type: "select";
      currentValue: string;
      options: AcpConfigSelectOption[] | AcpConfigSelectGroup[];
    })
  | (AcpConfigOptionBase & {
      type: "boolean";
      currentValue: boolean;
    });

export interface AcpSessionState {
  agentId: string;
  conversationId: string;
  sessionId: string;
  configOptions: AcpConfigOption[];
  modes?: unknown;
  history?: AcpSessionHistoryMessage[];
  loadSupported?: boolean;
}

export interface AcpSessionHistoryMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  reasoningContent?: string;
  toolCalls?: Array<Record<string, unknown>>;
  agentPlan?: Record<string, unknown>;
}

export interface AcpProviderSession {
  sessionId: string;
  cwd: string;
  title?: string;
  updatedAt?: string;
}

export interface AcpProviderSessions {
  supported: boolean;
  sessions: AcpProviderSession[];
}

export const API_AGENT: AgentView = {
  id: "api",
  name: "Model API",
  description: "OpenAI-compatible model providers",
  installed: true,
  available: true,
  enabled: true,
  transport: "http",
  protocol: "OpenAI-compatible API",
  command: "HTTP gateway",
  kind: "api",
};

export async function loadAcpAgents(): Promise<AgentView[]> {
  const response = await fetch(`${API_BASE_URL}/api/acp/agents`, {
    headers: GATEWAY_API_KEY ? { Authorization: `Bearer ${GATEWAY_API_KEY}` } : undefined,
  });
  if (!response.ok) throw new Error(`本地 Agent 加载失败（HTTP ${response.status}）`);
  const data = (await response.json()) as { agents?: AcpAgentView[] };
  const agents = Array.isArray(data.agents) ? data.agents : [];
  return [API_AGENT, ...agents.map((agent) => ({ ...agent, kind: "acp" as const }))];
}

export async function loadAcpSession(
  agentId: string,
  conversationId: string,
  projectPath = "",
  providerSessionId = "",
): Promise<AcpSessionState> {
  const query = new URLSearchParams({ agentId, conversationId });
  if (projectPath.trim()) query.set("projectPath", projectPath.trim());
  if (providerSessionId.trim()) query.set("providerSessionId", providerSessionId.trim());
  return requestAcpSession(`${API_BASE_URL}/api/acp/session?${query}`);
}

export async function loadAcpProviderSessions(agentId: string): Promise<AcpProviderSessions> {
  const query = new URLSearchParams({ agentId });
  return requestJson<AcpProviderSessions>(`${API_BASE_URL}/api/acp/provider-sessions?${query}`);
}

export async function setAcpSessionConfig(
  agentId: string,
  conversationId: string,
  configId: string,
  value: string | boolean,
  projectPath = "",
  providerSessionId = "",
): Promise<AcpSessionState> {
  return requestAcpSession(`${API_BASE_URL}/api/acp/session/config`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      agentId,
      conversationId,
      configId,
      value,
      projectPath,
      providerSessionId,
    }),
  });
}

export function flattenAcpSelectOptions(
  options: AcpConfigSelectOption[] | AcpConfigSelectGroup[],
): AcpConfigSelectOption[] {
  return options.flatMap((option) => ("options" in option ? option.options : [option]));
}

async function requestAcpSession(url: string, init: RequestInit = {}): Promise<AcpSessionState> {
  return requestJson<AcpSessionState>(url, init);
}

async function requestJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (GATEWAY_API_KEY) headers.set("Authorization", `Bearer ${GATEWAY_API_KEY}`);
  const response = await fetch(url, {
    ...init,
    headers,
  });
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(data.error?.message || `Agent 会话请求失败（HTTP ${response.status}）`);
  }
  return (await response.json()) as T;
}

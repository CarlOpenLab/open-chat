import { API_BASE_URL, GATEWAY_API_KEY } from "./ai";
import type { TranscriptMessage } from "./transcript";

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

interface AcpConfigSelectOption {
  value: string;
  name: string;
  description?: string | null;
}

interface AcpConfigSelectGroup {
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

type AcpConfigOption =
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
  history?: TranscriptMessage[];
  loadSupported?: boolean;
  /** 该 ACP 会话当前是否正在运行（服务端 activeRuns，回合进行中为 true）。 */
  running?: boolean;
}

interface AcpProviderSession {
  sessionId: string;
  cwd: string;
  title?: string;
  updatedAt?: string;
}

interface AcpProviderSessions {
  supported: boolean;
  sessions: AcpProviderSession[];
}

export interface OpenChatSessionView {
  agentId: string;
  conversationId: string;
  sessionId: string;
  createdAt: number;
  lastUsed: number;
  running: boolean;
  startedAt?: number;
  projectPath?: string;
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

export async function loadOpenChatSessions(
  agentId: string,
  signal?: AbortSignal,
): Promise<OpenChatSessionView[]> {
  const query = new URLSearchParams({ agentId });
  const data = await requestJson<{ sessions?: OpenChatSessionView[] }>(
    `${API_BASE_URL}/api/acp/sessions?${query}`,
    { signal },
  );
  return Array.isArray(data.sessions) ? data.sessions : [];
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

/** 订阅 ACP 会话实时输出（SSE）。协议：先收到 `snapshot`（已完成历史 + 当前回合用户消息），
 * 随后是当前回合输出（native_event / chat_permission / acp_session …），回合结束收到 [DONE] 并关闭。
 * 返回 AbortController；`onEnd` 在流关闭（正常或出错）时回调一次。 */
export function subscribeAcpSessionStream(
  agentId: string,
  conversationId: string,
  projectPath: string,
  onEvent: (event: string | null, data: string) => void,
  onEnd: () => void,
): AbortController {
  const controller = new AbortController();
  const query = new URLSearchParams({ agentId, conversationId });
  if (projectPath.trim()) query.set("projectPath", projectPath.trim());
  void (async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/acp/session/stream?${query}`, {
        headers: GATEWAY_API_KEY ? { Authorization: `Bearer ${GATEWAY_API_KEY}` } : undefined,
        signal: controller.signal,
      });
      if (response.status === 204) return;
      if (!response.ok) {
        console.error(`Agent session stream failed (HTTP ${response.status})`);
        return;
      }
      if (!response.body) return;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let separator: number;
        while ((separator = buffer.indexOf("\n\n")) !== -1) {
          const frame = buffer.slice(0, separator);
          buffer = buffer.slice(separator + 2);
          if (!frame.trim() || frame.startsWith(":")) continue;
          let event: string | null = null;
          const dataLines: string[] = [];
          for (const line of frame.split("\n")) {
            if (line.startsWith("event:")) event = line.slice("event:".length).trim();
            else if (line.startsWith("data:")) {
              dataLines.push(line.slice("data:".length).trimStart());
            }
          }
          if (dataLines.length > 0) onEvent(event, dataLines.join("\n"));
        }
      }
    } catch (error) {
      if ((error as Error)?.name !== "AbortError") {
        console.error("ACP session stream error:", error);
      }
    } finally {
      onEnd();
    }
  })();
  return controller;
}

/** 取消运行中的 ACP 回合（多标签 / 刷新恢复场景下停止孤儿回合）。 */
export async function cancelAcpTurn(agentId: string, conversationId: string): Promise<void> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/acp/session/cancel`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(GATEWAY_API_KEY ? { Authorization: `Bearer ${GATEWAY_API_KEY}` } : {}),
      },
      body: JSON.stringify({ agentId, conversationId }),
    });
    if (!response.ok) {
      throw new Error(`Agent turn cancellation failed (HTTP ${response.status})`);
    }
  } catch (error) {
    console.error("Failed to cancel ACP turn:", error);
  }
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

import type { TranscriptMessage } from "@cc-heart/open-chat-types";
import { apiRequest, gatewayFetch } from "./http";

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
  messages?: TranscriptMessage[];
  loadSupported?: boolean;
  /** 该会话当前是否有网关托管的回合在运行（服务端运行注册表）。 */
  running?: boolean;
  /** 运行中回合的起始时间（毫秒）；刷新后据此恢复「工作中」计时。 */
  startedAt?: number;
}

export type AcpSessionStreamOutcome = "completed" | "failed" | "disconnected";

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

/**
 * @description 读取本地 agent 列表（首项固定为 Model API）。
 * @returns {Promise<AgentView[]>} agent 列表
 */
export async function loadAcpAgents(): Promise<AgentView[]> {
  const data = await apiRequest<{ agents?: AcpAgentView[] }>("/api/acp/agents", {
    errorMessage: "本地 Agent 加载失败",
  });
  const agents = Array.isArray(data.agents) ? data.agents : [];
  return [API_AGENT, ...agents.map((agent) => ({ ...agent, kind: "acp" as const }))];
}

/**
 * @description 创建或复用 agent 会话，返回模型 / 模式配置、历史与运行状态。
 * @param {string} agentId - agent id
 * @param {string} conversationId - 前端会话 key
 * @param {string} projectPath - 项目目录（空串用网关默认目录）
 * @param {string} providerSessionId - 供应商真实会话 id（恢复历史用）
 * @returns {Promise<AcpSessionState>} 会话状态
 */
export async function loadAcpSession(
  agentId: string,
  conversationId: string,
  projectPath = "",
  providerSessionId = "",
): Promise<AcpSessionState> {
  const query = new URLSearchParams({ agentId, conversationId });
  if (projectPath.trim()) query.set("projectPath", projectPath.trim());
  if (providerSessionId.trim()) query.set("providerSessionId", providerSessionId.trim());
  return apiRequest<AcpSessionState>(`/api/acp/session?${query}`, {
    errorMessage: "Agent 会话请求失败",
  });
}

/**
 * @description 修改 agent 会话配置项（如模型）。
 * @param {string} agentId - agent id
 * @param {string} conversationId - 前端会话 key
 * @param {string} configId - 配置项 id
 * @param {string | boolean} value - 新值
 * @param {string} projectPath - 项目目录
 * @param {string} providerSessionId - 供应商真实会话 id
 * @returns {Promise<AcpSessionState>} 更新后的会话状态
 */
export async function setAcpSessionConfig(
  agentId: string,
  conversationId: string,
  configId: string,
  value: string | boolean,
  projectPath = "",
  providerSessionId = "",
): Promise<AcpSessionState> {
  return apiRequest<AcpSessionState>("/api/acp/session/config", {
    method: "POST",
    json: { agentId, conversationId, configId, value, projectPath, providerSessionId },
    errorMessage: "Agent 会话请求失败",
  });
}

export function flattenAcpSelectOptions(
  options: AcpConfigSelectOption[] | AcpConfigSelectGroup[],
): AcpConfigSelectOption[] {
  return options.flatMap((option) => ("options" in option ? option.options : [option]));
}

/** 订阅 ACP 会话实时输出（SSE）。协议：先收到 `snapshot`（已完成历史 + 当前回合用户消息），
 * 随后是当前回合输出（native_event / chat_permission / acp_session …），回合结束收到 [DONE] 并关闭。
 * 返回 AbortController；`onEnd` 会区分正常完成、任务失败和连接中断。 */
export function subscribeAcpSessionStream(
  agentId: string,
  conversationId: string,
  projectPath: string,
  onEvent: (event: string | null, data: string) => void,
  onEnd: (outcome: AcpSessionStreamOutcome) => void,
): AbortController {
  const controller = new AbortController();
  const query = new URLSearchParams({ agentId, conversationId });
  if (projectPath.trim()) query.set("projectPath", projectPath.trim());
  void (async () => {
    let outcome: AcpSessionStreamOutcome = "disconnected";
    try {
      const response = await gatewayFetch(`/api/acp/session/stream?${query}`, {
        signal: controller.signal,
      });
      if (response.status === 204) {
        outcome = "completed";
        return;
      }
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
        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
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
          if (dataLines.length > 0) {
            const data = dataLines.join("\n");
            if (event === "chat_error") outcome = "failed";
            if (event === "native_event") {
              try {
                const nativeEvent = JSON.parse(data) as { type?: string };
                if (nativeEvent.type === "turn.failed") outcome = "failed";
                else if (nativeEvent.type === "turn.completed") outcome = "completed";
              } catch {
                // The provider owns malformed-event reporting; keep the stream alive here.
              }
            }
            const done = data === "[DONE]";
            if (done && outcome !== "failed") outcome = "completed";
            onEvent(event, data);
            // [DONE] is the authoritative terminal frame. Do not wait for a
            // proxy to close the TCP response before notifying the UI that the
            // task has completed.
            if (done) {
              await reader.cancel();
              return;
            }
          }
        }
      }
    } catch (error) {
      if ((error as Error)?.name !== "AbortError") {
        console.error("ACP session stream error:", error);
      }
    } finally {
      onEnd(outcome);
    }
  })();
  return controller;
}

/**
 * @description 取消运行中的回合（多标签 / 刷新恢复场景下停止孤儿回合）；失败只记录日志。
 * @param {string} agentId - agent id
 * @param {string} conversationId - 前端会话 key
 * @returns {Promise<void>}
 */
export async function cancelAcpTurn(agentId: string, conversationId: string): Promise<void> {
  try {
    await apiRequest("/api/acp/session/cancel", {
      method: "POST",
      json: { agentId, conversationId },
      errorMessage: "Agent 回合取消失败",
    });
  } catch (error) {
    console.error("Failed to cancel ACP turn:", error);
  }
}

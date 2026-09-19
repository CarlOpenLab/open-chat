import type { SessionConfigOption } from "@agentclientprotocol/sdk";
import type { ServerResponse } from "node:http";
import type { AcpAgentConfig, AcpConfig } from "./config";
import { resolveExecutable } from "./commandEnv";
import { GatewayError } from "./error";
import type { LocalChatManager } from "./localProvider";
import { defaultWorkspaceDir } from "./attachments";
import { writeTranscriptCustomEvent } from "./transcript/stream";
import type { TranscriptMessage } from "./transcript/types";

export interface OpenCodeAgentView {
  id: string;
  name: string;
  description: string;
  installed: boolean;
  available: boolean;
  enabled: boolean;
  transport: "http";
  protocol: "OpenCode HTTP + SSE";
  command: string;
  adapterHint?: string;
}

export interface OpenCodeSessionStateView {
  agentId: string;
  conversationId: string;
  sessionId: string;
  configOptions: SessionConfigOption[];
  modes: null;
  messages?: TranscriptMessage[];
}

interface OpenCodeSession {
  agentId: string;
  conversationId: string;
  sessionId: string;
  model: string;
  models: Array<{ id: string; name: string }>;
  createdAt: number;
  lastUsed: number;
  projectPath?: string;
}

/** opencode 由其本地 HTTP 服务（localProvider）驱动；本类只做会话/模型视图适配。 */
export class OpenCodeManager {
  private readonly agents = new Map<string, AcpAgentConfig>();
  private readonly sessions = new Map<string, OpenCodeSession>();

  constructor(
    private readonly config: AcpConfig,
    private readonly localChat: LocalChatManager,
  ) {
    for (const agent of config.agents) {
      if (agent.transport === "opencode") this.agents.set(agent.id, agent);
    }
  }

  hasAgent(agentId: string): boolean {
    return this.agents.has(agentId);
  }

  listAgents(): OpenCodeAgentView[] {
    return [...this.agents.values()].map((agent) => {
      const installed = !!resolveExecutable(agent.command);
      return {
        id: agent.id,
        name: agent.name,
        description: agent.description,
        installed,
        available: this.config.enabled && agent.enabled && installed,
        enabled: this.config.enabled && agent.enabled,
        transport: "http",
        protocol: "OpenCode HTTP + SSE",
        command: `${agent.command} serve`,
        ...(!installed && agent.adapterHint ? { adapterHint: agent.adapterHint } : {}),
      };
    });
  }

  async getSessionState(
    agentId: string,
    conversationId: string,
    projectPath?: string,
    providerSessionId?: string,
  ): Promise<OpenCodeSessionStateView> {
    const session = await this.getOrCreateSession(
      agentId,
      conversationId,
      projectPath,
      providerSessionId,
    );
    const agent = this.requireAgent(agentId);
    const history = await this.readProviderHistory(
      agent,
      session.sessionId,
      projectPath || agent.cwd || this.config.cwd || defaultWorkspaceDir(),
      session.sessionId !== conversationId || Boolean(providerSessionId),
    );
    return sessionView(session, history);
  }

  async setSessionConfigOption(
    agentId: string,
    conversationId: string,
    configId: string,
    value: string | boolean,
    projectPath?: string,
    providerSessionId?: string,
  ): Promise<OpenCodeSessionStateView> {
    if (configId !== "model" || typeof value !== "string") {
      throw GatewayError.invalidRequest("OpenCode 目前只支持模型选择配置");
    }
    const session = await this.getOrCreateSession(
      agentId,
      conversationId,
      projectPath,
      providerSessionId,
    );
    if (!session.models.some((model) => model.id === value)) {
      throw GatewayError.invalidRequest(`OpenCode 不支持模型：${value}`);
    }
    session.model = value;
    session.lastUsed = Date.now();
    return sessionView(session);
  }

  async runTurn(
    agentId: string,
    conversationId: string,
    text: string,
    projectPath: string | undefined,
    providerSessionId: string | undefined,
    res: ServerResponse,
    signal: AbortSignal,
  ): Promise<void> {
    const session = await this.getOrCreateSession(
      agentId,
      conversationId,
      projectPath,
      providerSessionId,
    );
    session.lastUsed = Date.now();
    if (!session.model) throw GatewayError.invalidRequest("OpenCode 没有可用模型");
    const entry = await this.localChat.getOrCreateSession(
      `${agentId}:${conversationId}`,
      session.model,
      projectPath,
      providerSessionId || (session.sessionId !== conversationId ? session.sessionId : undefined),
    );
    session.sessionId = entry.opencodeId;
    writeTranscriptCustomEvent(res, "provider_session", { agentId, sessionId: session.sessionId });
    await this.abortableRun(
      () => this.localChat.runTurn(entry, text, session.model, "", res, signal),
      signal,
    );
  }

  stop(): void {
    this.sessions.clear();
  }

  private requireAgent(agentId: string): AcpAgentConfig {
    if (!this.config.enabled) throw GatewayError.invalidRequest("本地 CLI 服务未启用");
    const agent = this.agents.get(agentId);
    if (!agent || !agent.enabled) {
      throw GatewayError.invalidRequest(`未知或未启用的 OpenCode Agent：${agentId}`);
    }
    if (!resolveExecutable(agent.command)) {
      throw GatewayError.invalidRequest(`${agent.name} CLI 不可用：${agent.command}`);
    }
    return agent;
  }

  private async getOrCreateSession(
    agentId: string,
    conversationId: string,
    projectPath?: string,
    providerSessionId?: string,
  ): Promise<OpenCodeSession> {
    this.requireAgent(agentId);
    const key = `${agentId}:${conversationId}:${projectPath || ""}`;
    const normalizedProviderSessionId = providerSessionId?.trim();
    const findExisting = (): OpenCodeSession | undefined => {
      const exact = this.sessions.get(key);
      if (exact) return exact;
      if (!normalizedProviderSessionId) return undefined;
      return [...this.sessions.values()].find(
        (entry) => entry.agentId === agentId && entry.sessionId === normalizedProviderSessionId,
      );
    };
    const existing = findExisting();
    if (existing) {
      existing.lastUsed = Date.now();
      this.sessions.set(key, existing);
      return existing;
    }
    const models = (await this.localChat.listModels()).map((model) => ({
      id: model.id,
      name: model.name,
    }));
    // 模型发现会让出事件循环；等待期间可能有并发请求已建会话。
    const concurrent = findExisting();
    if (concurrent) {
      concurrent.lastUsed = Date.now();
      this.sessions.set(key, concurrent);
      return concurrent;
    }
    const session: OpenCodeSession = {
      agentId,
      conversationId,
      sessionId: normalizedProviderSessionId || conversationId,
      model: models[0]?.id ?? "",
      models,
      createdAt: Date.now(),
      lastUsed: Date.now(),
      projectPath,
    };
    this.sessions.set(key, session);
    return session;
  }

  private async readProviderHistory(
    agent: AcpAgentConfig,
    sessionId: string,
    cwd: string,
    enabled: boolean,
  ): Promise<TranscriptMessage[]> {
    if (!enabled) return [];
    try {
      const loaded = await this.localChat.loadProviderSession(sessionId, cwd);
      return loaded?.history ?? [];
    } catch (error) {
      console.error(`[${agent.id}] session history read failed:`, error);
      return [];
    }
  }

  /** 包装 localChat.runTurn：取消时同步写 turn.completed 终止 SSE（与原行为一致）。 */
  private async abortableRun(start: () => Promise<void>, signal: AbortSignal): Promise<void> {
    let rejectAbort: ((error: Error) => void) | null = null;
    const aborted = new Promise<never>((_resolve, reject) => {
      rejectAbort = reject;
    });
    const onAbort = () => rejectAbort?.(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      if (signal.aborted) throw abortError();
      await Promise.race([start(), aborted]);
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
  }
}

function abortError(): Error {
  const error = new Error("OpenCode 回合已取消");
  error.name = "AbortError";
  return error;
}

function sessionView(
  session: OpenCodeSession,
  history: TranscriptMessage[] = [],
): OpenCodeSessionStateView {
  const configOptions: SessionConfigOption[] = session.models.length
    ? [
        {
          id: "model",
          name: "模型",
          category: "model",
          type: "select",
          currentValue: session.model,
          options: session.models.map((model) => ({ value: model.id, name: model.name })),
        },
      ]
    : [];
  return {
    agentId: session.agentId,
    conversationId: session.conversationId,
    sessionId: session.sessionId,
    configOptions,
    modes: null,
    ...(history.length > 0 ? { messages: history } : {}),
  };
}

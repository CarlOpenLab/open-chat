import type { ServerResponse } from "node:http";
import type { AcpConfig } from "./config";
import type { LocalChatManager } from "./localProvider";
import { AcpManager, type AcpAgentView, type AcpSessionStateView } from "./acpManager";
import {
  NativeCliManager,
  type NativeAgentView,
  type NativeProviderSessionsView,
  type NativeSessionStateView,
} from "./nativeCliManager";
import { GatewayError } from "./error";
import { SessionRunRegistry } from "./sessionRunRegistry";
import type { TranscriptMessage } from "./transcript/types";

export type AgentView = AcpAgentView | NativeAgentView;
type AgentSessionStateView = AcpSessionStateView | NativeSessionStateView;

export class AgentManager {
  private readonly acp: AcpManager;
  private readonly native: NativeCliManager;
  private readonly runs = new SessionRunRegistry();

  constructor(
    private readonly config: AcpConfig,
    localChat: LocalChatManager | null,
  ) {
    this.acp = new AcpManager(config);
    this.native = new NativeCliManager(config, localChat);
  }

  listAgents(): AgentView[] {
    const byId = new Map<string, AgentView>();
    for (const agent of [...this.native.listAgents(), ...this.acp.listAgents()]) {
      byId.set(agent.id, agent);
    }
    return this.config.agents.flatMap((agent) => {
      const view = byId.get(agent.id);
      return view ? [view] : [];
    });
  }

  listSessions(agentId?: string) {
    const activeRuns = this.runs.list(agentId);
    const activeByConversation = new Map(
      activeRuns.map((run) => [`${run.agentId}:${run.conversationId}`, run]),
    );
    const sessions = [...this.native.listSessions(agentId), ...this.acp.listSessions(agentId)].map(
      (session) => {
        const active = activeByConversation.get(`${session.agentId}:${session.conversationId}`);
        if (!active) return { ...session, running: false };
        activeByConversation.delete(`${session.agentId}:${session.conversationId}`);
        return {
          ...session,
          sessionId: active.sessionId,
          lastUsed: active.lastUsed,
          running: true,
          startedAt: active.startedAt,
          ...(active.projectPath ? { projectPath: active.projectPath } : {}),
        };
      },
    );
    sessions.push(...activeByConversation.values());
    return sessions.sort((left, right) => right.lastUsed - left.lastUsed);
  }

  listProviderSessions(agentId: string) {
    if (this.acp.hasAgent(agentId)) return this.acp.listProviderSessions(agentId);
    if (this.native.hasAgent(agentId)) return this.native.listProviderSessions(agentId);
    return Promise.resolve({ supported: false, sessions: [] } satisfies NativeProviderSessionsView);
  }

  getSessionState(
    agentId: string,
    conversationId: string,
    projectPath?: string,
    providerSessionId?: string,
  ): Promise<AgentSessionStateView> {
    if (this.acp.hasAgent(agentId)) {
      return this.acp.getSessionState(agentId, conversationId, projectPath, providerSessionId);
    }
    return this.native.getSessionState(agentId, conversationId, projectPath, providerSessionId);
  }

  setSessionConfigOption(
    agentId: string,
    conversationId: string,
    configId: string,
    value: string | boolean,
    projectPath?: string,
    providerSessionId?: string,
  ): Promise<AgentSessionStateView> {
    if (this.acp.hasAgent(agentId)) {
      return this.acp.setSessionConfigOption(
        agentId,
        conversationId,
        configId,
        value,
        projectPath,
        providerSessionId,
      );
    }
    return this.native.setSessionConfigOption(
      agentId,
      conversationId,
      configId,
      value,
      projectPath,
      providerSessionId,
    );
  }

  async runTurn(
    agentId: string,
    conversationId: string,
    text: string,
    projectPath: string | undefined,
    providerSessionId: string | undefined,
    res: ServerResponse,
    _signal: AbortSignal,
  ): Promise<void> {
    const state = await this.getSessionState(
      agentId,
      conversationId,
      projectPath,
      providerSessionId,
    );
    const history = "history" in state && Array.isArray(state.history) ? state.history : [];
    const snapshot: TranscriptMessage[] = [
      ...history,
      {
        id: `open-chat-user-${Date.now()}`,
        role: "user",
        content: text,
      },
    ];
    const tracked = this.runs.start({
      agentId,
      conversationId,
      sessionId: state.sessionId,
      projectPath,
      snapshot,
      response: res,
    });
    try {
      if (this.acp.hasAgent(agentId)) {
        await this.acp.runTurn(
          agentId,
          conversationId,
          text,
          projectPath,
          providerSessionId,
          tracked.response,
          tracked.signal,
        );
      } else {
        await this.native.runTurn(
          agentId,
          conversationId,
          text,
          projectPath,
          tracked.response,
          tracked.signal,
          providerSessionId,
        );
      }
      this.runs.finish(agentId, conversationId);
    } catch (error) {
      this.runs.finish(agentId, conversationId, error);
      throw error;
    }
  }

  replyPermission(
    agentId: string,
    permissionId: string,
    response: "once" | "always" | "reject",
  ): Promise<void> {
    return this.managerFor(agentId).replyPermission(permissionId, response);
  }

  /** 订阅会话实时输出（SSE）；返回是否找到会话。ACP 走事件总线，pi / omp 走会话文件尾随。 */
  async subscribeSessionStream(
    agentId: string,
    conversationId: string,
    res: ServerResponse,
  ): Promise<boolean> {
    if (this.runs.subscribe(agentId, conversationId, res)) return true;
    if (this.acp.hasAgent(agentId)) {
      return this.acp.subscribeSessionStream(agentId, conversationId, res);
    }
    return this.native.subscribeSessionStream(agentId, conversationId, res);
  }

  /** 取消由 Open Chat 启动的运行中回合。 */
  async cancelTurn(agentId: string, conversationId: string): Promise<boolean> {
    const tracked = this.runs.cancel(agentId, conversationId);
    if (this.acp.hasAgent(agentId)) {
      return (await this.acp.cancelTurn(agentId, conversationId)) || tracked;
    }
    return tracked;
  }

  stop(): void {
    this.runs.stop();
    this.native.stop();
    this.acp.stop();
  }

  private managerFor(agentId: string): NativeCliManager | AcpManager {
    if (this.native.hasAgent(agentId)) return this.native;
    if (this.acp.hasAgent(agentId)) return this.acp;
    throw GatewayError.invalidRequest(`未知的本地 Agent：${agentId}`);
  }
}

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

export type AgentView = AcpAgentView | NativeAgentView;
type AgentSessionStateView = AcpSessionStateView | NativeSessionStateView;

export class AgentManager {
  private readonly acp: AcpManager;
  private readonly native: NativeCliManager;

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
    return [...this.native.listSessions(agentId), ...this.acp.listSessions(agentId)].sort(
      (left, right) => right.lastUsed - left.lastUsed,
    );
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

  runTurn(
    agentId: string,
    conversationId: string,
    text: string,
    projectPath: string | undefined,
    providerSessionId: string | undefined,
    res: ServerResponse,
    signal: AbortSignal,
  ): Promise<void> {
    if (this.acp.hasAgent(agentId)) {
      return this.acp.runTurn(
        agentId,
        conversationId,
        text,
        projectPath,
        providerSessionId,
        res,
        signal,
      );
    }
    return this.native.runTurn(
      agentId,
      conversationId,
      text,
      projectPath,
      res,
      signal,
      providerSessionId,
    );
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
    if (this.acp.hasAgent(agentId)) {
      return this.acp.subscribeSessionStream(agentId, conversationId, res);
    }
    return this.native.subscribeSessionStream(agentId, conversationId, res);
  }

  /** 取消运行中的 ACP 回合；原生 agent 返回 false（无服务端回合可取消）。 */
  async cancelTurn(agentId: string, conversationId: string): Promise<boolean> {
    if (this.acp.hasAgent(agentId)) return this.acp.cancelTurn(agentId, conversationId);
    return false;
  }

  stop(): void {
    this.native.stop();
    this.acp.stop();
  }

  private managerFor(agentId: string): NativeCliManager | AcpManager {
    if (this.native.hasAgent(agentId)) return this.native;
    if (this.acp.hasAgent(agentId)) return this.acp;
    throw GatewayError.invalidRequest(`未知的本地 Agent：${agentId}`);
  }
}

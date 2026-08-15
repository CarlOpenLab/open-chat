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
export type AgentSessionStateView = AcpSessionStateView | NativeSessionStateView;

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

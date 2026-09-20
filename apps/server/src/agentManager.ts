import type { ServerResponse } from "node:http";
import type { AcpConfig } from "./config";
import type { LocalChatManager } from "./localProvider";
import {
  AcpManager,
  type AcpAgentView,
  type AcpPermissionMode,
  type AcpSessionStateView,
} from "./acpManager";
import {
  OpenCodeManager,
  type OpenCodeAgentView,
  type OpenCodeSessionStateView,
} from "./openCodeManager";
import { GatewayError } from "./error";
import { SessionRunRegistry } from "./sessionRunRegistry";
import type { TranscriptMessage } from "./transcript/types";

export type AgentView = AcpAgentView | OpenCodeAgentView;
type AgentSessionStateView = AcpSessionStateView | OpenCodeSessionStateView;

export class AgentManager {
  private readonly acp: AcpManager;
  private readonly openCode: OpenCodeManager | null;
  private readonly runs = new SessionRunRegistry();

  constructor(
    private readonly config: AcpConfig,
    localChat: LocalChatManager | null,
  ) {
    this.acp = new AcpManager(config);
    this.openCode = localChat ? new OpenCodeManager(config, localChat) : null;
  }

  listAgents(): AgentView[] {
    const byId = new Map<string, AgentView>();
    for (const agent of this.acp.listAgents()) byId.set(agent.id, agent);
    if (this.openCode) {
      for (const agent of this.openCode.listAgents()) byId.set(agent.id, agent);
    }
    return this.config.agents.flatMap((agent) => {
      const view = byId.get(agent.id);
      return view ? [view] : [];
    });
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
    if (this.openCode?.hasAgent(agentId)) {
      return this.openCode.getSessionState(agentId, conversationId, projectPath, providerSessionId);
    }
    throw GatewayError.invalidRequest(`未知的本地 Agent：${agentId}`);
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
    if (this.openCode?.hasAgent(agentId)) {
      return this.openCode.setSessionConfigOption(
        agentId,
        conversationId,
        configId,
        value,
        projectPath,
        providerSessionId,
      );
    }
    throw GatewayError.invalidRequest(`未知的本地 Agent：${agentId}`);
  }

  async runTurn(
    agentId: string,
    conversationId: string,
    text: string,
    projectPath: string | undefined,
    providerSessionId: string | undefined,
    res: ServerResponse,
    permissionMode: AcpPermissionMode = "supervised",
  ): Promise<void> {
    const state = await this.getSessionState(
      agentId,
      conversationId,
      projectPath,
      providerSessionId,
    );
    const history = "messages" in state && Array.isArray(state.messages) ? state.messages : [];
    const snapshot: TranscriptMessage[] = [
      ...history,
      {
        id: `open-chat-user-${Date.now()}`,
        timestamp: Date.now(),
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
          permissionMode,
        );
      } else if (this.openCode?.hasAgent(agentId)) {
        await this.openCode.runTurn(
          agentId,
          conversationId,
          text,
          projectPath,
          providerSessionId,
          tracked.response,
          tracked.signal,
        );
      } else {
        throw GatewayError.invalidRequest(`未知的本地 Agent：${agentId}`);
      }
      this.runs.finish(agentId, conversationId);
    } catch (error) {
      // A user cancellation is a terminal state, not a failed turn. The
      // registry still emits [DONE] and removes the run, but does not publish a
      // misleading turn.failed event to other tabs subscribed to this session.
      this.runs.finish(agentId, conversationId, tracked.signal.aborted ? undefined : error);
      throw error;
    }
  }

  replyPermission(
    agentId: string,
    permissionId: string,
    response: "once" | "always" | "reject",
  ): Promise<void> {
    if (this.acp.hasAgent(agentId)) return this.acp.replyPermission(permissionId, response);
    throw GatewayError.invalidRequest(`未知的本地 Agent：${agentId}`);
  }

  /** 订阅由网关启动的会话事件流（SSE）；本地 CLI 不通过文件轮询伪造实时事件。 */
  async subscribeSessionStream(
    agentId: string,
    conversationId: string,
    res: ServerResponse,
  ): Promise<boolean> {
    if (this.runs.subscribe(agentId, conversationId, res)) return true;
    if (this.acp.hasAgent(agentId)) {
      return this.acp.subscribeSessionStream(agentId, conversationId, res);
    }
    return false;
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
    this.openCode?.stop();
    this.acp.stop();
  }
}

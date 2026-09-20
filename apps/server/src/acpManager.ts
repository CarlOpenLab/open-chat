import type { SessionConfigOption } from "@agentclientprotocol/sdk";
import type {
  AgentCapabilities,
  AgentSession,
  AcpAgentAdapter,
  SessionEvent,
  ToolCall,
} from "acp-hub-core";
import { createAcpAgentAdapter } from "acp-hub-core";
import { createClaudeAdapter } from "acp-hub-adapter-claude";
import { createCodexAdapter } from "acp-hub-adapter-codex";
import { createOhMyPiAdapter, createPiAdapter } from "acp-hub-adapter-pi";
import { randomUUID } from "node:crypto";
import type { ServerResponse } from "node:http";
import type { AcpAgentConfig, AcpConfig } from "./config";
import { cliProcessEnv, resolveExecutable } from "./commandEnv";
import { GatewayError } from "./error";
import { collectHubEvent, normalizeHubActivity, normalizeHubPlan } from "./transcript/adapters/hub";
import { readProviderFileHistory } from "./historyReaders";
import { defaultWorkspaceDir } from "./attachments";
import { createTranscriptCollector } from "./transcript/core";
import { writeTranscriptCustomEvent } from "./transcript/stream";
import { writeNativeEvent } from "./nativeEvents";
import type { TranscriptHistoryCollector, TranscriptMessage } from "./transcript/types";

export interface AcpAgentView {
  id: string;
  name: string;
  description: string;
  installed: boolean;
  available: boolean;
  enabled: boolean;
  transport: "stdio";
  protocol: "ACP";
  command: string;
  adapterHint?: string;
}

export interface AcpSessionStateView {
  agentId: string;
  conversationId: string;
  sessionId: string;
  configOptions: SessionConfigOption[];
  modes: AgentSession["raw"]["modes"];
  messages: TranscriptMessage[];
  loadSupported: boolean;
  /** 该 ACP 会话当前是否正在运行（服务端 activeRuns，回合进行中为 true）。 */
  running: boolean;
}

interface AcpRuntime {
  config: AcpAgentConfig;
  adapter: AcpAgentAdapter;
  connectPromise: Promise<AgentCapabilities> | null;
  capabilities: AgentCapabilities | null;
}

type AcpSessionResponse = Pick<AgentSession["raw"], "configOptions" | "modes">;

interface AcpSessionEntry {
  agentId: string;
  conversationId: string;
  /** ACP 侧 sessionId（provider session id）。 */
  sessionId: string;
  /**
   * 路由恢复后 agent 实际使用的会话 id（resume 重定向别名）。
   * 客户端应以此为准持久化为 providerSessionId，下次 resume 才能命中。
   */
  resolvedSessionId?: string;
  acpSession: AgentSession;
  response: AcpSessionResponse;
  history: TranscriptMessage[];
  createdAt: number;
  lastUsed: number;
}

interface ActiveRun {
  agentId: string;
  conversationId: string;
  response: ServerResponse;
  /** 本回合的权限模式（前端随请求携带）：full / auto 时服务端自动批准，不再转前端审批。 */
  permissionMode: AcpPermissionMode;
}

/** 权限模式：与前端 ChatInput 权限 chip 的取值一致。 */
export type AcpPermissionMode = "supervised" | "auto" | "full";

interface PendingPermission {
  id: string;
  agentId: string;
  sessionId: string;
  acpSession: AgentSession;
  requestId: string;
  options: Array<{ optionId: string; name: string; kind: string }>;
  timer: ReturnType<typeof setTimeout>;
}

/** 会话事件流缓冲条目（SSE 帧的序列化形态）。 */
interface AcpBusEvent {
  /** SSE 事件名；null 表示普通 `data:` 帧。 */
  event: string | null;
  data: string;
}

const HISTORY_MESSAGE_LIMIT = 2000;
/** 每个会话保留的最近事件数（重放上限）。 */
const BUS_BUFFER_LIMIT = 2000;

const CLIENT_INFO = { name: "Open Chat", version: "0.1.0" } as const;
/** 与 initialize 握手一起下发的客户端能力（保留原 ACP 路径的公告）。 */
const CLIENT_CAPABILITIES = { session: { configOptions: { boolean: {} } } } as const;

/**
 * 所有 stdio CLI agent（codex / claude / pi / omp / 自定义 ACP）的统一管理器，
 * 进程与协议层全部委托给 acp-hub 适配器（ACP over stdio）。本类只保留网关业务：
 * 会话缓存、权限桥接、历史收集、多订阅者总线与重放。
 */
export class AcpManager {
  private readonly runtimes = new Map<string, AcpRuntime>();
  private readonly sessions = new Map<string, AcpSessionEntry>();
  private readonly sessionsByAcpId = new Map<string, AcpSessionEntry>();
  private readonly activeRuns = new Map<string, ActiveRun>();
  private readonly pendingPermissions = new Map<string, PendingPermission>();
  private readonly historyCollectors = new Map<string, TranscriptHistoryCollector>();
  private readonly busBuffers = new Map<string, AcpBusEvent[]>();
  private readonly busSubscribers = new Map<string, Set<ServerResponse>>();
  /** 各会话当前回合开始时历史消息数（快照重放的分界点）。 */
  private readonly turnHistoryStart = new Map<string, number>();
  /** 各会话当前回合的 tool_call 合并快照（toolCallId → 最新完整快照）。 */
  private readonly toolCallSnapshots = new Map<string, Map<string, ToolCall>>();

  constructor(private readonly config: AcpConfig) {
    for (const agent of config.agents) {
      if (agent.transport === "opencode") continue;
      this.runtimes.set(agent.id, {
        config: agent,
        adapter: this.createAdapter(agent),
        connectPromise: null,
        capabilities: null,
      });
    }
  }

  hasAgent(agentId: string): boolean {
    return this.runtimes.has(agentId);
  }

  listAgents(): AcpAgentView[] {
    return [...this.runtimes.values()].map(({ config }) => {
      const installed = !!resolveExecutable(config.cliCommand || config.command);
      const adapterAvailable = !!resolveExecutable(config.command);
      return {
        id: config.id,
        name: config.name,
        description: config.description,
        installed,
        available: this.config.enabled && config.enabled && adapterAvailable,
        enabled: this.config.enabled && config.enabled,
        transport: "stdio",
        protocol: "ACP",
        command: [config.command, ...config.args].join(" "),
        ...(!adapterAvailable && config.adapterHint ? { adapterHint: config.adapterHint } : {}),
      };
    });
  }

  async getSessionState(
    agentId: string,
    conversationId: string,
    projectPath?: string,
    providerSessionId?: string,
  ): Promise<AcpSessionStateView> {
    const runtime = this.getAvailableRuntime(agentId);
    const session = await this.getOrCreateSession(
      runtime,
      conversationId,
      projectPath,
      providerSessionId,
    );
    return sessionStateView(
      session,
      this.effectiveConfigOptions(runtime, session),
      this.supportsSessionLoad(runtime),
      this.activeRuns.has(session.sessionId),
    );
  }

  async setSessionConfigOption(
    agentId: string,
    conversationId: string,
    configId: string,
    value: string | boolean,
    projectPath?: string,
    providerSessionId?: string,
  ): Promise<AcpSessionStateView> {
    const runtime = this.getAvailableRuntime(agentId);
    const session = await this.getOrCreateSession(
      runtime,
      conversationId,
      projectPath,
      providerSessionId,
    );
    if (this.activeRuns.has(session.sessionId)) {
      throw GatewayError.invalidRequest("该 ACP 会话仍在运行，暂时不能切换模型或配置");
    }

    const configOptions = this.effectiveConfigOptions(runtime, session);
    const option = configOptions.find((item) => item.id === configId);
    if (!option) throw GatewayError.invalidRequest(`ACP 配置项不存在：${configId}`);
    validateConfigValue(option, value);

    const response = await session.acpSession.setConfigOption?.(
      option.type === "boolean"
        ? { sessionId: session.sessionId, configId, type: "boolean", value: value as boolean }
        : { sessionId: session.sessionId, configId, value: value as string },
    );
    if (!response) throw GatewayError.invalidRequest(`${runtime.config.name} 不支持修改配置`);
    session.response = { ...session.response, configOptions: response.configOptions };
    session.lastUsed = Date.now();
    return sessionStateView(
      session,
      this.effectiveConfigOptions(runtime, session),
      this.supportsSessionLoad(runtime),
      this.activeRuns.has(session.sessionId),
    );
  }

  async runTurn(
    agentId: string,
    conversationId: string,
    text: string,
    projectPath: string | undefined,
    providerSessionId: string | undefined,
    res: ServerResponse,
    signal: AbortSignal,
    permissionMode: AcpPermissionMode = "supervised",
  ): Promise<void> {
    const runtime = this.getAvailableRuntime(agentId);

    const session = await this.getOrCreateSession(
      runtime,
      conversationId,
      projectPath,
      providerSessionId,
    );
    if (this.activeRuns.has(session.sessionId)) {
      throw GatewayError.invalidRequest("该 ACP 会话仍在运行，请先停止当前任务");
    }

    const run: ActiveRun = {
      agentId,
      conversationId,
      response: res,
      permissionMode,
    };
    this.activeRuns.set(session.sessionId, run);
    session.lastUsed = Date.now();

    // 回合边界：清空事件缓冲（重放只覆盖当前回合），并把用户消息写入历史
    // （快照按 turnHistoryStart 截断，新订阅者以此重建会话视图）。
    this.busBuffers.delete(session.sessionId);
    this.toolCallSnapshots.delete(session.sessionId);
    const collector = this.historyCollectors.get(session.sessionId);
    if (collector) {
      collector.messages.push({
        id: `acp-history-${collector.nextId++}`,
        timestamp: Date.now(),
        role: "user",
        content: text,
      });
      collector.activeRole = "user";
      if (collector.messages.length > HISTORY_MESSAGE_LIMIT) {
        collector.messages.splice(0, collector.messages.length - HISTORY_MESSAGE_LIMIT);
      }
      this.turnHistoryStart.set(session.sessionId, collector.messages.length);
    }

    try {
      // acp-hub 的 prompt 已内置 abort → session/cancel 竞速：用户按下停止时
      // prompt 以 AbortError 拒绝，activeRuns 与注册表随之释放。
      const result = await session.acpSession.prompt(text, { signal });
      this.emitCustom(session.sessionId, res, "acp_turn", {
        agentId,
        sessionId: session.sessionId,
        stopReason: result.stopReason,
        usage: result.usage,
      });
      this.emitNative(session.sessionId, res, {
        type: "turn.completed",
        stopReason: result.stopReason,
      });
      if (!res.writableEnded && !res.destroyed) {
        res.write("data: [DONE]\n\n");
        res.end();
      }
    } finally {
      this.activeRuns.delete(session.sessionId);
      this.turnHistoryStart.delete(session.sessionId);
      this.cancelPermissionsForSession(session.sessionId);
      this.endSessionStream(session.sessionId);
    }
  }

  async replyPermission(
    permissionId: string,
    response: "once" | "always" | "reject",
  ): Promise<void> {
    const pending = this.pendingPermissions.get(permissionId);
    if (!pending) {
      throw GatewayError.invalidRequest("权限请求不存在、已处理或已超时");
    }
    const preferredKind =
      response === "always" ? "allow_always" : response === "once" ? "allow_once" : "reject_once";
    const option =
      pending.options.find((item) => item.kind === preferredKind) ??
      (response === "reject"
        ? pending.options.find((item) => item.kind === "reject_always")
        : pending.options.find((item) => item.kind.startsWith("allow_")));
    if (!option) throw GatewayError.invalidRequest("Agent 没有提供对应的权限选项");
    clearTimeout(pending.timer);
    this.pendingPermissions.delete(permissionId);
    await pending.acpSession.respondPermission(pending.requestId, option.optionId);
  }

  stop(): void {
    for (const pending of this.pendingPermissions.values()) clearTimeout(pending.timer);
    this.pendingPermissions.clear();
    this.historyCollectors.clear();
    this.activeRuns.clear();
    this.sessions.clear();
    this.sessionsByAcpId.clear();
    this.busBuffers.clear();
    this.busSubscribers.clear();
    this.turnHistoryStart.clear();
    this.toolCallSnapshots.clear();
    for (const runtime of this.runtimes.values()) {
      void runtime.adapter.dispose().catch(() => {});
      runtime.connectPromise = null;
      runtime.capabilities = null;
    }
  }

  /** 订阅会话事件流：先发历史快照（含当前回合的用户消息），再重放当前回合输出，随后实时推送。找不到会话返回 false。 */
  subscribeSessionStream(agentId: string, conversationId: string, res: ServerResponse): boolean {
    const session = [...this.sessions.values()].find(
      (entry) => entry.agentId === agentId && entry.conversationId === conversationId,
    );
    if (!session) return false;

    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    // 1) 快照：当前回合之前的历史（含注入的用户消息），新订阅者据此重建会话视图
    const snapshotEnd = this.turnHistoryStart.get(session.sessionId) ?? session.history.length;
    const snapshotMessages = session.history.slice(0, snapshotEnd);
    res.write(`event: snapshot\ndata: ${JSON.stringify({ messages: snapshotMessages })}\n\n`);
    // 2) 重放当前回合已产生的输出
    const buffer = this.busBuffers.get(session.sessionId);
    if (buffer) {
      for (const entry of buffer) AcpManager.writeBusFrame(res, entry);
    }
    // 3) 实时推送
    const subscribers = this.busSubscribers.get(session.sessionId) ?? new Set<ServerResponse>();
    subscribers.add(res);
    this.busSubscribers.set(session.sessionId, subscribers);
    res.on("close", () => {
      subscribers.delete(res);
      if (subscribers.size === 0) this.busSubscribers.delete(session.sessionId);
    });
    return true;
  }

  /** 取消正在运行的回合（多标签 / 刷新恢复后停止孤儿回合）；无运行回合返回 false。 */
  async cancelTurn(agentId: string, conversationId: string): Promise<boolean> {
    const session = [...this.sessions.values()].find(
      (entry) => entry.agentId === agentId && entry.conversationId === conversationId,
    );
    if (!session) return false;
    const run = this.activeRuns.get(session.sessionId);
    if (!run) return false;
    await session.acpSession.interrupt().catch(() => {});
    this.cancelPermissionsForSession(session.sessionId);
    return true;
  }

  /** 按传输方式构造 acp-hub 适配器；内置 CLI 走各自的 ACP 桥接包。 */
  private createAdapter(agent: AcpAgentConfig): AcpAgentAdapter {
    const client = {
      clientInfo: { ...CLIENT_INFO },
      clientCapabilities: { ...CLIENT_CAPABILITIES },
      logger: (level: "debug" | "info" | "warn" | "error", message: string, extra?: unknown) => {
        const line = `[acp:${agent.id}] ${message}`;
        if (level === "error") console.error(line, extra ?? "");
        else if (level === "warn") console.warn(line, extra ?? "");
        else console.error(level === "debug" ? `${line} ${JSON.stringify(extra ?? {})}` : line);
      },
    };
    // 桥接进程的环境：
    // - PATH 用网关的可执行文件搜索路径（含 ~/.local/bin 等常见目录），保证
    //   桥接包内部再 spawn CLI 时与旧原生路径的发现能力一致；
    // - claude 桥需清掉 CLAUDECODE：网关若运行在 Claude Code 会话内，继承的
    //   该变量会让 claude CLI 拒绝嵌套启动。
    const executable = resolveExecutable(agent.command) ?? agent.command;
    const bridgeEnv: Record<string, string | undefined> = {
      PATH: cliProcessEnv(executable).PATH,
      ...(agent.transport === "claude" ? { CLAUDECODE: undefined } : {}),
    };
    // config.command/args 是桥接启动命令的唯一事实来源（见 config.ts 默认值），
    // 传给工厂即覆盖 acp-hub 的 npx 预设；留空时回落到工厂默认。
    const launch = {
      ...(agent.command ? { command: agent.command } : {}),
      ...(agent.args.length > 0 ? { args: [...agent.args] } : {}),
      ...(agent.cwd ? { cwd: agent.cwd } : {}),
      env: bridgeEnv,
    };
    switch (agent.transport) {
      case "codex":
        return createCodexAdapter({ ...launch, client });
      case "claude":
        return createClaudeAdapter({ ...launch, client });
      case "pi":
        return createPiAdapter({ ...launch, client });
      case "omp":
        return createOhMyPiAdapter({ ...launch, client });
      default:
        return createAcpAgentAdapter(
          agent.id,
          {
            command: agent.command,
            args: [...agent.args],
            ...(agent.cwd ? { cwd: agent.cwd } : {}),
            env: bridgeEnv,
          },
          client,
        );
    }
  }

  private async getOrCreateSession(
    runtime: AcpRuntime,
    conversationId: string,
    projectPath?: string,
    providerSessionId?: string,
  ): Promise<AcpSessionEntry> {
    const key = `${runtime.config.id}:${conversationId}:${projectPath || ""}`;
    const existing = this.sessions.get(key);
    if (existing) {
      existing.lastUsed = Date.now();
      return existing;
    }
    const adapter = await this.adapterFor(runtime);
    const cwd = projectPath || runtime.config.cwd || this.config.cwd || defaultWorkspaceDir();
    const normalizedProviderSessionId = providerSessionId?.trim();
    if (normalizedProviderSessionId) {
      const loaded = this.sessionsByAcpId.get(normalizedProviderSessionId);
      if (loaded && loaded.agentId === runtime.config.id) {
        loaded.lastUsed = Date.now();
        this.sessions.set(key, loaded);
        return loaded;
      }
      if (loaded && loaded.agentId !== runtime.config.id) {
        // 会话 id 属于另一个 Agent：跨 agent 恢复会让对方静默新建内部会话并
        // 丢弃全部 update（正文无输出）。忽略该 id，按新会话开始。
        console.warn(
          `[acp:${runtime.config.id}] providerSessionId ${normalizedProviderSessionId} belongs to ` +
            `agent ${loaded.agentId}; starting a fresh session instead of cross-agent resume`,
        );
      } else {
        if (!this.supportsSessionLoad(runtime)) {
          throw GatewayError.invalidRequest(`${runtime.config.name} 不支持恢复历史 ACP 会话`);
        }

        const acpSession = await adapter.createSession({
          cwd,
          resumeSessionId: normalizedProviderSessionId,
        });
        const entry = this.registerSession(runtime, conversationId, acpSession, key);
        // 内置 CLI 持久化在原生格式里的历史（终端直开的会话）播种进 collector，
        // 让深链/恢复的会话立即有完整可渲染的历史。
        const history = await readProviderFileHistory(
          runtime.config,
          normalizedProviderSessionId,
          cwd,
          runtime.config.transport !== "acp",
        );
        if (history.length > 0) {
          const collector = this.historyCollectors.get(normalizedProviderSessionId);
          if (collector) {
            collector.messages.push(...history);
            collector.activeRole = "content";
          }
        }
        return entry;
      }
    }
    const acpSession = await adapter.createSession({ cwd });
    return this.registerSession(runtime, conversationId, acpSession, key);
  }

  /** 注册新会话：建 collector、登记索引、启动事件泵。 */
  private registerSession(
    runtime: AcpRuntime,
    conversationId: string,
    acpSession: AgentSession,
    key: string,
  ): AcpSessionEntry {
    // 常驻 collector：新会话也在生命周期内持续收集消息（含后续回合），
    // 供状态查询与订阅快照重建完整会话视图。
    const collector = createTranscriptCollector();
    this.historyCollectors.set(acpSession.id, collector);
    const entry: AcpSessionEntry = {
      agentId: runtime.config.id,
      conversationId,
      sessionId: acpSession.id,
      acpSession,
      response: {
        configOptions: acpSession.raw.configOptions ?? [],
        modes: acpSession.raw.modes ?? null,
      },
      history: collector.messages,
      createdAt: Date.now(),
      lastUsed: Date.now(),
    };
    this.sessions.set(key, entry);
    this.sessionsByAcpId.set(acpSession.id, entry);
    // resume 重定向恢复：agent 用另一个 id 推 update 时，连接层会认领别名，
    // 这里把真实 id 广播给订阅者，让客户端持久化为新的 providerSessionId。
    acpSession.onAlias = (alias) => this.handleSessionAlias(entry, alias);
    void this.pumpEvents(entry);
    return entry;
  }

  /** 会话别名被认领：登记索引、更新解析 id、通知订阅者更新 providerSessionId。 */
  private handleSessionAlias(entry: AcpSessionEntry, alias: string): void {
    if (this.sessionsByAcpId.get(alias) && this.sessionsByAcpId.get(alias) !== entry) {
      console.warn(
        `[acp:${entry.agentId}] session alias ${alias} already belongs to another session; ignored`,
      );
      return;
    }
    this.sessionsByAcpId.set(alias, entry);
    entry.resolvedSessionId = alias;
    entry.lastUsed = Date.now();
    console.log(
      `[acp:${entry.agentId}] session resumed as ${alias} (reassigned by agent); ` +
        `conversation ${entry.conversationId} should adopt the new providerSessionId`,
    );
    // 走 provider_session 通道：前端 onProviderSession 会把它持久化为新的
    // providerSessionId，下次 resume 直接命中真实 id，不再触发重定向。
    const run = this.activeRuns.get(entry.sessionId);
    this.emitCustom(entry.sessionId, run?.response, "provider_session", {
      agentId: entry.agentId,
      sessionId: alias,
    });
  }

  /** 会话事件泵：把 acp-hub 统一事件流翻译成 native_event / 自定义帧并累积历史。 */
  private async pumpEvents(entry: AcpSessionEntry): Promise<void> {
    try {
      for await (const event of entry.acpSession.events) {
        this.handleSessionEvent(entry, event);
      }
    } catch (error) {
      console.error(`[acp:${entry.agentId}] session event pump failed:`, error);
    }
  }

  private handleSessionEvent(entry: AcpSessionEntry, event: SessionEvent): void {
    const collector = this.historyCollectors.get(entry.sessionId);
    if (collector && event.type !== "tool_call" && event.type !== "tool_call_update") {
      collectHubEvent(collector, event);
    }

    const run = this.activeRuns.get(entry.sessionId);
    const res = run?.response;
    switch (event.type) {
      case "message_delta":
        if (event.text) {
          this.emitNative(entry.sessionId, res, { type: "content.delta", content: event.text });
        }
        break;
      case "thought_delta":
        if (event.text) {
          this.emitNative(entry.sessionId, res, { type: "reasoning.delta", content: event.text });
        }
        break;
      case "tool_call":
      case "tool_call_update": {
        // ACP 的 tool_call_update 常只携带变化字段（title 可能只在初次
        // tool_call 上出现）：先与会话内快照合并再翻译，避免名称退化为通用值。
        const toolCall = this.mergeToolCall(entry.sessionId, event.toolCall);
        if (collector) collectHubEvent(collector, { type: event.type, toolCall });
        this.emitNative(entry.sessionId, res, {
          type: "activity.upsert",
          activity: normalizeHubActivity(toolCall),
        });
        break;
      }
      case "plan":
        this.emitNative(entry.sessionId, res, {
          type: "plan.updated",
          plan: { entries: normalizeHubPlan(event.entries) },
        });
        break;
      case "mode_update":
      case "commands_update":
      case "session_info":
      case "usage":
        // 自定义控制帧：前端消费 usage / 模式 / 命令列表。
        this.emitCustom(entry.sessionId, res, "acp_session", hubControlPayload(event));
        break;
      case "permission_request":
        this.handlePermission(entry, event).catch((error) => {
          console.error(`[acp:${entry.agentId}] permission handling failed:`, error);
        });
        break;
      case "agent_error":
        console.error(`[acp:${entry.agentId}] agent error:`, event.message);
        break;
      default:
        break;
    }
  }

  /**
   * 合并 tool_call 快照：update 只覆盖已定义字段，返回合并后的完整 ToolCall。
   * 快照按回合清空（见 runTurn 的回合边界清理）。
   */
  private mergeToolCall(sessionId: string, toolCall: ToolCall): ToolCall {
    const snapshot = this.toolCallSnapshots.get(sessionId) ?? new Map<string, ToolCall>();
    const previous = snapshot.get(toolCall.toolCallId);
    const definedEntries = Object.fromEntries(
      Object.entries(toolCall).filter(([, value]) => value !== undefined),
    ) as Partial<ToolCall>;
    const merged = { ...previous, ...definedEntries } as ToolCall;
    snapshot.set(toolCall.toolCallId, merged);
    this.toolCallSnapshots.set(sessionId, snapshot);
    return merged;
  }

  private async handlePermission(
    entry: AcpSessionEntry,
    event: Extract<SessionEvent, { type: "permission_request" }>,
  ): Promise<void> {
    const run = this.activeRuns.get(entry.sessionId);
    if (!run) {
      await entry.acpSession.cancelPermission(event.requestId).catch(() => {});
      return;
    }
    // full / auto 模式：服务端直接代批准，不再打扰前端。
    // full 优先永久允许（allow_always）；auto 逐次允许（allow_once，不沉淀白名单）。
    // Agent 未提供任何 allow 选项时回落到前端人工审批。
    if (run.permissionMode !== "supervised") {
      const preferredKind = run.permissionMode === "full" ? "allow_always" : "allow_once";
      const option =
        event.options.find((item) => item.kind === preferredKind) ??
        event.options.find((item) => item.kind.startsWith("allow_"));
      if (option) {
        await entry.acpSession.respondPermission(event.requestId, option.optionId).catch(() => {});
        return;
      }
    }
    const id = randomUUID();
    const patterns =
      event.toolCall?.locations?.map((location) => location.path).filter(Boolean) ?? [];
    this.emitCustom(entry.sessionId, run.response, "chat_permission", {
      id,
      version: "acp",
      agentId: entry.agentId,
      permission: event.toolCall?.kind || event.toolCall?.title || "tool",
      patterns,
      metadata: {
        ...(event.toolCall?.title !== undefined ? { title: event.toolCall.title } : {}),
        ...(event.toolCall?.rawInput !== undefined ? { input: event.toolCall.rawInput } : {}),
      },
      options: event.options,
      ...(event.toolCall ? { tool: { callID: event.toolCall.toolCallId } } : {}),
    });

    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingPermissions.delete(id);
        void entry.acpSession.cancelPermission(event.requestId).catch(() => {});
        resolve();
      }, this.config.permissionTimeoutMs);
      this.pendingPermissions.set(id, {
        id,
        agentId: entry.agentId,
        sessionId: entry.sessionId,
        acpSession: entry.acpSession,
        requestId: event.requestId,
        options: event.options,
        timer,
      });
    });
  }

  private cancelPermissionsForSession(sessionId: string): void {
    for (const [id, pending] of this.pendingPermissions) {
      if (pending.sessionId !== sessionId) continue;
      clearTimeout(pending.timer);
      this.pendingPermissions.delete(id);
      void pending.acpSession.cancelPermission(pending.requestId).catch(() => {});
    }
  }

  /** 有效配置列表：桥接包在 ACP 会话响应里广告什么就展示什么。 */
  private effectiveConfigOptions(
    _runtime: AcpRuntime,
    session: AcpSessionEntry,
  ): SessionConfigOption[] {
    return session.response.configOptions ?? [];
  }

  private supportsSessionLoad(runtime: AcpRuntime): boolean {
    return runtime.capabilities?.supportsLoad === true;
  }

  private getAvailableRuntime(agentId: string): AcpRuntime {
    if (!this.config.enabled) throw GatewayError.invalidRequest("ACP 服务未启用");
    const runtime = this.runtimes.get(agentId);
    if (!runtime || !runtime.config.enabled) {
      throw GatewayError.invalidRequest(`未知或未启用的 ACP Agent：${agentId}`);
    }
    if (!resolveExecutable(runtime.config.command)) {
      throw GatewayError.invalidRequest(
        `${runtime.config.name} 的 ACP 适配器不可用：${runtime.config.command}`,
      );
    }
    return runtime;
  }

  /** 连接（幂等）；进程死亡后重建适配器重试一次。 */
  private async adapterFor(runtime: AcpRuntime): Promise<AcpAgentAdapter> {
    if (!runtime.connectPromise) {
      runtime.connectPromise = runtime.adapter.connect().then((capabilities) => {
        runtime.capabilities = capabilities;
        return capabilities;
      });
    }
    try {
      await runtime.connectPromise;
      return runtime.adapter;
    } catch {
      runtime.connectPromise = null;
      runtime.capabilities = null;
      // acp-hub 连接死亡后不可复用（dispose 语义）：换新适配器重试一次。
      await runtime.adapter.dispose().catch(() => {});
      runtime.adapter = this.createAdapter(runtime.config);
      runtime.connectPromise = runtime.adapter.connect().then((capabilities) => {
        runtime.capabilities = capabilities;
        return capabilities;
      });
      await runtime.connectPromise;
      return runtime.adapter;
    }
  }

  /** 发布事件到会话总线：写入缓冲 + 推送所有订阅者（与发起者 SSE 写盘解耦）。 */
  private publishToBus(sessionId: string, event: string | null, data: unknown): void {
    const payload = typeof data === "string" ? data : JSON.stringify(data);
    const entry: AcpBusEvent = { event, data: payload };
    const buffer = this.busBuffers.get(sessionId) ?? [];
    buffer.push(entry);
    if (buffer.length > BUS_BUFFER_LIMIT) {
      buffer.splice(0, buffer.length - BUS_BUFFER_LIMIT);
    }
    this.busBuffers.set(sessionId, buffer);
    const subscribers = this.busSubscribers.get(sessionId);
    if (subscribers) {
      for (const res of subscribers) AcpManager.writeBusFrame(res, entry);
    }
  }

  private static writeBusFrame(res: ServerResponse, entry: AcpBusEvent): void {
    if (res.writableEnded || res.destroyed) return;
    res.write(
      entry.event ? `event: ${entry.event}\ndata: ${entry.data}\n\n` : `data: ${entry.data}\n\n`,
    );
  }

  /** 回合结束：向所有订阅者广播 [DONE] 并关闭连接（缓冲保留供后续重放）。 */
  private endSessionStream(sessionId: string): void {
    const subscribers = this.busSubscribers.get(sessionId);
    if (!subscribers) return;
    for (const res of subscribers) {
      if (res.writableEnded || res.destroyed) continue;
      res.write("data: [DONE]\n\n");
      res.end();
    }
    this.busSubscribers.delete(sessionId);
  }

  /** 向发起者 SSE 与会话总线同时写原生事件。 */
  private emitNative(
    sessionId: string,
    res: ServerResponse | undefined,
    event: Parameters<typeof writeNativeEvent>[1],
  ): void {
    const payload = JSON.stringify(event);
    this.publishToBus(sessionId, "native_event", payload);
    if (res) writeNativeEvent(res, event);
  }

  /** 向发起者 SSE 与会话总线同时写自定义事件。 */
  private emitCustom(
    sessionId: string,
    res: ServerResponse | undefined,
    event: string,
    data: unknown,
  ): void {
    this.publishToBus(sessionId, event, data);
    if (res && !res.writableEnded && !res.destroyed) {
      writeTranscriptCustomEvent(res, event, data);
    }
  }
}

/** 自定义 acp_session 控制帧负载：usage / 模式 / 命令列表 / 会话信息。 */
function hubControlPayload(
  event: Extract<
    SessionEvent,
    { type: "mode_update" | "commands_update" | "session_info" | "usage" }
  >,
): Record<string, unknown> {
  switch (event.type) {
    case "mode_update":
      return {
        sessionUpdate: "current_mode_update",
        currentModeId: event.currentModeId,
        ...(event.availableModes ? { availableModes: event.availableModes } : {}),
      };
    case "commands_update":
      return { sessionUpdate: "available_commands_update", availableCommands: event.commands };
    case "session_info":
      return { sessionUpdate: "session_info_update", sessionInfo: event };
    case "usage":
      return { sessionUpdate: "usage_update", usage: event.usage };
  }
}

function sessionStateView(
  session: AcpSessionEntry,
  configOptions: SessionConfigOption[],
  loadSupported: boolean,
  running: boolean,
): AcpSessionStateView {
  return {
    agentId: session.agentId,
    conversationId: session.conversationId,
    // 有 resume 重定向别名时返回真实 id，客户端据此持久化 providerSessionId
    sessionId: session.resolvedSessionId ?? session.sessionId,
    configOptions,
    modes: session.response.modes ?? null,
    messages: session.history,
    loadSupported,
    running,
  };
}

function validateConfigValue(option: SessionConfigOption, value: string | boolean): void {
  if (option.type === "boolean") {
    if (typeof value !== "boolean") {
      throw GatewayError.invalidRequest(`${option.name} 需要布尔值`);
    }
    return;
  }
  if (typeof value !== "string") {
    throw GatewayError.invalidRequest(`${option.name} 需要选项值`);
  }
  const values = option.options.flatMap((item) =>
    "options" in item ? item.options.map((nested) => nested.value) : [item.value],
  );
  if (!values.includes(value)) {
    throw GatewayError.invalidRequest(`${option.name} 不支持选项：${value}`);
  }
}

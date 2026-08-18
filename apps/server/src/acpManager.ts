import {
  ClientSideConnection,
  PROTOCOL_VERSION,
  ndJsonStream,
  type InitializeResponse,
  type LoadSessionResponse,
  type NewSessionResponse,
  type PermissionOption,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionConfigOption,
  type SessionNotification,
} from "@agentclientprotocol/sdk";
import { randomUUID } from "node:crypto";
import type { ServerResponse } from "node:http";
import { Readable, Writable } from "node:stream";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { AcpAgentConfig, AcpConfig } from "./config";
import { cliProcessEnv, resolveExecutable } from "./commandEnv";
import { GatewayError } from "./error";
import {
  collectAcpHistoryUpdate,
  normalizeAcpActivity,
  normalizeAcpPlan,
} from "./transcript/adapters/acp";
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
  modes: NewSessionResponse["modes"];
  messages: TranscriptMessage[];
  loadSupported: boolean;
  /** 该 ACP 会话当前是否正在运行（服务端 activeRuns，回合进行中为 true）。 */
  running: boolean;
}

interface AcpProviderSessionView {
  sessionId: string;
  cwd: string;
  title?: string;
  updatedAt?: string;
}

interface AcpProviderSessionsView {
  supported: boolean;
  sessions: AcpProviderSessionView[];
}

interface AcpRuntime {
  config: AcpAgentConfig;
  child: ChildProcessWithoutNullStreams | null;
  connection: ClientSideConnection | null;
  startPromise: Promise<ClientSideConnection> | null;
  initialized: InitializeResponse | null;
}

type AcpSessionResponse = Pick<NewSessionResponse, "configOptions" | "modes"> | LoadSessionResponse;

interface AcpSessionEntry {
  agentId: string;
  conversationId: string;
  sessionId: string;
  response: AcpSessionResponse;
  history: TranscriptMessage[];
  createdAt: number;
  lastUsed: number;
}

interface ActiveRun {
  agentId: string;
  conversationId: string;
  response: ServerResponse;
}

interface PendingPermission {
  id: string;
  agentId: string;
  sessionId: string;
  options: PermissionOption[];
  resolve: (response: RequestPermissionResponse) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** 会话事件流缓冲条目（SSE 帧的序列化形态）。 */
interface AcpBusEvent {
  /** SSE 事件名；null 表示普通 `data:` 帧。 */
  event: string | null;
  data: string;
}

const PROCESS_START_TIMEOUT_MS = 15_000;
/** 每个会话保留的最近事件数（重放上限）。 */
const BUS_BUFFER_LIMIT = 2000;
/** 会话历史消息数上限（防长会话内存膨胀）。 */
const HISTORY_MESSAGE_LIMIT = 2000;

export class AcpManager {
  private readonly runtimes = new Map<string, AcpRuntime>();
  private readonly sessions = new Map<string, AcpSessionEntry>();
  private readonly activeRuns = new Map<string, ActiveRun>();
  private readonly pendingPermissions = new Map<string, PendingPermission>();
  private readonly historyCollectors = new Map<string, TranscriptHistoryCollector>();
  private readonly busBuffers = new Map<string, AcpBusEvent[]>();
  private readonly busSubscribers = new Map<string, Set<ServerResponse>>();
  /** 各会话当前回合开始时历史消息数（快照重放的分界点）。 */
  private readonly turnHistoryStart = new Map<string, number>();

  constructor(private readonly config: AcpConfig) {
    for (const agent of config.agents) {
      if (agent.transport !== "acp") continue;
      this.runtimes.set(agent.id, {
        config: agent,
        child: null,
        connection: null,
        startPromise: null,
        initialized: null,
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

  listSessions(agentId?: string): Array<{
    agentId: string;
    conversationId: string;
    sessionId: string;
    createdAt: number;
    lastUsed: number;
    running: boolean;
  }> {
    return [...this.sessions.values()]
      .filter((entry) => !agentId || entry.agentId === agentId)
      .map((entry) => ({
        agentId: entry.agentId,
        conversationId: entry.conversationId,
        sessionId: entry.sessionId,
        createdAt: entry.createdAt,
        lastUsed: entry.lastUsed,
        running: this.activeRuns.has(entry.sessionId),
      }))
      .sort((left, right) => right.lastUsed - left.lastUsed);
  }

  async listProviderSessions(agentId: string): Promise<AcpProviderSessionsView> {
    const runtime = this.getAvailableRuntime(agentId);
    const connection = await this.connectionFor(runtime);
    if (runtime.initialized?.agentCapabilities?.sessionCapabilities?.list == null) {
      return { supported: false, sessions: [] };
    }

    const sessions: AcpProviderSessionView[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 100; page += 1) {
      const response = await connection.listSessions(cursor ? { cursor } : {});
      sessions.push(
        ...response.sessions.map((session) => ({
          sessionId: session.sessionId,
          cwd: session.cwd,
          ...(session.title ? { title: session.title } : {}),
          ...(session.updatedAt ? { updatedAt: session.updatedAt } : {}),
        })),
      );
      cursor = response.nextCursor || undefined;
      if (!cursor) break;
    }
    return { supported: true, sessions };
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

    const option = session.response.configOptions?.find((item) => item.id === configId);
    if (!option) throw GatewayError.invalidRequest(`ACP 配置项不存在：${configId}`);
    validateConfigValue(option, value);

    const connection = await this.connectionFor(runtime);
    const response = await connection.setSessionConfigOption(
      option.type === "boolean"
        ? { sessionId: session.sessionId, configId, type: "boolean", value: value as boolean }
        : { sessionId: session.sessionId, configId, value: value as string },
    );
    session.response = { ...session.response, configOptions: response.configOptions };
    session.lastUsed = Date.now();
    return sessionStateView(
      session,
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

    const connection = await this.connectionFor(runtime);
    const run: ActiveRun = {
      agentId,
      conversationId,
      response: res,
    };
    this.activeRuns.set(session.sessionId, run);
    session.lastUsed = Date.now();
    let rejectPromptAbort: ((reason: unknown) => void) | null = null;
    const cancel = () => {
      void connection.cancel({ sessionId: session.sessionId }).catch(() => {});
      rejectPromptAbort?.(createAbortError());
    };
    signal.addEventListener("abort", cancel, { once: true });

    // 回合边界：清空事件缓冲（重放只覆盖当前回合），并把用户消息写入历史
    // （快照按 turnHistoryStart 截断，新订阅者以此重建会话视图）。
    this.busBuffers.delete(session.sessionId);
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
      // ACP providers are allowed to acknowledge cancellation asynchronously,
      // and some keep `prompt()` pending until the underlying process exits.
      // Race the protocol call with the gateway abort so the run registry and
      // session state are always released when the user presses Stop.
      const promptAborted = new Promise<never>((_resolve, reject) => {
        rejectPromptAbort = reject;
      });
      if (signal.aborted) {
        cancel();
        throw createAbortError();
      }
      const promptResponse = connection.prompt({
        sessionId: session.sessionId,
        prompt: [{ type: "text", text }],
      });
      const response = await Promise.race([promptResponse, promptAborted]);
      this.emitCustom(session.sessionId, res, "acp_turn", {
        agentId,
        sessionId: session.sessionId,
        stopReason: response.stopReason,
        usage: response.usage,
      });
      this.emitNative(session.sessionId, res, {
        type: "turn.completed",
        stopReason: response.stopReason,
      });
      if (!res.writableEnded && !res.destroyed) {
        res.write("data: [DONE]\n\n");
        res.end();
      }
    } finally {
      signal.removeEventListener("abort", cancel);
      rejectPromptAbort = null;
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
    pending.resolve({ outcome: { outcome: "selected", optionId: option.optionId } });
  }

  stop(): void {
    for (const pending of this.pendingPermissions.values()) {
      clearTimeout(pending.timer);
      pending.resolve({ outcome: { outcome: "cancelled" } });
    }
    this.pendingPermissions.clear();
    this.historyCollectors.clear();
    this.activeRuns.clear();
    this.sessions.clear();
    this.busBuffers.clear();
    this.busSubscribers.clear();
    this.turnHistoryStart.clear();
    for (const runtime of this.runtimes.values()) {
      runtime.child?.kill("SIGTERM");
      runtime.connection = null;
      runtime.child = null;
      runtime.startPromise = null;
      runtime.initialized = null;
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
    const connection = await this.connectionFor(runtime);
    const cwd = projectPath || runtime.config.cwd || this.config.cwd || defaultWorkspaceDir();
    const normalizedProviderSessionId = providerSessionId?.trim();
    if (normalizedProviderSessionId) {
      const loaded = [...this.sessions.values()].find(
        (entry) =>
          entry.agentId === runtime.config.id && entry.sessionId === normalizedProviderSessionId,
      );
      if (loaded) {
        loaded.lastUsed = Date.now();
        this.sessions.set(key, loaded);
        return loaded;
      }
      if (!this.supportsSessionLoad(runtime)) {
        throw GatewayError.invalidRequest(`${runtime.config.name} 不支持恢复历史 ACP 会话`);
      }

      const collector = createTranscriptCollector();
      this.historyCollectors.set(normalizedProviderSessionId, collector);
      const response = await connection.loadSession({
        sessionId: normalizedProviderSessionId,
        cwd,
        mcpServers: [],
      });
      const entry: AcpSessionEntry = {
        agentId: runtime.config.id,
        conversationId,
        sessionId: normalizedProviderSessionId,
        response,
        history: collector.messages,
        createdAt: Date.now(),
        lastUsed: Date.now(),
      };
      this.sessions.set(key, entry);
      return entry;
    }
    const response = await connection.newSession({
      cwd,
      mcpServers: [],
    });
    // 常驻 collector：新会话也在生命周期内持续收集消息（含后续回合），
    // 供状态查询与订阅快照重建完整会话视图。
    const collector = createTranscriptCollector();
    this.historyCollectors.set(response.sessionId, collector);
    const entry: AcpSessionEntry = {
      agentId: runtime.config.id,
      conversationId,
      sessionId: response.sessionId,
      response,
      history: collector.messages,
      createdAt: Date.now(),
      lastUsed: Date.now(),
    };
    this.sessions.set(key, entry);
    return entry;
  }

  private supportsSessionLoad(runtime: AcpRuntime): boolean {
    return runtime.initialized?.agentCapabilities?.loadSession === true;
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

  private async connectionFor(runtime: AcpRuntime): Promise<ClientSideConnection> {
    if (runtime.connection) return runtime.connection;
    if (!runtime.startPromise) runtime.startPromise = this.startRuntime(runtime);
    try {
      return await runtime.startPromise;
    } catch (error) {
      runtime.startPromise = null;
      throw error;
    }
  }

  private async startRuntime(runtime: AcpRuntime): Promise<ClientSideConnection> {
    const cwd = runtime.config.cwd || this.config.cwd || defaultWorkspaceDir();
    const executable = resolveExecutable(runtime.config.command);
    if (!executable) {
      throw GatewayError.invalidRequest(
        `${runtime.config.name} 的 ACP 适配器不可用：${runtime.config.command}`,
      );
    }
    const child = spawn(executable, runtime.config.args, {
      cwd,
      env: cliProcessEnv(executable),
      stdio: ["pipe", "pipe", "pipe"],
    });
    runtime.child = child;
    child.stderr.on("data", (chunk: Buffer) => {
      const line = String(chunk).trim();
      if (line) console.error(`[acp:${runtime.config.id}] ${line}`);
    });

    const stream = ndJsonStream(
      Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
      Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
    );
    const connection = new ClientSideConnection(
      () => ({
        requestPermission: (params) => this.handlePermission(runtime.config.id, params),
        sessionUpdate: (params) => this.handleSessionUpdate(params),
      }),
      stream,
    );

    const initialized = connection.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: { session: { configOptions: { boolean: {} } } },
      clientInfo: { name: "Open Chat", version: "0.1.0" },
    });
    const initializeResponse = await Promise.race([
      initialized,
      new Promise<never>((_resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`${runtime.config.name} ACP 初始化超时`)),
          PROCESS_START_TIMEOUT_MS,
        );
        child.once("exit", (code, signal) => {
          clearTimeout(timer);
          reject(new Error(`${runtime.config.name} ACP 进程已退出（${signal || `code ${code}`}）`));
        });
        child.once("error", (error) => {
          clearTimeout(timer);
          reject(error);
        });
      }),
    ]);

    runtime.initialized = initializeResponse;
    runtime.connection = connection;
    void connection.closed.finally(() => {
      if (runtime.connection === connection) runtime.connection = null;
      if (runtime.child === child) runtime.child = null;
      runtime.startPromise = null;
      runtime.initialized = null;
    });
    return connection;
  }

  private handleSessionUpdate(notification: SessionNotification): void {
    const collector = this.historyCollectors.get(notification.sessionId);
    if (collector) collectAcpHistoryUpdate(collector, notification.update);
    if (notification.update.sessionUpdate === "config_option_update") {
      const session = [...this.sessions.values()].find(
        (entry) => entry.sessionId === notification.sessionId,
      );
      if (session) {
        session.response = {
          ...session.response,
          configOptions: notification.update.configOptions,
        };
      }
    }
    const run = this.activeRuns.get(notification.sessionId);
    const res = run?.response;
    const update = notification.update;
    switch (update.sessionUpdate) {
      case "agent_message_chunk": {
        const text = contentText(update.content);
        if (text) {
          this.emitNative(notification.sessionId, res, { type: "content.delta", content: text });
        }
        break;
      }
      case "agent_thought_chunk": {
        const text = contentText(update.content);
        if (text) {
          this.emitNative(notification.sessionId, res, {
            type: "reasoning.delta",
            content: text,
          });
        }
        break;
      }
      case "tool_call":
      case "tool_call_update":
        this.emitNative(notification.sessionId, res, {
          type: "activity.upsert",
          activity: normalizeAcpActivity(update),
        });
        break;
      case "plan":
      case "plan_update":
        this.emitNative(notification.sessionId, res, {
          type: "plan.updated",
          plan: normalizeAcpPlan(update),
        });
        break;
      case "available_commands_update":
      case "current_mode_update":
      case "config_option_update":
      case "session_info_update":
      case "usage_update":
        this.emitCustom(notification.sessionId, res, "acp_session", update);
        break;
      default:
        break;
    }
  }

  private handlePermission(
    agentId: string,
    params: RequestPermissionRequest,
  ): Promise<RequestPermissionResponse> {
    const run = this.activeRuns.get(params.sessionId);
    if (!run) return Promise.resolve({ outcome: { outcome: "cancelled" } });
    const id = randomUUID();
    const patterns = params.toolCall.locations?.map((location) => location.path) ?? [];
    this.emitCustom(params.sessionId, run.response, "chat_permission", {
      id,
      version: "acp",
      agentId,
      permission: params.toolCall.kind || params.toolCall.name || "tool",
      patterns,
      metadata: {
        title: params.toolCall.title,
        input: params.toolCall.rawInput,
      },
      options: params.options,
      tool: { callID: params.toolCall.toolCallId },
    });

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pendingPermissions.delete(id);
        resolve({ outcome: { outcome: "cancelled" } });
      }, this.config.permissionTimeoutMs);
      this.pendingPermissions.set(id, {
        id,
        agentId,
        sessionId: params.sessionId,
        options: params.options,
        resolve,
        timer,
      });
    });
  }

  private cancelPermissionsForSession(sessionId: string): void {
    for (const [id, pending] of this.pendingPermissions) {
      if (pending.sessionId !== sessionId) continue;
      clearTimeout(pending.timer);
      this.pendingPermissions.delete(id);
      pending.resolve({ outcome: { outcome: "cancelled" } });
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
    const runtime = this.getAvailableRuntime(agentId);
    const connection = await this.connectionFor(runtime);
    void connection.cancel({ sessionId: session.sessionId }).catch(() => {});
    this.cancelPermissionsForSession(session.sessionId);
    return true;
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

function sessionStateView(
  session: AcpSessionEntry,
  loadSupported: boolean,
  running: boolean,
): AcpSessionStateView {
  return {
    agentId: session.agentId,
    conversationId: session.conversationId,
    sessionId: session.sessionId,
    configOptions: session.response.configOptions ?? [],
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

function createAbortError(): Error {
  const error = new Error("ACP 回合已取消");
  error.name = "AbortError";
  return error;
}

function contentText(content: unknown): string {
  if (!content || typeof content !== "object") return "";
  const block = content as { type?: unknown; text?: unknown };
  return block.type === "text" && typeof block.text === "string" ? block.text : "";
}

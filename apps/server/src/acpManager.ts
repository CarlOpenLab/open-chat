import {
  ClientSideConnection,
  PROTOCOL_VERSION,
  ndJsonStream,
  type NewSessionResponse,
  type PermissionOption,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionConfigOption,
  type SessionNotification,
  type SessionUpdate,
} from "@agentclientprotocol/sdk";
import { randomUUID } from "node:crypto";
import type { ServerResponse } from "node:http";
import { Readable, Writable } from "node:stream";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { AcpAgentConfig, AcpConfig } from "./config";
import { cliProcessEnv, resolveExecutable } from "./commandEnv";
import { GatewayError } from "./error";

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
}

interface AcpRuntime {
  config: AcpAgentConfig;
  child: ChildProcessWithoutNullStreams | null;
  connection: ClientSideConnection | null;
  startPromise: Promise<ClientSideConnection> | null;
}

interface AcpSessionEntry {
  agentId: string;
  conversationId: string;
  sessionId: string;
  response: NewSessionResponse;
  createdAt: number;
  lastUsed: number;
}

interface ActiveRun {
  agentId: string;
  conversationId: string;
  response: ServerResponse;
  model: string;
}

interface PendingPermission {
  id: string;
  agentId: string;
  sessionId: string;
  options: PermissionOption[];
  resolve: (response: RequestPermissionResponse) => void;
  timer: ReturnType<typeof setTimeout>;
}

const PROCESS_START_TIMEOUT_MS = 15_000;

export class AcpManager {
  private readonly runtimes = new Map<string, AcpRuntime>();
  private readonly sessions = new Map<string, AcpSessionEntry>();
  private readonly activeRuns = new Map<string, ActiveRun>();
  private readonly pendingPermissions = new Map<string, PendingPermission>();

  constructor(private readonly config: AcpConfig) {
    for (const agent of config.agents) {
      if (agent.transport !== "acp") continue;
      this.runtimes.set(agent.id, {
        config: agent,
        child: null,
        connection: null,
        startPromise: null,
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
  }> {
    return [...this.sessions.values()]
      .filter((entry) => !agentId || entry.agentId === agentId)
      .map(({ response: _response, ...entry }) => entry)
      .sort((left, right) => right.lastUsed - left.lastUsed);
  }

  async getSessionState(agentId: string, conversationId: string): Promise<AcpSessionStateView> {
    const runtime = this.getAvailableRuntime(agentId);
    const session = await this.getOrCreateSession(runtime, conversationId);
    return sessionStateView(session);
  }

  async setSessionConfigOption(
    agentId: string,
    conversationId: string,
    configId: string,
    value: string | boolean,
  ): Promise<AcpSessionStateView> {
    const runtime = this.getAvailableRuntime(agentId);
    const session = await this.getOrCreateSession(runtime, conversationId);
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
    return sessionStateView(session);
  }

  async runTurn(
    agentId: string,
    conversationId: string,
    text: string,
    res: ServerResponse,
    signal: AbortSignal,
  ): Promise<void> {
    const runtime = this.getAvailableRuntime(agentId);

    const session = await this.getOrCreateSession(runtime, conversationId);
    if (this.activeRuns.has(session.sessionId)) {
      throw GatewayError.invalidRequest("该 ACP 会话仍在运行，请先停止当前任务");
    }

    const connection = await this.connectionFor(runtime);
    const run: ActiveRun = {
      agentId,
      conversationId,
      response: res,
      model: `acp/${agentId}`,
    };
    this.activeRuns.set(session.sessionId, run);
    session.lastUsed = Date.now();

    const cancel = () => {
      void connection.cancel({ sessionId: session.sessionId }).catch(() => {});
      this.cancelPermissionsForSession(session.sessionId);
    };
    signal.addEventListener("abort", cancel, { once: true });

    try {
      const response = await connection.prompt({
        sessionId: session.sessionId,
        prompt: [{ type: "text", text }],
      });
      writeCustomEvent(res, "acp_turn", {
        agentId,
        sessionId: session.sessionId,
        stopReason: response.stopReason,
        usage: response.usage,
      });
      writeChunk(res, run.model, {}, "stop");
      res.write("data: [DONE]\n\n");
      res.end();
    } finally {
      signal.removeEventListener("abort", cancel);
      this.activeRuns.delete(session.sessionId);
      this.cancelPermissionsForSession(session.sessionId);
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
    this.activeRuns.clear();
    this.sessions.clear();
    for (const runtime of this.runtimes.values()) {
      runtime.child?.kill("SIGTERM");
      runtime.connection = null;
      runtime.child = null;
      runtime.startPromise = null;
    }
  }

  private async getOrCreateSession(
    runtime: AcpRuntime,
    conversationId: string,
  ): Promise<AcpSessionEntry> {
    const key = `${runtime.config.id}:${conversationId}`;
    const existing = this.sessions.get(key);
    if (existing) {
      existing.lastUsed = Date.now();
      return existing;
    }
    const connection = await this.connectionFor(runtime);
    const response = await connection.newSession({
      cwd: runtime.config.cwd || this.config.cwd || process.cwd(),
      mcpServers: [],
    });
    const entry: AcpSessionEntry = {
      agentId: runtime.config.id,
      conversationId,
      sessionId: response.sessionId,
      response,
      createdAt: Date.now(),
      lastUsed: Date.now(),
    };
    this.sessions.set(key, entry);
    return entry;
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
    const cwd = runtime.config.cwd || this.config.cwd || process.cwd();
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
    await Promise.race([
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

    runtime.connection = connection;
    void connection.closed.finally(() => {
      if (runtime.connection === connection) runtime.connection = null;
      if (runtime.child === child) runtime.child = null;
      runtime.startPromise = null;
    });
    return connection;
  }

  private handleSessionUpdate(notification: SessionNotification): void {
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
    if (!run || run.response.writableEnded) return;
    const update = notification.update;
    switch (update.sessionUpdate) {
      case "agent_message_chunk": {
        const text = contentText(update.content);
        if (text) writeChunk(run.response, run.model, { content: text });
        break;
      }
      case "agent_thought_chunk": {
        const text = contentText(update.content);
        if (text) writeChunk(run.response, run.model, { reasoning_content: text });
        break;
      }
      case "tool_call":
      case "tool_call_update":
        writeCustomEvent(run.response, "tool_call", normalizeToolCall(update));
        break;
      case "plan":
      case "plan_update":
        writeCustomEvent(run.response, "acp_plan", update);
        break;
      case "available_commands_update":
      case "current_mode_update":
      case "config_option_update":
      case "session_info_update":
      case "usage_update":
        writeCustomEvent(run.response, "acp_session", update);
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
    writeCustomEvent(run.response, "chat_permission", {
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
}

function sessionStateView(session: AcpSessionEntry): AcpSessionStateView {
  return {
    agentId: session.agentId,
    conversationId: session.conversationId,
    sessionId: session.sessionId,
    configOptions: session.response.configOptions ?? [],
    modes: session.response.modes ?? null,
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

function contentText(content: unknown): string {
  if (!content || typeof content !== "object") return "";
  const block = content as { type?: unknown; text?: unknown };
  return block.type === "text" && typeof block.text === "string" ? block.text : "";
}

function normalizeToolCall(update: SessionUpdate): Record<string, unknown> {
  if (update.sessionUpdate !== "tool_call" && update.sessionUpdate !== "tool_call_update") {
    return {};
  }
  const rawStatus = update.status;
  const status =
    rawStatus === "completed"
      ? "completed"
      : rawStatus === "failed"
        ? "error"
        : rawStatus === "pending"
          ? "pending"
          : "running";
  return {
    id: update.toolCallId,
    name: update.title || update.name || update.kind || "工具调用",
    status,
    input: update.rawInput,
    output: stringifyToolOutput(update.rawOutput ?? update.content),
    ...(rawStatus === "failed" ? { error: stringifyToolOutput(update.rawOutput) } : {}),
  };
}

function stringifyToolOutput(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "[无法序列化的工具输出]";
  }
}

function writeChunk(
  res: ServerResponse,
  model: string,
  delta: Record<string, unknown>,
  finishReason: string | null = null,
): void {
  const payload = {
    id: `chatcmpl-${Date.now()}`,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function writeCustomEvent(res: ServerResponse, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

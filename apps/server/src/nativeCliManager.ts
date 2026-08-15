import type { SessionConfigOption } from "@agentclientprotocol/sdk";
import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { ServerResponse } from "node:http";
import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { homedir } from "node:os";
import { createInterface } from "node:readline";
import type { AcpAgentConfig, AcpConfig, AgentTransport } from "./config";
import { cliProcessEnv, resolveExecutable } from "./commandEnv";
import { GatewayError } from "./error";
import type { LocalChatManager, LocalModelInfo } from "./localProvider";

type NativeTransport = Exclude<AgentTransport, "acp">;

export interface NativeAgentView {
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

export interface NativeSessionStateView {
  agentId: string;
  conversationId: string;
  sessionId: string;
  configOptions: SessionConfigOption[];
  modes: null;
  history?: NativeSessionHistoryMessage[];
}

interface NativeSessionHistoryMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  reasoningContent?: string;
  toolCalls?: Array<Record<string, unknown>>;
  agentPlan?: Record<string, unknown>;
}

interface NativeProviderSessionView {
  sessionId: string;
  cwd: string;
  title?: string;
  updatedAt?: string;
}

export interface NativeProviderSessionsView {
  supported: boolean;
  sessions: NativeProviderSessionView[];
}

interface NativeModel {
  id: string;
  name: string;
  isDefault?: boolean;
}

interface NativeSession {
  agentId: string;
  conversationId: string;
  sessionId: string;
  model: string;
  models: NativeModel[];
  runtime: NativeRuntime | null;
  createdAt: number;
  lastUsed: number;
  projectPath?: string;
}

interface NativeRuntime {
  runTurn(text: string, res: ServerResponse, signal: AbortSignal): Promise<void>;
  setModel(model: string): Promise<void>;
  cancel(): void;
  close(): void;
  sessionId?(): string;
}

interface PendingPermission {
  agentId: string;
  resolve: (decision: "once" | "always" | "reject") => void;
  timer: ReturnType<typeof setTimeout>;
}

interface ActiveNativeRun {
  res: ServerResponse;
  resolve: () => void;
  reject: (error: Error) => void;
  sawText: boolean;
  sawReasoning: boolean;
}

type PermissionRequester = (
  agentId: string,
  res: ServerResponse,
  request: {
    permission: string;
    patterns?: string[];
    metadata?: Record<string, unknown>;
    options?: Array<{
      optionId: string;
      name: string;
      kind: "allow_once" | "allow_always" | "reject_once" | "reject_always";
    }>;
  },
) => Promise<"once" | "always" | "reject">;

const MODEL_CONFIG_ID = "model";
const RPC_TIMEOUT_MS = 15_000;

export class NativeCliManager {
  private readonly agents = new Map<string, AcpAgentConfig>();
  private readonly sessions = new Map<string, NativeSession>();
  private readonly modelCache = new Map<string, Promise<NativeModel[]>>();
  private readonly pendingPermissions = new Map<string, PendingPermission>();

  constructor(
    private readonly config: AcpConfig,
    private readonly localChat: LocalChatManager | null,
  ) {
    for (const agent of config.agents) {
      if (agent.transport !== "acp") this.agents.set(agent.id, agent);
    }
  }

  hasAgent(agentId: string): boolean {
    return this.agents.has(agentId);
  }

  listAgents(): NativeAgentView[] {
    return [...this.agents.values()].map((agent) => {
      const installed = !!resolveExecutable(agent.command);
      return {
        id: agent.id,
        name: agent.name,
        description: agent.description,
        installed,
        available: this.config.enabled && agent.enabled && installed,
        enabled: this.config.enabled && agent.enabled,
        transport: agent.transport === "opencode" ? "http" : "stdio",
        protocol: nativeProtocol(agent.transport as NativeTransport),
        command: nativeLaunchCommand(agent),
        ...(!installed && agent.adapterHint ? { adapterHint: agent.adapterHint } : {}),
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
      .filter((session) => !agentId || session.agentId === agentId)
      .map(({ runtime: _runtime, models: _models, model: _model, ...session }) => session)
      .sort((left, right) => right.lastUsed - left.lastUsed);
  }

  async getSessionState(
    agentId: string,
    conversationId: string,
    projectPath?: string,
    providerSessionId?: string,
  ): Promise<NativeSessionStateView> {
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
      projectPath || agent.cwd || this.config.cwd || process.cwd(),
      session.sessionId !== conversationId || Boolean(providerSessionId),
    );
    return sessionView(session, history);
  }

  async listProviderSessions(agentId: string): Promise<NativeProviderSessionsView> {
    const agent = this.requireAgent(agentId);
    const executable = resolveExecutable(agent.command);
    if (!executable && agent.transport !== "opencode") return { supported: false, sessions: [] };
    const cwd = agent.cwd || this.config.cwd || process.cwd();
    switch (agent.transport) {
      case "codex":
        return {
          supported: true,
          sessions: await discoverCodexSessions(executable!, cwd, agent.args),
        };
      case "claude":
        return { supported: true, sessions: await discoverClaudeSessions(cwd) };
      case "pi":
      case "omp":
        return { supported: true, sessions: await discoverPiSessions(cwd, agent.transport) };
      case "opencode": {
        if (!this.localChat) return { supported: false, sessions: [] };
        const sessions = await this.localChat.listProviderSessions(cwd);
        return {
          supported: true,
          sessions: sessions.map((session) => ({
            sessionId: session.sessionId,
            cwd: session.cwd || cwd,
            ...(session.title ? { title: session.title } : {}),
            ...(session.updatedAt ? { updatedAt: session.updatedAt } : {}),
          })),
        };
      }
      default:
        return { supported: false, sessions: [] };
    }
  }

  async setSessionConfigOption(
    agentId: string,
    conversationId: string,
    configId: string,
    value: string | boolean,
    projectPath?: string,
    providerSessionId?: string,
  ): Promise<NativeSessionStateView> {
    if (configId !== MODEL_CONFIG_ID || typeof value !== "string") {
      throw GatewayError.invalidRequest("该原生 CLI 目前只支持模型选择配置");
    }
    const session = await this.getOrCreateSession(
      agentId,
      conversationId,
      projectPath,
      providerSessionId,
    );
    if (!session.models.some((model) => model.id === value)) {
      throw GatewayError.invalidRequest(`当前 CLI 不支持模型：${value}`);
    }
    if (session.model !== value) {
      await session.runtime?.setModel(value);
      session.model = value;
    }
    session.lastUsed = Date.now();
    return sessionView(session);
  }

  async runTurn(
    agentId: string,
    conversationId: string,
    text: string,
    projectPath: string | undefined,
    res: ServerResponse,
    signal: AbortSignal,
    providerSessionId?: string,
  ): Promise<void> {
    const session = await this.getOrCreateSession(
      agentId,
      conversationId,
      projectPath,
      providerSessionId,
    );
    const agent = this.requireAgent(agentId);
    session.lastUsed = Date.now();

    if (agent.transport === "opencode") {
      if (!this.localChat) throw GatewayError.invalidRequest("OpenCode 本地服务未启用");
      if (!session.model) throw GatewayError.invalidRequest("OpenCode 没有可用模型");
      const entry = await this.localChat.getOrCreateSession(
        `${agentId}:${conversationId}`,
        session.model,
        projectPath,
        providerSessionId || (session.sessionId !== conversationId ? session.sessionId : undefined),
      );
      session.sessionId = entry.opencodeId;
      writeCustomEvent(res, "provider_session", { agentId, sessionId: session.sessionId });
      await this.localChat.runTurn(entry, text, session.model, "", res, signal);
      return;
    }

    if (!session.runtime) {
      session.runtime = await this.startRuntime(agent, session, providerSessionId);
      const runtimeSessionId = session.runtime.sessionId?.();
      if (runtimeSessionId) {
        session.sessionId = runtimeSessionId;
        writeCustomEvent(res, "provider_session", {
          agentId,
          sessionId: runtimeSessionId,
        });
      }
    }
    try {
      await session.runtime.runTurn(text, res, signal);
      writeChunk(res, `${agent.transport}/${session.model || agent.id}`, {}, "stop");
      res.write("data: [DONE]\n\n");
      res.end();
    } catch (error) {
      session.runtime.close();
      session.runtime = null;
      throw error;
    }
  }

  async replyPermission(
    permissionId: string,
    response: "once" | "always" | "reject",
  ): Promise<void> {
    const pending = this.pendingPermissions.get(permissionId);
    if (!pending) throw GatewayError.invalidRequest("权限请求不存在、已处理或已超时");
    clearTimeout(pending.timer);
    this.pendingPermissions.delete(permissionId);
    pending.resolve(response);
  }

  stop(): void {
    for (const pending of this.pendingPermissions.values()) {
      clearTimeout(pending.timer);
      pending.resolve("reject");
    }
    this.pendingPermissions.clear();
    for (const session of this.sessions.values()) session.runtime?.close();
    this.sessions.clear();
  }

  private requireAgent(agentId: string): AcpAgentConfig {
    if (!this.config.enabled) throw GatewayError.invalidRequest("本地 CLI 服务未启用");
    const agent = this.agents.get(agentId);
    if (!agent || !agent.enabled) {
      throw GatewayError.invalidRequest(`未知或未启用的本地 CLI：${agentId}`);
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
  ): Promise<NativeSession> {
    const agent = this.requireAgent(agentId);
    const key = `${agentId}:${conversationId}:${projectPath || ""}`;
    const existing = this.sessions.get(key);
    if (existing) {
      existing.lastUsed = Date.now();
      return existing;
    }
    const models = await this.discoverModels(agent);
    const preferred = models.find((model) => model.isDefault) ?? models[0];
    const session: NativeSession = {
      agentId,
      conversationId,
      sessionId: providerSessionId?.trim() || conversationId,
      model: preferred?.id ?? "",
      models,
      runtime: null,
      createdAt: Date.now(),
      lastUsed: Date.now(),
      projectPath,
    };
    this.sessions.set(key, session);
    return session;
  }

  private discoverModels(agent: AcpAgentConfig): Promise<NativeModel[]> {
    let pending = this.modelCache.get(agent.id);
    if (!pending) {
      pending = discoverNativeModels(agent, this.localChat).catch((error) => {
        this.modelCache.delete(agent.id);
        console.error(`[${agent.id}] model discovery failed:`, error);
        return fallbackNativeModels(agent.transport as NativeTransport);
      });
      this.modelCache.set(agent.id, pending);
    }
    return pending;
  }

  private async startRuntime(
    agent: AcpAgentConfig,
    session: NativeSession,
    providerSessionId?: string,
  ): Promise<NativeRuntime> {
    const executable = resolveExecutable(agent.command);
    if (!executable) throw GatewayError.invalidRequest(`${agent.name} CLI 不可用`);
    const cwd = session.projectPath || agent.cwd || this.config.cwd || process.cwd();
    const requestPermission: PermissionRequester = (agentId, res, request) =>
      this.requestPermission(agentId, res, request);
    switch (agent.transport) {
      case "codex":
        return CodexRuntime.start(
          agent,
          executable,
          cwd,
          session.model,
          requestPermission,
          providerSessionId,
        );
      case "claude":
        return ClaudeRuntime.start(
          agent,
          executable,
          cwd,
          session.model,
          requestPermission,
          providerSessionId,
        );
      case "pi":
      case "omp":
        return PiRuntime.start(agent, executable, cwd, session.model, providerSessionId);
      default:
        throw GatewayError.invalidRequest(`不支持的原生 CLI 传输：${agent.transport}`);
    }
  }

  private requestPermission(
    agentId: string,
    res: ServerResponse,
    request: Parameters<PermissionRequester>[2],
  ): Promise<"once" | "always" | "reject"> {
    const id = randomUUID();
    writeCustomEvent(res, "chat_permission", {
      id,
      version: "acp",
      agentId,
      permission: request.permission,
      patterns: request.patterns ?? [],
      metadata: request.metadata ?? {},
      options: request.options ?? [
        { optionId: "once", name: "允许一次", kind: "allow_once" },
        { optionId: "always", name: "本会话允许", kind: "allow_always" },
        { optionId: "reject", name: "拒绝", kind: "reject_once" },
      ],
    });
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pendingPermissions.delete(id);
        resolve("reject");
      }, this.config.permissionTimeoutMs);
      this.pendingPermissions.set(id, { agentId, resolve, timer });
    });
  }

  private async readProviderHistory(
    agent: AcpAgentConfig,
    sessionId: string,
    cwd: string,
    enabled: boolean,
  ): Promise<NativeSessionHistoryMessage[]> {
    if (!enabled) return [];
    try {
      switch (agent.transport) {
        case "codex":
          return readCodexSessionHistory(agent, sessionId, cwd);
        case "claude":
          return readClaudeSessionHistory(sessionId);
        case "pi":
        case "omp":
          return readPiSessionHistory(sessionId, cwd, agent.transport);
        case "opencode": {
          const loaded = await this.localChat?.loadProviderSession(sessionId, cwd);
          return loaded?.history ?? [];
        }
        default:
          return [];
      }
    } catch (error) {
      console.error(`[${agent.id}] session history read failed:`, error);
      return [];
    }
  }
}

class JsonRpcProcess {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<
    string,
    {
      resolve: (value: Record<string, unknown>) => void;
      reject: (error: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();
  private nextId = 1;

  constructor(
    executable: string,
    args: string[],
    cwd: string,
    private readonly onMessage: (value: Record<string, unknown>) => void,
    private readonly onExit: (error: Error) => void,
  ) {
    this.child = spawn(executable, args, {
      cwd,
      env: cliProcessEnv(executable),
      stdio: ["pipe", "pipe", "pipe"],
    });
    const lines = createInterface({ input: this.child.stdout });
    lines.on("line", (line) => this.handleLine(line));
    this.child.stderr.on("data", (chunk: Buffer) => {
      const text = String(chunk).trim();
      if (text) console.error(`[native-cli] ${text}`);
    });
    this.child.once("error", (error) => this.fail(error));
    this.child.once("exit", (code, signal) => {
      this.fail(new Error(`CLI 进程已退出（${signal || `code ${code}`}）`));
    });
  }

  request(method: string, params: Record<string, unknown>, timeoutMs = RPC_TIMEOUT_MS) {
    const id = String(this.nextId++);
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} 请求超时`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.write({ id: Number(id), method, params });
    });
  }

  notify(method: string, params: Record<string, unknown>) {
    this.write({ method, params });
  }

  respond(id: unknown, result: Record<string, unknown>) {
    this.write({ id, result });
  }

  close() {
    this.child.stdin.end();
  }

  private write(value: unknown) {
    this.child.stdin.write(`${JSON.stringify(value)}\n`);
  }

  private handleLine(line: string) {
    let value: Record<string, unknown>;
    try {
      value = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return;
    }
    if (!value.method && value.id !== undefined) {
      const id = rpcId(value.id);
      if (!id) return;
      const pending = this.pending.get(id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(id);
        const error = asRecord(value.error);
        if (error) pending.reject(new Error(stringValue(error.message) || "CLI RPC 请求失败"));
        else pending.resolve(value);
        return;
      }
    }
    this.onMessage(value);
  }

  private fail(error: Error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    this.onExit(error);
  }
}

class CodexRuntime implements NativeRuntime {
  private active: ActiveNativeRun | null = null;
  private threadId = "";
  private turnId = "";
  private model: string;
  private readonly toolCalls = new Map<string, { name: string; input?: unknown }>();

  private constructor(
    private readonly agent: AcpAgentConfig,
    private readonly rpc: JsonRpcProcess,
    model: string,
    private readonly requestPermission: PermissionRequester,
  ) {
    this.model = model;
  }

  static async start(
    agent: AcpAgentConfig,
    executable: string,
    cwd: string,
    model: string,
    requestPermission: PermissionRequester,
    providerSessionId?: string,
  ): Promise<CodexRuntime> {
    let runtime: CodexRuntime;
    const rpc = new JsonRpcProcess(
      executable,
      ["app-server", "--stdio", ...agent.args],
      cwd,
      (value) => runtime.handleMessage(value),
      (error) => runtime.failActive(error),
    );
    runtime = new CodexRuntime(agent, rpc, model, requestPermission);
    await rpc.request("initialize", {
      clientInfo: { name: "open-chat", title: "Open Chat", version: "0.1.0" },
      capabilities: { experimentalApi: true },
    });
    rpc.notify("initialized", {});
    const params: Record<string, unknown> = {
      cwd,
      // Codex is used here as a local coding agent. Match the native
      // agent behavior: commands run without an approval round-trip and have
      // full host access, so a command cannot remain stuck waiting on UI input.
      approvalPolicy: "never",
      sandbox: "danger-full-access",
      approvalsReviewer: "user",
      serviceName: "open-chat",
      ...(model ? { model } : {}),
    };
    const opened = await rpc.request(
      providerSessionId?.trim() ? "thread/resume" : "thread/start",
      providerSessionId?.trim()
        ? { threadId: providerSessionId.trim(), ...(model ? { model } : {}) }
        : params,
    );
    runtime.threadId = stringAt(opened, "result", "thread", "id");
    if (!runtime.threadId) throw new Error("Codex 未返回 thread id");
    return runtime;
  }

  sessionId(): string {
    return this.threadId;
  }

  async runTurn(text: string, res: ServerResponse, signal: AbortSignal): Promise<void> {
    if (this.active) throw GatewayError.invalidRequest("该 Codex 会话仍在运行");
    this.toolCalls.clear();
    const done = new Promise<void>((resolve, reject) => {
      this.active = { res, resolve, reject, sawText: false, sawReasoning: false };
    });
    const cancel = () => this.cancel();
    signal.addEventListener("abort", cancel, { once: true });
    const params: Record<string, unknown> = {
      threadId: this.threadId,
      input: [{ type: "text", text }],
      approvalPolicy: "never",
      approvalsReviewer: "user",
      sandboxPolicy: { type: "dangerFullAccess" },
      summary: "auto",
      ...(this.model ? { model: this.model } : {}),
    };
    void this.rpc.request("turn/start", params).catch((error) => this.failActive(error));
    try {
      await done;
    } finally {
      signal.removeEventListener("abort", cancel);
    }
  }

  async setModel(model: string): Promise<void> {
    this.model = model;
  }

  cancel(): void {
    if (!this.threadId || !this.turnId) return;
    void this.rpc
      .request("turn/interrupt", { threadId: this.threadId, turnId: this.turnId })
      .catch(() => {});
  }

  close(): void {
    this.rpc.close();
  }

  private handleMessage(value: Record<string, unknown>) {
    const method = stringValue(value.method);
    const params = asRecord(value.params) ?? {};
    if (value.id !== undefined && method.includes("requestApproval")) {
      const active = this.active;
      if (!active) {
        this.rpc.respond(value.id, { decision: "decline" });
        return;
      }
      const title =
        stringValue(params.reason) ||
        stringAt(params, "command") ||
        stringAt(params, "item", "command") ||
        "Codex 请求执行操作";
      void this.requestPermission(this.agent.id, active.res, {
        permission: method.split("/").at(-1) || "tool",
        metadata: { ...params, title },
      }).then((decision) => {
        this.rpc.respond(value.id, {
          decision:
            decision === "always" ? "acceptForSession" : decision === "once" ? "accept" : "decline",
        });
      });
      return;
    }
    if (!this.active) return;
    if (method === "turn/started") {
      this.turnId = stringAt(params, "turn", "id");
      return;
    }
    if (method === "item/agentMessage/delta") {
      const delta = stringValue(params.delta);
      if (delta) {
        this.active.sawText = true;
        writeChunk(this.active.res, `codex/${this.model || "default"}`, { content: delta });
      }
      return;
    }
    if (method === "item/reasoning/summaryTextDelta" || method === "item/reasoning/textDelta") {
      const delta = stringValue(params.delta);
      if (delta) {
        this.active.sawReasoning = true;
        writeChunk(this.active.res, `codex/${this.model || "default"}`, {
          reasoning_content: delta,
        });
      }
      return;
    }
    if (method === "item/started" || method === "item/completed") {
      const item = asRecord(params.item);
      if (
        item &&
        stringValue(item.type) !== "agentMessage" &&
        stringValue(item.type) !== "reasoning" &&
        stringValue(item.type) !== "userMessage"
      ) {
        const complete = method === "item/completed";
        const tool = nativeToolEvent(item, complete);
        if (complete) {
          this.toolCalls.delete(tool.id);
        } else {
          this.toolCalls.set(tool.id, { name: tool.name, input: tool.input });
        }
        writeCustomEvent(this.active.res, "tool_call", tool);
      }
      return;
    }
    if (method === "error") {
      const message = stringValue(params.message);
      if (message) writeCustomEvent(this.active.res, "chat_error", { message });
      return;
    }
    if (method === "turn/completed") {
      const status = stringAt(params, "turn", "status") || "completed";
      const error = stringAt(params, "turn", "error", "message");
      const active = this.active;
      this.finishToolCalls(active, status !== "completed", error || `Codex 回合结束：${status}`);
      this.turnId = "";
      this.active = null;
      if (status === "completed" || status === "interrupted") active.resolve();
      else active.reject(new Error(error || `Codex 回合结束：${status}`));
    }
  }

  private finishToolCalls(active: ActiveNativeRun | null, failed: boolean, error: string): void {
    if (active && !active.res.writableEnded) {
      for (const [id, tool] of this.toolCalls) {
        writeCustomEvent(active.res, "tool_call", {
          id,
          name: tool.name,
          status: failed ? "error" : "completed",
          input: tool.input,
          ...(failed ? { error } : {}),
        });
      }
    }
    this.toolCalls.clear();
  }

  private failActive(error: Error) {
    const active = this.active;
    this.finishToolCalls(active, true, error.message);
    this.active = null;
    active?.reject(error);
  }
}

class ClaudeRuntime implements NativeRuntime {
  private readonly child: ChildProcessWithoutNullStreams;
  private active: ActiveNativeRun | null = null;
  private requestId = 0;
  private model: string;
  private readonly providerSessionId: string;
  private readonly tools = new Map<string, { name: string; input: unknown }>();

  private constructor(
    private readonly agent: AcpAgentConfig,
    executable: string,
    cwd: string,
    model: string,
    private readonly requestPermission: PermissionRequester,
    providerSessionId?: string,
  ) {
    this.model = model;
    this.providerSessionId = providerSessionId?.trim() || randomUUID();
    const args = [
      "-p",
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--thinking-display",
      "summarized",
      "--replay-user-messages",
      "--permission-prompt-tool",
      "stdio",
      "--permission-mode",
      "manual",
      ...(providerSessionId?.trim()
        ? ["--resume", providerSessionId.trim()]
        : ["--session-id", this.providerSessionId]),
      ...(model ? ["--model", model] : []),
      ...agent.args,
    ];
    this.child = spawn(executable, args, {
      cwd,
      env: cliProcessEnv(executable),
      stdio: ["pipe", "pipe", "pipe"],
    });
    createInterface({ input: this.child.stdout }).on("line", (line) => this.handleLine(line));
    this.child.stderr.on("data", (chunk: Buffer) => {
      const text = String(chunk).trim();
      if (text) console.error(`[claude] ${text}`);
    });
    this.child.once("error", (error) => this.failActive(error));
    this.child.once("exit", (code, signal) =>
      this.failActive(new Error(`Claude 进程已退出（${signal || `code ${code}`}）`)),
    );
  }

  static async start(
    agent: AcpAgentConfig,
    executable: string,
    cwd: string,
    model: string,
    requestPermission: PermissionRequester,
    providerSessionId?: string,
  ) {
    return new ClaudeRuntime(agent, executable, cwd, model, requestPermission, providerSessionId);
  }

  sessionId(): string {
    return this.providerSessionId;
  }

  async runTurn(text: string, res: ServerResponse, signal: AbortSignal): Promise<void> {
    if (this.active) throw GatewayError.invalidRequest("该 Claude 会话仍在运行");
    const done = new Promise<void>((resolve, reject) => {
      this.active = { res, resolve, reject, sawText: false, sawReasoning: false };
    });
    const cancel = () => this.cancel();
    signal.addEventListener("abort", cancel, { once: true });
    this.write({
      type: "user",
      message: { role: "user", content: [{ type: "text", text }] },
      parent_tool_use_id: null,
    });
    try {
      await done;
    } finally {
      signal.removeEventListener("abort", cancel);
    }
  }

  async setModel(model: string): Promise<void> {
    if (model === this.model) return;
    this.model = model;
    this.writeControl({ subtype: "set_model", model });
  }

  cancel(): void {
    if (this.active) this.writeControl({ subtype: "interrupt" });
  }

  close(): void {
    this.child.stdin.end();
  }

  private writeControl(request: Record<string, unknown>) {
    this.write({
      type: "control_request",
      request_id: `open-chat-${++this.requestId}`,
      request,
    });
  }

  private write(value: unknown) {
    this.child.stdin.write(`${JSON.stringify(value)}\n`);
  }

  private handleLine(line: string) {
    let value: Record<string, unknown>;
    try {
      value = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return;
    }
    const type = stringValue(value.type);
    if (type === "control_request" && stringAt(value, "request", "subtype") === "can_use_tool") {
      this.handlePermission(value);
      return;
    }
    const active = this.active;
    if (!active) return;
    if (type === "stream_event") {
      const event = asRecord(value.event);
      if (stringValue(event?.type) === "message_start") {
        active.sawText = false;
        active.sawReasoning = false;
      }
      const delta = asRecord(event?.delta);
      if (stringValue(delta?.type) === "text_delta") {
        const text = stringValue(delta?.text);
        if (text) {
          active.sawText = true;
          writeChunk(active.res, `claude/${this.model || "default"}`, { content: text });
        }
      }
      if (stringValue(delta?.type) === "thinking_delta") {
        const text = stringValue(delta?.thinking);
        if (text) {
          active.sawReasoning = true;
          writeChunk(active.res, `claude/${this.model || "default"}`, {
            reasoning_content: text,
          });
        }
      }
      return;
    }
    if (type === "assistant") {
      const content = arrayAt(value, "message", "content");
      for (const blockValue of content) {
        const block = asRecord(blockValue);
        if (!block) continue;
        const blockType = stringValue(block.type);
        if (blockType === "text" && !active.sawText) {
          const text = stringValue(block.text);
          if (text) writeChunk(active.res, `claude/${this.model || "default"}`, { content: text });
        } else if (blockType === "thinking" && !active.sawReasoning) {
          const text = stringValue(block.thinking);
          if (text) {
            writeChunk(active.res, `claude/${this.model || "default"}`, {
              reasoning_content: text,
            });
          }
        } else if (blockType === "tool_use") {
          const id = stringValue(block.id) || randomUUID();
          const name = stringValue(block.name) || "工具调用";
          this.tools.set(id, { name, input: block.input });
          writeCustomEvent(active.res, "tool_call", {
            id,
            name,
            status: "running",
            input: block.input,
          });
        }
      }
      return;
    }
    if (type === "user") {
      for (const blockValue of arrayAt(value, "message", "content")) {
        const block = asRecord(blockValue);
        if (!block || stringValue(block.type) !== "tool_result") continue;
        const id = stringValue(block.tool_use_id);
        const tool = this.tools.get(id);
        writeCustomEvent(active.res, "tool_call", {
          id,
          name: tool?.name || "工具调用",
          status: block.is_error === true ? "error" : "completed",
          input: tool?.input,
          output: stringifyValue(block.content),
          ...(block.is_error === true ? { error: stringifyValue(block.content) } : {}),
        });
        this.tools.delete(id);
      }
      return;
    }
    if (type === "result") {
      const isError = value.is_error === true;
      if (isError) {
        writeCustomEvent(active.res, "chat_error", {
          message: stringValue(value.result) || "Claude 回合失败",
        });
      }
      this.active = null;
      active.resolve();
    }
  }

  private handlePermission(value: Record<string, unknown>) {
    const requestId = stringValue(value.request_id);
    const request = asRecord(value.request) ?? {};
    if (!requestId) return;
    const active = this.active;
    if (!active) {
      this.respondPermission(requestId, "reject");
      return;
    }
    const tool = stringValue(request.display_name) || stringValue(request.tool_name) || "工具";
    void this.requestPermission(this.agent.id, active.res, {
      permission: tool,
      patterns: [stringValue(request.blocked_path)].filter(Boolean),
      metadata: {
        description: request.description,
        input: request.input,
      },
      options: [
        { optionId: "once", name: "允许一次", kind: "allow_once" },
        { optionId: "reject", name: "拒绝", kind: "reject_once" },
      ],
    }).then((decision) => this.respondPermission(requestId, decision));
  }

  private respondPermission(requestId: string, decision: "once" | "always" | "reject") {
    this.write({
      type: "control_response",
      response: {
        subtype: "success",
        request_id: requestId,
        response:
          decision === "reject"
            ? { behavior: "deny", message: "The user denied this tool call." }
            : { behavior: "allow" },
      },
    });
  }

  private failActive(error: Error) {
    const active = this.active;
    this.active = null;
    active?.reject(error);
  }
}

class PiRpcProcess {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<
    string,
    {
      resolve: (value: Record<string, unknown>) => void;
      reject: (error: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();
  private nextId = 0;

  constructor(
    executable: string,
    args: string[],
    cwd: string,
    private readonly onEvent: (value: Record<string, unknown>) => void,
    private readonly onExit: (error: Error) => void,
  ) {
    this.child = spawn(executable, args, {
      cwd,
      env: { ...cliProcessEnv(executable), PI_SKIP_VERSION_CHECK: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    createInterface({ input: this.child.stdout }).on("line", (line) => this.handleLine(line));
    this.child.stderr.on("data", (chunk: Buffer) => {
      const text = String(chunk).trim();
      if (text) console.error(`[pi] ${text}`);
    });
    this.child.once("error", (error) => this.fail(error));
    this.child.once("exit", (code, signal) =>
      this.fail(new Error(`Pi 进程已退出（${signal || `code ${code}`}）`)),
    );
  }

  request(payload: Record<string, unknown>, timeoutMs = RPC_TIMEOUT_MS) {
    const id = `open-chat-${++this.nextId}`;
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${String(payload.type)} 请求超时`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.write({ id, ...payload });
    });
  }

  close() {
    this.child.stdin.end();
  }

  private write(value: unknown) {
    this.child.stdin.write(`${JSON.stringify(value)}\n`);
  }

  private handleLine(line: string) {
    let value: Record<string, unknown>;
    try {
      value = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return;
    }
    if (value.type === "response" && typeof value.id === "string") {
      const pending = this.pending.get(value.id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(value.id);
        if (value.success === false) {
          pending.reject(new Error(stringValue(value.error) || "Pi RPC 请求失败"));
        } else {
          pending.resolve(value);
        }
        return;
      }
    }
    this.onEvent(value);
  }

  private fail(error: Error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    this.onExit(error);
  }
}

class PiRuntime implements NativeRuntime {
  private active: ActiveNativeRun | null = null;
  private model: string;
  private providerSessionId = "";
  private readonly agentId: string;
  private readonly rpc: PiRpcProcess;
  private readonly tools = new Map<string, { name: string; input: unknown }>();

  private constructor(
    agent: AcpAgentConfig,
    executable: string,
    cwd: string,
    model: string,
    sessionPath?: string,
  ) {
    this.agentId = agent.id;
    this.model = model;
    this.rpc = new PiRpcProcess(
      executable,
      [
        "--mode",
        "rpc",
        // pi 用 --approve（信任项目本地文件）；omp 没有该参数，用 --auto-approve
        // 自动批准工具调用（RPC 模式无权限事件，前端对 pi 系固定为 full 权限）。
        ...(agent.transport === "omp" ? ["--auto-approve"] : ["--approve"]),
        ...(sessionPath ? ["--session", sessionPath] : []),
        ...agent.args,
      ],
      cwd,
      (value) => this.handleEvent(value),
      (error) => this.failActive(error),
    );
  }

  static async start(
    agent: AcpAgentConfig,
    executable: string,
    cwd: string,
    model: string,
    providerSessionId?: string,
  ) {
    const sessionPath = providerSessionId?.trim()
      ? await findPiSessionPath(providerSessionId.trim(), cwd, agent.transport as NativeTransport)
      : undefined;
    const runtime = new PiRuntime(agent, executable, cwd, model, sessionPath ?? undefined);
    const state = await runtime.rpc.request({ type: "get_state" });
    const sessionFile =
      stringAt(state, "data", "sessionFile") || stringAt(state, "data", "session_file");
    runtime.providerSessionId =
      stringAt(state, "data", "sessionId") ||
      stringAt(state, "data", "session_id") ||
      (sessionFile ? basename(sessionFile, ".jsonl") : "") ||
      (sessionPath ? providerSessionId?.trim() : "") ||
      "";
    if (model) await runtime.applyModel(model);
    return runtime;
  }

  sessionId(): string {
    return this.providerSessionId;
  }

  async runTurn(text: string, res: ServerResponse, signal: AbortSignal): Promise<void> {
    if (this.active) throw GatewayError.invalidRequest("该 Pi 会话仍在运行");
    const done = new Promise<void>((resolve, reject) => {
      this.active = { res, resolve, reject, sawText: false, sawReasoning: false };
    });
    const cancel = () => this.cancel();
    signal.addEventListener("abort", cancel, { once: true });
    void this.rpc
      .request({ type: "prompt", message: text })
      .catch((error) => this.failActive(error));
    try {
      await done;
    } finally {
      signal.removeEventListener("abort", cancel);
    }
  }

  async setModel(model: string): Promise<void> {
    if (model === this.model) return;
    await this.applyModel(model);
    this.model = model;
  }

  cancel(): void {
    if (this.active) void this.rpc.request({ type: "abort" }).catch(() => {});
  }

  close(): void {
    this.rpc.close();
  }

  private async applyModel(model: string) {
    const [provider, modelId] = splitModel(model);
    await this.rpc.request({ type: "set_model", provider, modelId });
  }

  private handleEvent(value: Record<string, unknown>) {
    const active = this.active;
    if (!active) return;
    const type = stringValue(value.type);
    if (type === "message_start" && stringAt(value, "message", "role") === "assistant") {
      active.sawText = false;
      active.sawReasoning = false;
      return;
    }
    if (type === "message_update") {
      const update = asRecord(value.assistantMessageEvent);
      const updateType = stringValue(update?.type);
      const delta = stringValue(update?.delta);
      if (updateType === "text_delta" && delta) {
        active.sawText = true;
        writeChunk(active.res, `${this.agentId}/${this.model || "default"}`, { content: delta });
      } else if (updateType === "thinking_delta" && delta) {
        active.sawReasoning = true;
        writeChunk(active.res, `${this.agentId}/${this.model || "default"}`, {
          reasoning_content: delta,
        });
      }
      return;
    }
    if (type === "message_end" && stringAt(value, "message", "role") === "assistant") {
      for (const blockValue of arrayAt(value, "message", "content")) {
        const block = asRecord(blockValue);
        if (!block) continue;
        if (block.type === "text" && !active.sawText) {
          const text = stringValue(block.text);
          if (text) {
            writeChunk(active.res, `${this.agentId}/${this.model || "default"}`, { content: text });
          }
        }
        if (block.type === "thinking" && !active.sawReasoning) {
          const text = stringValue(block.thinking);
          if (text) {
            writeChunk(active.res, `${this.agentId}/${this.model || "default"}`, {
              reasoning_content: text,
            });
          }
        }
      }
      return;
    }
    if (type.startsWith("tool_execution_")) {
      const id = stringValue(value.toolCallId) || randomUUID();
      const name = stringValue(value.toolName) || this.tools.get(id)?.name || "工具调用";
      if (type === "tool_execution_start") this.tools.set(id, { name, input: value.args });
      const complete = type === "tool_execution_end";
      const tool = this.tools.get(id);
      writeCustomEvent(active.res, "tool_call", {
        id,
        name,
        status: complete ? (value.isError === true ? "error" : "completed") : "running",
        input: tool?.input ?? value.args,
        output: stringifyValue(value.result ?? value.partialResult),
        ...(value.isError === true ? { error: stringifyValue(value.result) } : {}),
      });
      if (complete) this.tools.delete(id);
      return;
    }
    // 回合结束：pi 发 agent_settled（在 turn_end 之后），omp 只发 turn_end。
    // 两者都以 turn_end 为完成标志，agent_settled 仅作兼容兜底。
    if (type === "turn_end" || type === "agent_settled") {
      this.active = null;
      active.resolve();
    }
  }

  private failActive(error: Error) {
    const active = this.active;
    this.active = null;
    active?.reject(error);
  }
}

async function discoverNativeModels(
  agent: AcpAgentConfig,
  localChat: LocalChatManager | null,
): Promise<NativeModel[]> {
  const executable = resolveExecutable(agent.command);
  if (!executable) return [];
  const cwd = agent.cwd || process.cwd();
  switch (agent.transport) {
    case "codex":
      return discoverCodexModels(executable, cwd, agent.args);
    case "claude":
      return fallbackNativeModels("claude");
    case "pi":
    case "omp":
      return discoverPiModels(executable, cwd, agent.args, agent.transport);
    case "opencode":
      return localChat ? (await localChat.listModels()).map(localModelView) : [];
    default:
      return [];
  }
}

async function discoverCodexModels(
  executable: string,
  cwd: string,
  extraArgs: string[],
): Promise<NativeModel[]> {
  let exited: Error | null = null;
  const rpc = new JsonRpcProcess(
    executable,
    ["app-server", "--stdio", ...extraArgs],
    cwd,
    () => {},
    (error) => {
      exited = error;
    },
  );
  try {
    await rpc.request("initialize", {
      clientInfo: { name: "open-chat", title: "Open Chat", version: "0.1.0" },
      capabilities: { experimentalApi: true },
    });
    rpc.notify("initialized", {});
    const models: NativeModel[] = [];
    let cursor = "";
    for (let page = 0; page < 32; page += 1) {
      if (exited) throw exited;
      const response = await rpc.request("model/list", cursor ? { cursor } : {});
      const result = asRecord(response.result) ?? {};
      for (const itemValue of Array.isArray(result.data) ? result.data : []) {
        const item = asRecord(itemValue);
        const id = stringValue(item?.model);
        if (!id) continue;
        models.push({
          id,
          name: stringValue(item?.displayName) || displayNameFromSlug(id),
          isDefault: item?.isDefault === true,
        });
      }
      cursor = stringValue(result.nextCursor);
      if (!cursor) break;
    }
    return dedupeModels(models);
  } finally {
    rpc.close();
  }
}

async function discoverCodexSessions(
  executable: string,
  cwd: string,
  extraArgs: string[],
): Promise<NativeProviderSessionView[]> {
  let exited: Error | null = null;
  const rpc = new JsonRpcProcess(
    executable,
    ["app-server", "--stdio", ...extraArgs],
    cwd,
    () => {},
    (error) => {
      exited = error;
    },
  );
  try {
    await rpc.request("initialize", {
      clientInfo: { name: "open-chat", title: "Open Chat", version: "0.1.0" },
      capabilities: { experimentalApi: true },
    });
    rpc.notify("initialized", {});
    const sessions: NativeProviderSessionView[] = [];
    let cursor = "";
    for (let page = 0; page < 100; page += 1) {
      if (exited) throw exited;
      const response = await rpc.request("thread/list", {
        ...(cursor ? { cursor } : {}),
        limit: 100,
        sortKey: "recency_at",
        sortDirection: "desc",
        sourceKinds: ["appServer", "cli", "vscode"],
      });
      const result = asRecord(response.result) ?? {};
      for (const threadValue of Array.isArray(result.data) ? result.data : []) {
        const thread = asRecord(threadValue);
        const id = stringValue(thread?.id);
        if (!id) continue;
        const updatedAt = numericValue(thread?.updatedAt);
        sessions.push({
          sessionId: id,
          cwd: stringValue(thread?.cwd) || cwd,
          ...(stringValue(thread?.name) || stringValue(thread?.preview)
            ? { title: stringValue(thread?.name) || stringValue(thread?.preview) }
            : {}),
          ...(updatedAt !== undefined
            ? { updatedAt: new Date(normalizeEpochMillis(updatedAt)).toISOString() }
            : {}),
        });
      }
      cursor = stringValue(result.nextCursor);
      if (!cursor) break;
    }
    return sessions;
  } finally {
    rpc.close();
  }
}

async function discoverClaudeSessions(cwd: string): Promise<NativeProviderSessionView[]> {
  const root = join(homedir(), ".claude", "projects");
  const projectDirs = await readdir(root, { withFileTypes: true }).catch(() => []);
  const sessions: NativeProviderSessionView[] = [];
  for (const project of projectDirs) {
    if (!project.isDirectory()) continue;
    const projectPath = join(root, project.name);
    const files = await readdir(projectPath, { withFileTypes: true }).catch(() => []);
    for (const file of files) {
      if (!file.isFile() || !file.name.endsWith(".jsonl")) continue;
      const sessionId = basename(file.name, ".jsonl");
      const fullPath = join(projectPath, file.name);
      const lines = await readJsonLines(fullPath, 200);
      const title = firstConversationText(lines, "user");
      const fileStat = await stat(fullPath).catch(() => undefined);
      sessions.push({
        sessionId,
        cwd: project.name === encodeProjectPath(cwd) ? cwd : decodeClaudeProjectPath(project.name),
        ...(title ? { title: title.slice(0, 120) } : {}),
        ...(fileStat ? { updatedAt: fileStat.mtime.toISOString() } : {}),
      });
    }
  }
  return sessions.sort((left, right) =>
    (right.updatedAt ?? "").localeCompare(left.updatedAt ?? ""),
  );
}

/** pi / omp 的会话存储根目录：pi 在 ~/.pi/agent/sessions，omp 在 ~/.omp/agent/sessions。 */
function piSessionRoot(transport: NativeTransport): string {
  return join(homedir(), transport === "omp" ? ".omp" : ".pi", "agent", "sessions");
}

async function discoverPiSessions(
  cwd: string,
  transport: NativeTransport,
): Promise<NativeProviderSessionView[]> {
  const root = piSessionRoot(transport);
  const dirs = await readdir(root, { withFileTypes: true }).catch(() => []);
  const sessions: NativeProviderSessionView[] = [];
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    const files = await readdir(join(root, dir.name), { withFileTypes: true }).catch(() => []);
    for (const file of files) {
      if (!file.isFile() || !file.name.endsWith(".jsonl")) continue;
      const fullPath = join(root, dir.name, file.name);
      const lines = await readJsonLines(fullPath, 200);
      const header = lines.find((line) => line.type === "session");
      const sessionId = stringValue(header?.id) || basename(file.name, ".jsonl");
      // pi / omp 的历史标题：session_info.name（pi 旧格式）与 title.title（omp 格式），
      // 取最后一条非空值，回退到首条用户消息。
      const title =
        lines
          .filter((line) => line.type === "session_info" || line.type === "title")
          .map((line) => stringValue(line.name) || stringValue(line.title))
          .filter(Boolean)
          .at(-1) || firstMessageText(lines, "user");
      const fileStat = await stat(fullPath).catch(() => undefined);
      sessions.push({
        sessionId,
        cwd: stringValue(header?.cwd) || cwd,
        ...(title ? { title: title.slice(0, 120) } : {}),
        ...(fileStat ? { updatedAt: fileStat.mtime.toISOString() } : {}),
      });
    }
  }
  return sessions.sort((left, right) =>
    (right.updatedAt ?? "").localeCompare(left.updatedAt ?? ""),
  );
}

async function findPiSessionPath(
  sessionId: string,
  cwd: string,
  transport: NativeTransport,
): Promise<string | null> {
  const root = piSessionRoot(transport);
  const preferred = join(root, encodePiProjectPath(cwd, transport));
  const dirs = await readdir(root, { withFileTypes: true }).catch(() => []);
  const ordered = [
    ...(dirs.find((dir) => dir.isDirectory() && dir.name === basename(preferred))
      ? [basename(preferred)]
      : []),
    ...dirs
      .filter((dir) => dir.isDirectory() && dir.name !== basename(preferred))
      .map((dir) => dir.name),
  ];
  for (const dir of ordered) {
    const files = await readdir(join(root, dir), { withFileTypes: true }).catch(() => []);
    for (const file of files) {
      if (!file.isFile() || !file.name.endsWith(".jsonl")) continue;
      const fullPath = join(root, dir, file.name);
      const first = (await readJsonLines(fullPath, 10)).find((line) => line.type === "session");
      if (stringValue(first?.id) === sessionId || basename(file.name, ".jsonl") === sessionId) {
        return fullPath;
      }
    }
  }
  return null;
}

async function readClaudeSessionHistory(sessionId: string): Promise<NativeSessionHistoryMessage[]> {
  const root = join(homedir(), ".claude", "projects");
  const dirs = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    const file = join(root, dir.name, `${sessionId}.jsonl`);
    const lines = await readJsonLines(file);
    if (lines.length > 0) return convertClaudeHistory(lines);
  }
  return [];
}

async function readPiSessionHistory(
  sessionId: string,
  cwd: string,
  transport: NativeTransport,
): Promise<NativeSessionHistoryMessage[]> {
  const file = await findPiSessionPath(sessionId, cwd, transport);
  if (!file) return [];
  return convertPiHistory(await readJsonLines(file));
}

async function readJsonLines(
  file: string,
  limit = Number.POSITIVE_INFINITY,
): Promise<Array<Record<string, unknown>>> {
  const values: Array<Record<string, unknown>> = [];
  const input = createReadStream(file, { encoding: "utf8" });
  const lines = createInterface({ input, crlfDelay: Number.POSITIVE_INFINITY });
  try {
    for await (const line of lines) {
      try {
        const value = asRecord(JSON.parse(line) as unknown);
        if (value) values.push(value);
      } catch {
        // Ignore an isolated malformed JSONL record and keep the usable history.
      }
      if (values.length >= limit) break;
    }
  } catch {
    return [];
  } finally {
    lines.close();
    input.destroy();
  }
  return values;
}

function convertClaudeHistory(
  lines: Array<Record<string, unknown>>,
): NativeSessionHistoryMessage[] {
  const history: NativeSessionHistoryMessage[] = [];
  for (const line of lines) {
    const message = asRecord(line.message);
    const role = stringValue(message?.role);
    if (role !== "user" && role !== "assistant") continue;
    const content = message?.content;
    const text = contentText(content) || (typeof content === "string" ? content : "");
    const blocks = Array.isArray(content) ? content : [];
    const reasoning = blocks
      .map((block) => asRecord(block))
      .filter((block) => stringValue(block?.type) === "thinking")
      .map((block) => stringValue(block?.thinking))
      .filter(Boolean)
      .join("\n");
    const toolCalls = blocks
      .filter((blockValue) => stringValue(asRecord(blockValue)?.type) === "tool_use")
      .map((blockValue) => asRecord(blockValue)!)
      .map((block) => ({
        id: stringValue(block.id) || randomUUID(),
        name: block.name,
        input: block.input,
      }));
    if (!text && !reasoning && !toolCalls.length) continue;
    history.push({
      id: stringValue(line.uuid) || randomUUID(),
      role,
      content: text,
      ...(reasoning ? { reasoningContent: reasoning } : {}),
      ...(toolCalls.length ? { toolCalls } : {}),
    });
  }
  return history;
}

function convertPiHistory(lines: Array<Record<string, unknown>>): NativeSessionHistoryMessage[] {
  const history: NativeSessionHistoryMessage[] = [];
  for (const line of lines) {
    const message = asRecord(line.message);
    const role = stringValue(message?.role);
    if (role !== "user" && role !== "assistant") continue;
    const content = message?.content;
    const text = contentText(content);
    const blocks = Array.isArray(content) ? content : [];
    const reasoning = blocks
      .map((block) => asRecord(block))
      .filter((block) => stringValue(block?.type) === "thinking")
      .map((block) => stringValue(block?.thinking))
      .filter(Boolean)
      .join("\n");
    if (!text && !reasoning) continue;
    history.push({
      id: stringValue(line.id) || randomUUID(),
      role,
      content: text,
      ...(reasoning ? { reasoningContent: reasoning } : {}),
    });
  }
  return history;
}

function firstConversationText(lines: Array<Record<string, unknown>>, role: string): string {
  for (const line of lines) {
    const message = asRecord(line.message);
    if (stringValue(message?.role) !== role) continue;
    const text = contentText(message?.content) || stringValue(message?.content);
    if (text) return text;
  }
  return "";
}

function firstMessageText(lines: Array<Record<string, unknown>>, role: string): string {
  return firstConversationText(lines, role);
}

function encodeProjectPath(value: string): string {
  return value.replaceAll("/", "-");
}

function encodePiProjectPath(value: string, transport: NativeTransport): string {
  if (transport === "omp") {
    // omp 的会话目录名：`-` + 相对 $HOME 的路径（`/` 转 `-`），例如
    // /Users/me/Desktop/proj → -Desktop-proj。不在 $HOME 下时回退到全路径编码。
    const home = homedir();
    const relative = value.startsWith(`${home}/`) ? value.slice(home.length + 1) : value;
    return `-${relative.replace(/^\/+/, "").replaceAll("/", "-")}`;
  }
  return `--${value.replace(/^\/+/, "").replaceAll("/", "-")}--`;
}

function decodeClaudeProjectPath(value: string): string {
  return value.startsWith("-") ? value.replaceAll("-", "/") : value;
}

async function readCodexSessionHistory(
  agent: AcpAgentConfig,
  threadId: string,
  cwd: string,
): Promise<NativeSessionHistoryMessage[]> {
  const executable = resolveExecutable(agent.command);
  if (!executable || !threadId) return [];
  let exited: Error | null = null;
  const rpc = new JsonRpcProcess(
    executable,
    ["app-server", "--stdio", ...agent.args],
    cwd,
    () => {},
    (error) => {
      exited = error;
    },
  );
  try {
    await rpc.request("initialize", {
      clientInfo: { name: "open-chat", title: "Open Chat", version: "0.1.0" },
      capabilities: { experimentalApi: true },
    });
    rpc.notify("initialized", {});
    const response = await rpc.request("thread/read", { threadId, includeTurns: true });
    if (exited) throw exited;
    const thread = asRecord(response.result)?.thread;
    const turns = Array.isArray(asRecord(thread)?.turns)
      ? (asRecord(thread)?.turns as unknown[])
      : [];
    const history: NativeSessionHistoryMessage[] = [];
    for (const turnValue of turns) {
      const turn = asRecord(turnValue);
      const items = Array.isArray(turn?.items) ? turn.items : [];
      let assistant: NativeSessionHistoryMessage | undefined;
      for (const itemValue of items) {
        const item = asRecord(itemValue);
        if (!item) continue;
        const type = stringValue(item.type);
        const id = stringValue(item.id) || randomUUID();
        if (type === "userMessage") {
          const content = contentText(item.content);
          if (content) history.push({ id, role: "user", content });
          continue;
        }
        if (type === "agentMessage") {
          const content = stringValue(item.text);
          assistant = { id, role: "assistant", content };
          history.push(assistant);
          continue;
        }
        if (type === "reasoning") {
          const reasoning = contentText(item.summary) || contentText(item.content);
          if (!reasoning) continue;
          assistant = assistant || { id: `${id}:assistant`, role: "assistant", content: "" };
          if (!history.includes(assistant)) history.push(assistant);
          assistant.reasoningContent = [assistant.reasoningContent, reasoning]
            .filter(Boolean)
            .join("\n");
          continue;
        }
        if (type === "plan") {
          assistant = assistant || { id: `${id}:assistant`, role: "assistant", content: "" };
          if (!history.includes(assistant)) history.push(assistant);
          assistant.agentPlan = { text: stringValue(item.text) || contentText(item.content) };
          continue;
        }
        if (
          assistant &&
          ["commandExecution", "fileChange", "mcpToolCall", "dynamicToolCall"].includes(type)
        ) {
          assistant.toolCalls = [
            ...(assistant.toolCalls ?? []),
            { id, name: stringValue(item.name) || type, ...item },
          ];
        }
      }
    }
    return history;
  } catch (error) {
    console.error(`[${agent.id}] session history read failed:`, error);
    return [];
  } finally {
    rpc.close();
  }
}

async function discoverPiModels(
  executable: string,
  cwd: string,
  extraArgs: string[],
  transport: NativeTransport,
): Promise<NativeModel[]> {
  let exited: Error | null = null;
  const rpc = new PiRpcProcess(
    executable,
    [
      "--mode",
      "rpc",
      "--no-session",
      "--no-skills",
      // pi 专有参数；omp 不识别，会直接报错退出。
      ...(transport === "pi" ? ["--no-prompt-templates", "--no-context-files"] : []),
      ...extraArgs,
    ],
    cwd,
    () => {},
    (error) => {
      exited = error;
    },
  );
  try {
    const [modelsResponse, stateResponse] = await Promise.all([
      rpc.request({ type: "get_available_models" }),
      rpc.request({ type: "get_state" }),
    ]);
    if (exited) throw exited;
    const defaultProvider = stringAt(stateResponse, "data", "model", "provider");
    const defaultModel = stringAt(stateResponse, "data", "model", "id");
    return dedupeModels(
      arrayAt(modelsResponse, "data", "models").flatMap((modelValue) => {
        const model = asRecord(modelValue);
        const provider = stringValue(model?.provider);
        const id = stringValue(model?.id);
        if (!provider || !id) return [];
        return [
          {
            id: `${provider}/${id}`,
            name: stringValue(model?.name) || displayNameFromSlug(id),
            isDefault: provider === defaultProvider && id === defaultModel,
          },
        ];
      }),
    );
  } finally {
    rpc.close();
  }
}

function fallbackNativeModels(transport: NativeTransport): NativeModel[] {
  if (transport === "claude") {
    return [
      { id: "sonnet", name: "Claude Sonnet", isDefault: true },
      { id: "opus", name: "Claude Opus" },
      { id: "haiku", name: "Claude Haiku" },
      { id: "fable", name: "Claude Fable" },
    ];
  }
  return [];
}

function sessionView(
  session: NativeSession,
  history: NativeSessionHistoryMessage[] = [],
): NativeSessionStateView {
  const configOptions: SessionConfigOption[] = session.models.length
    ? [
        {
          id: MODEL_CONFIG_ID,
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
    ...(history.length > 0 ? { history } : {}),
  };
}

function nativeProtocol(transport: NativeTransport): string {
  switch (transport) {
    case "codex":
      return "Codex app-server";
    case "claude":
      return "Claude stream-json";
    case "pi":
      return "Pi RPC";
    case "omp":
      return "Oh My Pi RPC";
    case "opencode":
      return "OpenCode HTTP + SSE";
  }
}

function nativeLaunchCommand(agent: AcpAgentConfig): string {
  switch (agent.transport) {
    case "codex":
      return `${agent.command} app-server --stdio`;
    case "claude":
      return `${agent.command} -p --input-format stream-json --output-format stream-json`;
    case "pi":
      return `${agent.command} --mode rpc --approve`;
    case "omp":
      return `${agent.command} --mode rpc --auto-approve`;
    case "opencode":
      return `${agent.command} serve`;
    default:
      return [agent.command, ...agent.args].join(" ");
  }
}

function localModelView(model: LocalModelInfo): NativeModel {
  return { id: model.id, name: model.name };
}

function nativeToolEvent(item: Record<string, unknown>, complete: boolean) {
  const id =
    stringValue(item.id) ||
    stringValue(item.callId) ||
    stringValue(item.toolCallId) ||
    randomUUID();
  const name =
    stringValue(item.name) || stringValue(item.title) || stringValue(item.type) || "工具调用";
  const rawStatus = stringValue(item.status);
  const failed = rawStatus === "failed" || rawStatus === "declined";
  return {
    id,
    name,
    status: complete ? (failed ? "error" : "completed") : "running",
    input: item.arguments ?? item.command ?? item.input,
    output: stringifyValue(item.aggregatedOutput ?? item.output ?? item.result),
    durationMs: typeof item.durationMs === "number" ? item.durationMs : undefined,
    ...(failed ? { error: stringifyValue(item.error ?? item.output) } : {}),
  };
}

function splitModel(model: string): [string, string] {
  const index = model.indexOf("/");
  if (index <= 0 || index === model.length - 1) {
    throw GatewayError.invalidRequest(`Pi 系（pi/omp）模型必须是 provider/model：${model}`);
  }
  return [model.slice(0, index), model.slice(index + 1)];
}

function dedupeModels(models: NativeModel[]): NativeModel[] {
  const seen = new Set<string>();
  return models.filter((model) => model.id && !seen.has(model.id) && seen.add(model.id));
}

function displayNameFromSlug(value: string): string {
  return value
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numericValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeEpochMillis(value: number): number {
  return value < 10_000_000_000 ? value * 1000 : value;
}

function rpcId(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function valueAt(value: unknown, ...path: string[]): unknown {
  let current: unknown = value;
  for (const key of path) current = asRecord(current)?.[key];
  return current;
}

function stringAt(value: unknown, ...path: string[]): string {
  return stringValue(valueAt(value, ...path));
}

function arrayAt(value: unknown, ...path: string[]): unknown[] {
  const result = valueAt(value, ...path);
  return Array.isArray(result) ? result : [];
}

function stringifyValue(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "[无法序列化的输出]";
  }
}

function contentText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value
    .map((part) => {
      if (typeof part === "string") return part;
      const record = asRecord(part);
      return stringValue(record?.text) || stringValue(record?.thinking);
    })
    .filter(Boolean)
    .join("\n");
}

function writeChunk(
  res: ServerResponse,
  model: string,
  delta: Record<string, unknown>,
  finishReason: string | null = null,
) {
  const payload = {
    id: `chatcmpl-${Date.now()}`,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function writeCustomEvent(res: ServerResponse, event: string, data: unknown) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

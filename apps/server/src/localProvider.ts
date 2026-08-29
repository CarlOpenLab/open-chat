/**
 * 本地 opencode provider。
 *
 * 服务端驱动本地 `opencode serve`（HTTP + SSE），AI 取本地的：
 * - 模型与供应商：`GET /api/model` 返回 `providerID/modelID`（本地发现，
 *   模型 id 形如 `opencode/nemotron-3.5-lightning-free`），无需客户端配置
 *   baseUrl / apiKey。
 * - 会话：`POST /api/session` 创建；前端会话（conversationId）与 opencode
 *   session 一一对应（长会话复用，历史自然积累）。
 * - 聊天：`POST /session/{id}/prompt_async`（model 与 system prompt 随每个
 *   prompt 下发），回复流经 `GET /event`（server-wide SSE，
 *   按 sessionID 过滤）。
 * - 事件转换：`message.part.delta`（field=text / reasoning）转 native_event；
 *   `session.idle` → native turn.completed。
 *
 * 每次请求只发最后一条用户消息（历史在 opencode session 里），无需重放。
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createServer as createNetServer } from "node:net";
import type { ServerResponse } from "node:http";
import { GatewayError } from "./error";
import type { LocalConfig } from "./config";
import { cliSpawnOptions, resolveExecutable } from "./commandEnv";
import { convertOpenCodeHistory } from "./transcript/adapters/opencode";
import { writeTranscriptCustomEvent } from "./transcript/stream";
import { writeNativeEvent } from "./nativeEvents";
import type { TranscriptMessage } from "./transcript/types";

export interface LocalModelInfo {
  /** 形如 `provider/model`，与 `opencode models` 输出一致。 */
  id: string;
  /** 展示名。 */
  name: string;
  /** 供应商 id（如 `opencode`）。 */
  provider: string;
  /** 供应商展示名。 */
  providerName: string;
  contextLength?: number;
}

interface OpenCodeModel {
  providerID?: string;
  id?: string;
  name?: string;
  limit?: { context?: number };
}

/** `/config/providers` 返回的服务商配置（含该服务商全部模型，不受可用性过滤）。 */
interface OpenCodeConfigProvider {
  id?: string;
  name?: string;
  models?: Record<string, OpenCodeModel>;
}

interface OpenCodeConfigProviders {
  providers?: OpenCodeConfigProvider[];
}

interface OpenCodeSessionEntry {
  opencodeId: string;
  key: string;
  /** 当前模型（`provider/model`）。模型随每个 prompt 下发，无需重建会话。 */
  model: string;
  createdAt: number;
  lastUsed: number;
  projectPath?: string;
  server: OpenCodeServer;
}

type OpenCodePermissionVersion = "v1" | "v2";

interface PendingOpenCodePermission {
  entry: OpenCodeSessionEntry;
  version: OpenCodePermissionVersion;
}

interface LocalProviderSession {
  sessionId: string;
  cwd: string;
  title?: string;
  updatedAt?: string;
  history?: TranscriptMessage[];
}

const DEFAULT_SERVER_START_TIMEOUT_MS = 15_000;
const HEALTH_POLL_INTERVAL_MS = 100;
/** 会话事件停滞兜底：超过该时长没有任何会话相关事件时，向客户端报错而不是干等。
 * 权限询问期间（等待用户批准工具执行）不算停滞，见 runTurn。 */
const SESSION_EVENT_STALL_MS = 50_000;

/** 权限询问等待兜底：用户长时间不回应权限弹窗时主动报错，避免无限挂起。 */
const PERMISSION_WAIT_TIMEOUT_MS = 5 * 60 * 1000;

/** 打开一个空闲本地端口（serve 用）。 */
function reservePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address === "object") {
        const port = address.port;
        server.close(() => resolve(port));
      } else {
        server.close();
        reject(new Error("failed to reserve a local port"));
      }
    });
  });
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** 模型 slug → 展示名。 */
export function displayNameFromSlug(slug: string): string {
  const words = slug
    .split(/[-_]/)
    .filter((part) => part.length > 0)
    .map((part) => {
      const lower = part.toLowerCase();
      if (lower === "gpt") return "GPT";
      if (lower === "ai") return "AI";
      if (lower === "xai") return "xAI";
      if (/^[\d.]+$/.test(lower)) return part;
      return part.charAt(0).toUpperCase() + part.slice(1);
    });
  return words.join(" ");
}

/** 管理单个 `opencode serve` 进程与 HTTP 请求。 */
class OpenCodeServer {
  private port: number | null = null;
  private child: ChildProcess | null = null;
  private startPromise: Promise<number> | null = null;

  constructor(
    private readonly binary: string,
    private readonly cwd: string,
  ) {}

  async portNumber(): Promise<number> {
    if (this.port !== null) return this.port;
    if (!this.startPromise) this.startPromise = this.start();
    return this.startPromise;
  }

  private async start(): Promise<number> {
    const port = await reservePort();
    const spawnOptions = cliSpawnOptions(this.binary);
    const child = spawn(this.binary, ["serve", "--hostname", "127.0.0.1", "--port", String(port)], {
      cwd: this.cwd || process.cwd(),
      env: {
        ...spawnOptions.env,
        OPENCODE_SERVER_PASSWORD: "",
        OPENCODE_SERVER_USERNAME: "opencode",
      },
      shell: spawnOptions.shell,
      stdio: ["ignore", "ignore", "pipe"],
    });
    this.child = child;
    child.stderr?.on("data", (chunk: Buffer) => {
      const line = String(chunk).trim();
      if (line) console.error(`[opencode serve] ${line}`);
    });
    child.on("exit", (code) => {
      if (code && code !== 0) {
        console.error(`[opencode serve] process exited with code ${code}`);
      }
      this.child = null;
      this.port = null;
      this.startPromise = null;
    });
    child.on("error", (err) => {
      console.error(`[opencode serve] failed to start: ${err.message}`);
      this.child = null;
      this.startPromise = null;
    });

    // 轮询健康检查，等待服务就绪。
    const deadline = Date.now() + DEFAULT_SERVER_START_TIMEOUT_MS;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/global/health`, {
          signal: AbortSignal.timeout(1_000),
        });
        if (res.ok) {
          this.port = port;
          return port;
        }
      } catch {
        // 未就绪，继续轮询
      }
      await sleep(HEALTH_POLL_INTERVAL_MS);
    }
    child.kill("SIGTERM");
    throw new Error(`opencode serve 启动超时（${DEFAULT_SERVER_START_TIMEOUT_MS}ms）`);
  }

  /** JSON 请求。204 等空响应返回 undefined。 */
  async request<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    const port = await this.portNumber();
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`opencode ${method} ${path} 失败：HTTP ${res.status} ${text.slice(0, 300)}`);
    }
    const text = await res.text();
    if (!text.trim()) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      return undefined as T;
    }
  }

  async openEventStream(signal: AbortSignal): Promise<ReadableStream<Uint8Array> | null> {
    const port = await this.portNumber();
    const res = await fetch(`http://127.0.0.1:${port}/event`, {
      headers: { Accept: "text/event-stream" },
      signal,
    });
    if (!res.ok || !res.body) return null;
    return res.body;
  }

  async loadSession(id: string): Promise<LocalProviderSession | null> {
    const response = await this.request<unknown>("GET", `/session/${encodeURIComponent(id)}`).catch(
      () => undefined,
    );
    const item =
      response && typeof response === "object" ? (response as Record<string, unknown>) : {};
    const messagesResponse = await this.request<unknown>(
      "GET",
      `/session/${encodeURIComponent(id)}/message`,
    ).catch(() => []);
    const messages = Array.isArray(messagesResponse)
      ? messagesResponse
      : Array.isArray((messagesResponse as { data?: unknown[] } | undefined)?.data)
        ? ((messagesResponse as { data: unknown[] }).data ?? [])
        : [];
    if (!response && messages.length === 0) return null;
    return {
      sessionId: id,
      cwd: typeof item.directory === "string" ? item.directory : this.cwd,
      title:
        (typeof item.title === "string" && item.title) ||
        (typeof item.name === "string" && item.name) ||
        undefined,
      history: convertOpenCodeHistory(messages),
    };
  }

  stop(): void {
    if (this.child) {
      this.child.kill("SIGTERM");
      this.child = null;
      this.port = null;
      this.startPromise = null;
    }
  }
}

export class LocalChatManager {
  private readonly server: OpenCodeServer;
  private readonly sessions = new Map<string, OpenCodeSessionEntry>();
  private readonly latestSessions = new Map<string, OpenCodeSessionEntry>();
  /** Permission ids are globally unique in OpenCode. Keep their owning entry
   * so a reply still works when the UI has switched conversations meanwhile. */
  private readonly pendingPermissions = new Map<string, PendingOpenCodePermission>();
  private modelsCache: { models: LocalModelInfo[]; at: number } | null = null;
  private idleTimer: NodeJS.Timeout | null = null;

  private readonly servers = new Map<string, OpenCodeServer>();

  constructor(private readonly config: LocalConfig) {
    const binary = config.binary || "opencode";
    this.server = new OpenCodeServer(
      resolveExecutable(binary) ?? binary,
      config.cwd || process.cwd(),
    );
    this.servers.set(config.cwd || process.cwd(), this.server);
  }

  private serverFor(projectPath?: string): OpenCodeServer {
    const cwd = projectPath || this.config.cwd || process.cwd();
    const existing = this.servers.get(cwd);
    if (existing) return existing;
    const binary = this.config.binary || "opencode";
    const server = new OpenCodeServer(resolveExecutable(binary) ?? binary, cwd);
    this.servers.set(cwd, server);
    return server;
  }

  /** 是否已配置并启用本地 opencode。 */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * 从本地 opencode 发现模型与供应商（缓存 60 秒）。
   *
   * `/api/model` 只返回「可用」模型（付费的 opencode-go 因鉴权走 legacy
   * auth.json、未被计入 serve 的可用性判断，会被过滤掉），所以再合入
   * `/config/providers` 的全部已配置服务商模型，二者按完整 id 去重：
   * - `/api/model`：可用模型全集（免费 opencode/* 都在这里）；
   * - `/config/providers`：已配置服务商（含 opencode-go/* 付费模型），
   *   其模型的鉴权在请求时由 opencode 自身从 auth.json 解析，实际可用。
   */
  async listModels(): Promise<LocalModelInfo[]> {
    if (this.modelsCache && Date.now() - this.modelsCache.at < 60_000) {
      return this.modelsCache.models;
    }
    const [modelResp, configResp] = await Promise.all([
      this.server.request<{ data?: OpenCodeModel[] }>("GET", "/api/model"),
      this.server
        .request<OpenCodeConfigProviders>("GET", "/config/providers")
        .catch(() => undefined),
    ]);
    const models: LocalModelInfo[] = [];
    const seen = new Set<string>();
    const addModel = (
      provider: string,
      id: string,
      name: string,
      providerName: string,
      contextLength?: number,
    ) => {
      const fullId = `${provider}/${id}`;
      if (seen.has(fullId)) return;
      seen.add(fullId);
      models.push({ id: fullId, name, provider, providerName, contextLength });
    };

    for (const item of modelResp?.data ?? []) {
      const provider = item.providerID?.trim();
      const id = item.id?.trim();
      if (!provider || !id) continue;
      addModel(
        provider,
        id,
        item.name?.trim() || (id.includes(" ") ? id : displayNameFromSlug(id)),
        displayNameFromSlug(provider),
        item.limit?.context,
      );
    }

    for (const provider of configResp?.providers ?? []) {
      const providerId = provider.id?.trim();
      if (!providerId) continue;
      const providerName = provider.name?.trim() || displayNameFromSlug(providerId);
      for (const [modelId, model] of Object.entries(provider.models ?? {})) {
        const id = modelId.trim();
        if (!id) continue;
        addModel(
          providerId,
          id,
          model.name?.trim() || (id.includes(" ") ? id : displayNameFromSlug(id)),
          providerName,
          model.limit?.context,
        );
      }
    }

    this.modelsCache = { models, at: Date.now() };
    return models;
  }

  async loadProviderSession(
    sessionId: string,
    projectPath?: string,
  ): Promise<LocalProviderSession | null> {
    const servers = projectPath ? [this.serverFor(projectPath)] : [...this.servers.values()];
    for (const server of servers) {
      const session = await server.loadSession(sessionId).catch(() => null);
      if (session) return session;
    }
    return null;
  }

  /** 判断模型是否属于本地 opencode（形如 `opencode/...`）。 */
  async isLocalModel(model: string): Promise<boolean> {
    if (!this.config.enabled || typeof model !== "string") return false;
    const provider = model.split("/")[0];
    const models = await this.listModels().catch(() => []);
    return models.some((item) => item.provider === provider);
  }

  /** 取前端会话对应的 opencode session；不存在则创建。 */
  async getOrCreateSession(
    key: string,
    model: string,
    projectPath?: string,
    providerSessionId?: string,
  ): Promise<OpenCodeSessionEntry> {
    const sessionKey = `${key}:${projectPath || ""}`;
    const existing = this.sessions.get(sessionKey);
    if (existing) {
      existing.lastUsed = Date.now();
      existing.model = model;
      return existing;
    }
    const server = this.serverFor(projectPath);
    let opencodeId = providerSessionId?.trim();
    if (!opencodeId) {
      const response = await server.request<{ data?: { id?: string } }>("POST", "/api/session", {});
      opencodeId = response?.data?.id;
    }
    if (!opencodeId) {
      throw GatewayError.upstream("opencode 未返回会话 ID");
    }
    const entry: OpenCodeSessionEntry = {
      opencodeId,
      key,
      model,
      projectPath,
      server,
      createdAt: Date.now(),
      lastUsed: Date.now(),
    };
    this.sessions.set(sessionKey, entry);
    this.latestSessions.set(key, entry);
    this.evictIfNeeded();
    return entry;
  }

  /**
   * 发 prompt 并把 opencode 事件流转成 native CLI 事件流。
   * system prompt 随每个 prompt 下发（同一会话不变，opencode 会正确应用）；
   * 客户端断开时通过 abort 中断本地回合。
   */
  async runTurn(
    entry: OpenCodeSessionEntry,
    text: string,
    model: string,
    systemPrompt: string,
    res: ServerResponse,
    signal: AbortSignal,
  ): Promise<void> {
    const [providerID, modelID] = splitModel(model);
    const body: Record<string, unknown> = {
      parts: [{ type: "text", text }],
      model: { providerID, modelID },
    };
    if (systemPrompt.trim()) body.system = systemPrompt.trim();
    const cancel = () => {
      void entry.server.request("POST", `/session/${entry.opencodeId}/abort`, {}).catch(() => {});
    };
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) cancel();

    // Subscribe before triggering the prompt. OpenCode emits the first session
    // events immediately for fast/local models; connecting afterwards can miss
    // the entire turn (leaving the browser's SSE request in a permanent state).
    let stream: ReadableStream<Uint8Array> | null;
    try {
      stream = await entry.server.openEventStream(signal);
    } catch (error) {
      signal.removeEventListener("abort", cancel);
      throw error;
    }
    if (!stream) {
      signal.removeEventListener("abort", cancel);
      throw new Error("opencode 事件流不可用");
    }

    try {
      await entry.server.request("POST", `/session/${entry.opencodeId}/prompt_async`, body);
    } catch (error) {
      signal.removeEventListener("abort", cancel);
      await stream.cancel().catch(() => {});
      throw error;
    }

    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let reasoningBuffer = "";
    let reasoningSent = false;
    let contentStarted = false;
    let turnDone = false;
    let turnFailed = false;
    let lastSessionEventAt = Date.now();
    let sentFinal = false;
    let retryNotice = "";
    // 权限询问跟踪：opencode 在等待前端批准工具执行时暂停本回合，期间不算停滞。
    let permissionPendingAt: number | null = null;
    // 已转发给前端的权限请求（requestID → 事件类型，决定回复走 v1/v2 端点）。
    const forwardedPermissions = new Map<string, "permission.asked" | "permission.v2.asked">();
    // 工具调用跟踪：partID -> 已流式拼装的信息（delta 事件只有 name/output 字段）。
    const toolParts = new Map<string, { name: string; output: string }>();

    const readWithTimeout = async (): Promise<Awaited<ReturnType<typeof reader.read>>> => {
      const waitStartedAt = permissionPendingAt ?? lastSessionEventAt;
      const maxWait =
        permissionPendingAt !== null ? PERMISSION_WAIT_TIMEOUT_MS : SESSION_EVENT_STALL_MS;
      const remaining = Math.max(1, maxWait - (Date.now() - waitStartedAt));
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          reader.read(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () =>
                reject(
                  new Error(
                    permissionPendingAt !== null
                      ? "权限请求等待超时，回合已结束，请重试"
                      : "opencode 事件流读取超时，未收到模型响应",
                  ),
                ),
              remaining,
            );
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    };

    /** 把已累积的 reasoning 以 reasoning_content 帧发出去（工具调用前先落盘思考内容）。 */
    const flushReasoning = (): void => {
      if (reasoningBuffer && !reasoningSent) {
        writeNativeDelta(res, model, { reasoning_content: reasoningBuffer });
        reasoningSent = true;
      }
    };

    /** 把 opencode 工具 part 转成有序 native activity 事件，供前端活动列表渲染。 */
    const emitToolPart = (part: Record<string, unknown> | undefined): void => {
      if (!part || part.type !== "tool") return;
      flushReasoning();
      const id =
        (typeof part.id === "string" && part.id ? part.id : "") ||
        (typeof part.callID === "string" ? part.callID : "");
      // 兼容 v1（part.tool）/ v2（part.name）两种 part 格式。
      const name =
        (typeof part.name === "string" && part.name ? part.name : "") ||
        (typeof part.tool === "string" ? part.tool : "");
      const state = (part.state ?? {}) as Record<string, unknown>;
      const status = typeof state.status === "string" ? state.status : "running";
      const input = (state.input ?? part.input) as unknown;
      // 输出：v2 用 state.content 文本数组，v1 用 state.output 字符串。
      let output = "";
      if (Array.isArray(state.content)) {
        output = state.content
          .filter(
            (item): item is { type?: unknown; text?: unknown } =>
              typeof item === "object" && item !== null,
          )
          .filter((item) => item.type === "text" && typeof item.text === "string")
          .map((item) => item.text as string)
          .join("\n");
      } else if (typeof state.output === "string") {
        output = state.output;
      } else if (typeof part.output === "string") {
        output = part.output;
      }
      let error: string | undefined;
      if (status === "error") {
        const err = state.error as { message?: unknown } | string | undefined;
        error =
          typeof err === "string"
            ? err
            : typeof err?.message === "string"
              ? err.message
              : "工具执行失败";
      }
      const time = (part.time ?? {}) as Record<string, unknown>;
      let durationMs: number | undefined;
      if (typeof time.created === "number" && typeof time.completed === "number") {
        durationMs = time.completed - time.created;
      }
      toolParts.set(id, { name, output });
      writeNativeEvent(res, {
        type: "activity.upsert",
        activity: {
          id,
          name,
          status:
            status === "pending"
              ? "pending"
              : status === "error"
                ? "error"
                : status === "completed"
                  ? "completed"
                  : "running",
          input,
          output: output || undefined,
          error,
          durationMs,
        },
      });
    };

    const finalize = (): void => {
      if (sentFinal) return;
      sentFinal = true;
      if (reasoningBuffer && !reasoningSent) {
        writeNativeDelta(res, model, { reasoning_content: reasoningBuffer });
      }
      if (!turnFailed) writeNativeDelta(res, model, {}, "stop");
      res.write("data: [DONE]\n\n");
      res.end();
    };

    try {
      while (!turnDone) {
        // 会话事件停滞兜底：正常回合由 session.idle 结束；若一段时间内连
        // 工具/状态/错误事件都没有（比如上游卡死在重试循环、连接假死），
        // 直接向客户端报明确错误，避免前端干等 60s 后由 streamTimeout 兜底。
        // 权限询问期间不算停滞：opencode 在等前端批准，事件流本来就安静。
        if (
          permissionPendingAt === null &&
          Date.now() - lastSessionEventAt > SESSION_EVENT_STALL_MS
        ) {
          turnFailed = true;
          writeNativeEvent(res, {
            type: "turn.failed",
            message: retryNotice
              ? `模型请求重试失败：${retryNotice}`
              : "opencode 回合超时，未收到模型响应，请重试",
          });
          break;
        }
        // 权限询问等待超时兜底：前端长时间不回应时主动结束回合。
        if (
          permissionPendingAt !== null &&
          Date.now() - permissionPendingAt > PERMISSION_WAIT_TIMEOUT_MS
        ) {
          turnFailed = true;
          writeNativeEvent(res, {
            type: "turn.failed",
            message: "权限请求等待超时，回合已结束，请重试",
          });
          break;
        }
        // A stalled fetch read does not yield control back to the loop, so the
        // old elapsed-time check could never fire. Race each read with the
        // inactivity deadline and terminate the turn deterministically.
        const { done, value } = await readWithTimeout();
        if (done) {
          if (contentStarted) break;
          throw new Error("opencode 事件流意外关闭");
        }
        if (value) {
          buffer += decoder.decode(value, { stream: true });
        }
        let newlineIndex: number;
        while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newlineIndex).trim();
          buffer = buffer.slice(newlineIndex + 1);
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload) continue;
          let event: { type?: string; properties?: Record<string, unknown> };
          try {
            event = JSON.parse(payload) as { type?: string; properties?: Record<string, unknown> };
          } catch {
            continue;
          }
          const type = event.type ?? "";
          const props = event.properties ?? {};
          // 服务端全局事件流：过滤其它会话的流量。
          if (props.sessionID && props.sessionID !== entry.opencodeId) continue;

          // heartbeat / file.watcher 等噪声不算会话进展，停滞检测只关心会话事件。
          const isSessionActivity =
            type === "message.part.delta" ||
            type === "message.part.update" ||
            type === "message.part.updated" ||
            type === "message.updated" ||
            type === "session.status" ||
            type === "session.error" ||
            type === "session.idle" ||
            type === "session.updated" ||
            type === "session.diff" ||
            type === "permission.asked" ||
            type === "permission.v2.asked" ||
            type === "permission.replied" ||
            type === "permission.v2.replied";
          if (isSessionActivity) lastSessionEventAt = Date.now();

          switch (type) {
            case "message.part.delta": {
              const field = props.field;
              const delta = typeof props.delta === "string" ? props.delta : "";
              const partID = typeof props.partID === "string" ? props.partID : "";
              if (field === "text") {
                if (!contentStarted) {
                  contentStarted = true;
                  if (reasoningBuffer && !reasoningSent) {
                    writeNativeDelta(res, model, { reasoning_content: reasoningBuffer });
                    reasoningSent = true;
                  }
                  writeNativeDelta(res, model, { role: "assistant", content: "" });
                }
                if (delta) writeNativeDelta(res, model, { content: delta });
              } else if (field === "reasoning" || field === "thinking") {
                if (!contentStarted) reasoningBuffer += delta;
              } else if ((field === "name" || field === "tool") && partID && delta) {
                // 工具名开始流式输出：先发 pending，之后由 message.part.updated 补全。
                flushReasoning();
                toolParts.set(partID, { name: delta, output: "" });
                writeNativeEvent(res, {
                  type: "activity.upsert",
                  activity: { id: partID, name: delta, status: "pending" },
                });
              } else if (field === "output" && partID) {
                // 工具输出流式输出。
                flushReasoning();
                const existing = toolParts.get(partID);
                const name = existing?.name ?? "";
                const output = (existing?.output ?? "") + delta;
                if (existing) existing.output = output;
                writeNativeEvent(res, {
                  type: "activity.upsert",
                  activity: {
                    id: partID,
                    name,
                    status: "running",
                    output: output || undefined,
                  },
                });
              }
              break;
            }
            case "message.part.update":
            case "message.part.updated":
              emitToolPart(props.part as Record<string, unknown> | undefined);
              break;
            case "permission.asked":
            case "permission.v2.asked":
              // opencode 需要权限才能执行工具（bash / edit / webfetch 等）。
              // 会话会暂停等待前端回复，这里转发给客户端展示「允许/拒绝」弹窗。
              permissionPendingAt = Date.now();
              {
                const permissionId = typeof props.id === "string" ? props.id.trim() : "";
                const version: OpenCodePermissionVersion =
                  type === "permission.v2.asked" ? "v2" : "v1";
                if (permissionId) {
                  forwardedPermissions.set(
                    permissionId,
                    type as "permission.asked" | "permission.v2.asked",
                  );
                  this.pendingPermissions.set(permissionId, { entry, version });
                }
              }
              flushReasoning();
              writeCustomEvent(res, "chat_permission", {
                id: typeof props.id === "string" ? props.id : "",
                version: type === "permission.v2.asked" ? "v2" : "v1",
                permission:
                  (typeof props.permission === "string" ? props.permission : "") ||
                  (typeof props.action === "string" ? props.action : ""),
                patterns:
                  (Array.isArray(props.patterns) ? props.patterns : undefined) ??
                  (Array.isArray(props.resources) ? props.resources : []) ??
                  [],
                metadata:
                  (props.metadata && typeof props.metadata === "object"
                    ? (props.metadata as Record<string, unknown>)
                    : {}) ?? {},
                tool: props.tool,
              });
              break;
            case "permission.replied":
            case "permission.v2.replied":
              // 前端已通过网关回复，会话恢复执行，不再属于权限等待。
              permissionPendingAt = null;
              if (typeof props.requestID === "string" && props.requestID) {
                forwardedPermissions.delete(props.requestID);
                this.pendingPermissions.delete(props.requestID);
              } else if (typeof props.id === "string" && props.id) {
                forwardedPermissions.delete(props.id);
                this.pendingPermissions.delete(props.id);
              }
              break;
            case "session.idle":
              turnDone = true;
              break;
            case "session.status": {
              const status = props.status as { type?: string; message?: string } | undefined;
              if (status?.type === "retry") {
                // 上游重试（免费额度/限流/过载等）：转发提示，避免界面静默等待。
                retryNotice = status.message || "";
                writeCustomEvent(res, "chat_notice", {
                  level: "warning",
                  message: status.message || "模型请求重试中…",
                });
              }
              break;
            }
            case "session.error": {
              const error = props.error as { message?: string } | undefined;
              const message = error?.message || "opencode 会话错误";
              if (contentStarted) {
                turnFailed = true;
                writeNativeEvent(res, { type: "turn.failed", message });
                turnDone = true;
              } else {
                throw new Error(message);
              }
              break;
            }
            default:
              break;
          }
        }
      }
      finalize();
    } finally {
      signal.removeEventListener("abort", cancel);
      reader.cancel().catch(() => {});
      for (const [permissionId, pending] of this.pendingPermissions) {
        if (pending.entry === entry) this.pendingPermissions.delete(permissionId);
      }
    }
  }

  /** 前端回复 opencode 的权限询问（允许一次 / 始终允许 / 拒绝）。
   * 版本选择：
   * - v1：`POST /session/{id}/permissions/{permissionID}`，body `{ response }`
   * - v2：`POST /permission/{requestID}/reply`，body `{ reply }` */
  async replyPermission(
    key: string,
    permissionId: string,
    response: "once" | "always" | "reject",
    version: OpenCodePermissionVersion,
  ): Promise<void> {
    const pending = this.pendingPermissions.get(permissionId);
    const entry = pending?.entry ?? this.latestSessions.get(key);
    if (!entry) {
      throw GatewayError.invalidRequest("会话不存在或已失效，请刷新页面重试");
    }
    // Prefer the protocol reported by OpenCode. The browser can carry a stale
    // version after a build/reload, and native OpenCode prefixes its internal
    // session key with the agent id, so the pending request wins when present.
    const preferred = pending?.version ?? version;
    const fallback = preferred === "v2" ? "v1" : "v2";
    try {
      await this.replyPermissionVia(entry, permissionId, response, preferred);
    } catch (error) {
      // OpenCode releases have briefly exposed both permission APIs with
      // different event/version combinations. Retry the alternate endpoint
      // only for an HTTP compatibility failure; preserve other errors.
      if (!isPermissionCompatibilityError(error)) throw error;
      await this.replyPermissionVia(entry, permissionId, response, fallback);
    }
    this.pendingPermissions.delete(permissionId);
  }

  private replyPermissionVia(
    entry: OpenCodeSessionEntry,
    permissionId: string,
    response: "once" | "always" | "reject",
    version: OpenCodePermissionVersion,
  ): Promise<void> {
    if (version === "v2") {
      return entry.server
        .request("POST", `/permission/${permissionId}/reply`, { reply: response })
        .then(() => undefined);
    }
    return entry.server
      .request("POST", `/session/${entry.opencodeId}/permissions/${permissionId}`, {
        response,
      })
      .then(() => undefined);
  }

  /** 会话缓存淘汰：超过上限时淘汰最久未使用的；空闲超时的会话定期回收。 */
  private evictIfNeeded(): void {
    const max = this.config.maxSessions;
    while (this.sessions.size > max) {
      let oldestKey: string | null = null;
      let oldestUsed = Infinity;
      for (const [key, entry] of this.sessions) {
        if (entry.lastUsed < oldestUsed) {
          oldestUsed = entry.lastUsed;
          oldestKey = key;
        }
      }
      if (oldestKey === null) break;
      const removed = this.sessions.get(oldestKey);
      this.sessions.delete(oldestKey);
      if (removed && this.latestSessions.get(removed.key) === removed) {
        this.latestSessions.delete(removed.key);
      }
    }
    this.ensureIdleTimer();
  }

  private ensureIdleTimer(): void {
    if (this.idleTimer || this.sessions.size === 0) return;
    this.idleTimer = setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of this.sessions) {
        if (now - entry.lastUsed > this.config.sessionIdleMs) {
          this.sessions.delete(key);
          if (this.latestSessions.get(entry.key) === entry) this.latestSessions.delete(entry.key);
        }
      }
      if (this.sessions.size === 0 && this.idleTimer) {
        clearInterval(this.idleTimer);
        this.idleTimer = null;
      }
    }, 60_000);
    this.idleTimer.unref?.();
  }

  stop(): void {
    if (this.idleTimer) {
      clearInterval(this.idleTimer);
      this.idleTimer = null;
    }
    this.sessions.clear();
    this.latestSessions.clear();
    for (const server of this.servers.values()) server.stop();
    this.servers.clear();
  }
}

function splitModel(model: string): [string, string] {
  const index = model.indexOf("/");
  if (index <= 0 || index === model.length - 1) {
    throw GatewayError.unsupportedModel(model);
  }
  return [model.slice(0, index), model.slice(index + 1)];
}

function isPermissionCompatibilityError(error: unknown): boolean {
  return error instanceof Error && /HTTP (?:400|404)\b/.test(error.message);
}

/** Native CLI event stream. Local OpenCode is treated like the other agents. */
const writeNativeDelta = (
  res: ServerResponse,
  _model: string,
  delta: Record<string, unknown>,
  finishReason: string | null = null,
): void => {
  if (typeof delta.content === "string" && delta.content) {
    writeNativeEvent(res, { type: "content.delta", content: delta.content });
  }
  if (typeof delta.reasoning_content === "string" && delta.reasoning_content) {
    writeNativeEvent(res, { type: "reasoning.delta", content: delta.reasoning_content });
  }
  if (finishReason) writeNativeEvent(res, { type: "turn.completed", stopReason: finishReason });
};

/** 控制类 SSE 事件帧（权限、重试提示等），内容事件走 native_event。 */
const writeCustomEvent = writeTranscriptCustomEvent;

/** 把 OpenAI 格式消息列表中的内容提取为纯文本。 */
export function extractTextFromMessage(message: unknown): string {
  if (typeof message !== "object" || message === null) return "";
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part !== "object" || part === null) return "";
        const p = part as { type?: string; text?: string };
        if (p.type === "text" && typeof p.text === "string") return p.text;
        return "";
      })
      .join("\n");
  }
  return "";
}

/** 前端会话 key 不存在时的兜底：按消息内容生成稳定哈希。 */
export function hashKey(parts: string[]): string {
  let hash = 5381;
  for (const part of parts) {
    for (let i = 0; i < part.length; i += 1) {
      hash = ((hash << 5) + hash + part.charCodeAt(i)) >>> 0;
    }
  }
  return `anon-${hash.toString(36)}`;
}

/** 客户端断开时中断本地回合，并清理 SSE 响应。 */
export function attachAbortOnClose(res: ServerResponse): AbortController {
  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) controller.abort();
  });
  return controller;
}

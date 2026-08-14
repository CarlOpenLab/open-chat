import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import type { NextFunction, Request, Response } from "express";
import { loadConfigFile, parseBindAddr, type AppConfig, type LocalConfig } from "./config";
import { GatewayError } from "./error";
import {
  forwardChatRequest,
  parseRequestProvider,
  pipeUpstream,
  type ChatCompletionRequest,
  type ProviderEndpoint,
} from "./provider";
import { createSearchProvider, type SearchProvider } from "./search";
import { runSearchAgentLoop } from "./search-agent";
import {
  LocalChatManager,
  attachAbortOnClose,
  extractTextFromMessage,
  hashKey,
  type LocalModelInfo,
} from "./localProvider";
import { AgentManager } from "./agentManager";
import { resolveExecutable } from "./commandEnv";

const DEFAULT_CONFIG_PATH = "config/providers.toml";

function resolveConfigPath(): string {
  return process.env.CONFIG_PATH ?? process.argv[2] ?? DEFAULT_CONFIG_PATH;
}

function createLocalChatManager(config: AppConfig): LocalChatManager | null {
  if (config.local.enabled) return new LocalChatManager(config.local);

  const openCode = config.acp.agents.find(
    (agent) => agent.transport === "opencode" && agent.enabled,
  );
  if (!config.acp.enabled || !openCode) return null;
  const executable = resolveExecutable(openCode.command);
  if (!executable) return null;
  const localConfig: LocalConfig = {
    ...config.local,
    enabled: true,
    binary: executable,
    cwd: openCode.cwd || config.acp.cwd || process.cwd(),
  };
  return new LocalChatManager(localConfig);
}

function main(): void {
  const configPath = resolveConfigPath();

  let config: AppConfig;
  let searchProvider: SearchProvider | null;
  let localChat: LocalChatManager | null;
  let agentManager: AgentManager;
  try {
    config = loadConfigFile(configPath);
    searchProvider = createSearchProvider(config.search);
    localChat = createLocalChatManager(config);
    agentManager = new AgentManager(config.acp, localChat);
  } catch (err) {
    if (err instanceof GatewayError) {
      console.error(`Failed to load config from ${configPath}: ${err.message}`);
    } else {
      console.error(`Failed to load config from ${configPath}:`, err);
    }
    process.exit(1);
  }

  const app = express();
  app.use(cors(buildCorsOptions(config.corsAllowedOrigins)));
  app.use(express.json());

  if (config.gatewayApiKey) {
    app.use(gatewayAuthMiddleware(config.gatewayApiKey));
  }

  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // 模型发现：服务端搜索能力 + 本地 opencode（AI 取本地的）模型/供应商。
  // 手动配置的服务商数据仍在客户端本地（IndexedDB），前端会合并展示。
  app.get("/api/models", async (_req: Request, res: Response) => {
    let local: {
      enabled: boolean;
      provider: string;
      models: LocalModelInfo[];
      error?: string;
    } = { enabled: false, provider: "", models: [] };
    if (localChat && config.local.enabled) {
      try {
        const models = await localChat.listModels();
        local = { enabled: true, provider: models[0]?.provider ?? "opencode", models };
      } catch (err) {
        console.error("Local opencode model discovery failed:", err);
        local = {
          enabled: false,
          provider: "",
          models: [],
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }
    res.json({
      search: { enabled: !!searchProvider, provider: searchProvider?.name ?? "" },
      local,
    });
  });

  app.get("/api/acp/agents", (_req: Request, res: Response) => {
    res.json({ agents: agentManager.listAgents() });
  });

  app.get("/api/acp/sessions", (req: Request, res: Response) => {
    const agentId = typeof req.query.agentId === "string" ? req.query.agentId : undefined;
    res.json({ sessions: agentManager.listSessions(agentId) });
  });

  app.get("/api/acp/session", async (req: Request, res: Response) => {
    try {
      const agentId = requiredQuery(req, "agentId");
      const conversationId = requiredQuery(req, "conversationId");
      res.json(await agentManager.getSessionState(agentId, conversationId));
    } catch (err) {
      return sendRouteError(res, err, "ACP 会话配置加载失败");
    }
  });

  app.post("/api/acp/session/config", async (req: Request, res: Response) => {
    try {
      const body = req.body as Record<string, unknown>;
      const agentId = requiredBodyString(body, "agentId");
      const conversationId = requiredBodyString(body, "conversationId");
      const configId = requiredBodyString(body, "configId");
      if (typeof body.value !== "string" && typeof body.value !== "boolean") {
        throw GatewayError.invalidRequest("value 必须是字符串或布尔值");
      }
      res.json(
        await agentManager.setSessionConfigOption(agentId, conversationId, configId, body.value),
      );
    } catch (err) {
      return sendRouteError(res, err, "ACP 会话配置更新失败");
    }
  });

  // ============ 聊天：无状态代理转发 + 可选 websearch ============

  app.post("/api/chat/completions", async (req: Request, res: Response) => {
    try {
      const body = req.body as ChatCompletionRequest;
      if (!body || !Array.isArray(body.messages) || body.messages.length === 0) {
        throw GatewayError.invalidRequest("messages array is required");
      }

      const acpAgentId =
        typeof body.acpAgentId === "string" ? body.acpAgentId.trim().toLowerCase() : "";
      if (acpAgentId) {
        return handleAgentChat(req, res, body, acpAgentId, agentManager);
      }

      // 本地模型（形如 `opencode/...`）：转发到本地 opencode（AI 取本地的）。
      if (
        localChat &&
        typeof body.model === "string" &&
        (await localChat.isLocalModel(body.model))
      ) {
        return handleLocalChat(req, res, body, localChat);
      }

      // 转发目标由客户端在请求体携带；解析后从 body 剔除，避免上游报未知字段。
      const endpoint = parseRequestProvider(body);
      delete body.provider;
      delete body.mode;
      delete body.permission;

      const stream = body.stream === true;

      // 客户端声明 `web_search` 工具时走 agent 循环：拦截工具调用并执行
      // 搜索提供方（Tavily），把结果回喂给模型。其余请求原样透传。
      const canSearch =
        stream && endpoint.api === "chat/completions" && hasWebSearchTool(body.tools);

      if (canSearch && searchProvider) {
        await runSearchAgentLoop(req, res, buildStreamRequest(endpoint), body, searchProvider);
      } else {
        // 无搜索后端：剥掉工具，避免模型调用无人执行的功能。
        if (canSearch) stripWebSearchTool(body);
        const upstream = await forwardChatRequest(endpoint, body);
        await pipeUpstream(req, res, upstream);
      }
    } catch (err) {
      if (res.headersSent) {
        console.error("Chat API error after headers sent:", err);
        try {
          res.end();
        } catch {
          // response already ended
        }
        return;
      }
      if (err instanceof GatewayError) {
        return sendGatewayError(res, err);
      }
      console.error("Chat API error:", err);
      return sendGatewayError(
        res,
        GatewayError.upstream(err instanceof Error ? err.message : "Internal server error"),
      );
    }
  });

  // 前端回复 opencode 的权限询问（允许一次 / 始终允许 / 拒绝）。本地模型回合
  // 触发 `chat_permission` 事件后，opencode 会话会暂停等待；前端据此回复。
  app.post("/api/chat/permission", async (req: Request, res: Response) => {
    try {
      const body = req.body as {
        conversationId?: unknown;
        permissionId?: unknown;
        response?: unknown;
        version?: unknown;
        agentId?: unknown;
      };
      const conversationId =
        typeof body.conversationId === "string" ? body.conversationId.trim() : "";
      const permissionId = typeof body.permissionId === "string" ? body.permissionId.trim() : "";
      const response = body.response;
      const version = body.version === "v2" ? "v2" : "v1";
      if (!permissionId) throw GatewayError.invalidRequest("permissionId 是必填项");
      if (response !== "once" && response !== "always" && response !== "reject") {
        throw GatewayError.invalidRequest("response 必须是 once / always / reject");
      }
      if (body.version === "acp") {
        const agentId = typeof body.agentId === "string" ? body.agentId.trim() : "";
        if (!agentId) throw GatewayError.invalidRequest("agentId 是必填项");
        await agentManager.replyPermission(agentId, permissionId, response);
        res.json({ ok: true });
        return;
      }
      if (!conversationId) {
        throw GatewayError.invalidRequest("conversationId 是必填项");
      }
      if (!localChat) throw GatewayError.invalidRequest("本地 OpenCode AI 未启用");
      await localChat.replyPermission(conversationId, permissionId, response, version);
      res.json({ ok: true });
    } catch (err) {
      if (err instanceof GatewayError) return sendGatewayError(res, err);
      console.error("Permission reply error:", err);
      return sendGatewayError(
        res,
        GatewayError.upstream(err instanceof Error ? err.message : "权限回复失败"),
      );
    }
  });

  const { host, port } = parseBindAddr(config.bindAddr);
  const server = createServer(app);
  server.listen(port, host, () => {
    console.log(`Server running at http://${host}:${port}`);
    console.log(`Config:      ${configPath}`);
    console.log(`Health:      http://${host}:${port}/health`);
    console.log(`Models:      http://${host}:${port}/api/models`);
    console.log(`Chat:        http://${host}:${port}/api/chat/completions`);
    console.log(`Gateway auth: ${config.gatewayApiKey ? "enabled" : "disabled"}`);
    console.log(`Web search:  ${searchProvider ? searchProvider.name : "disabled"}`);
    console.log(`Local AI:    ${localChat ? "enabled (opencode)" : "disabled"}`);
    console.log(
      `CLI agents:  ${agentManager.listAgents().filter((agent) => agent.available).length} available`,
    );
  });

  process.on("SIGTERM", () => {
    localChat?.stop();
    agentManager.stop();
    server.close(() => {
      console.log("Server closed");
      process.exit(0);
    });
  });
}

async function handleAgentChat(
  _req: Request,
  res: Response,
  body: ChatCompletionRequest,
  agentId: string,
  agentManager: AgentManager,
): Promise<void> {
  const messages = body.messages as Array<{ role?: unknown; content?: unknown }>;
  const lastUser = [...messages].reverse().find((message) => message.role === "user");
  const text = lastUser ? extractTextFromMessage(lastUser) : "";
  if (!text.trim()) throw GatewayError.invalidRequest("本地 Agent 需要至少一条 user 消息");
  const conversationId =
    typeof body.conversationId === "string" && body.conversationId.trim()
      ? body.conversationId.trim()
      : hashKey(messages.map((message) => extractTextFromMessage(message)));

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  const abort = attachAbortOnClose(res);
  try {
    await agentManager.runTurn(agentId, conversationId, text, res, abort.signal);
  } catch (err) {
    if (abort.signal.aborted) return;
    console.error(`Agent ${agentId} error:`, err);
    if (!res.headersSent) {
      if (err instanceof GatewayError) return sendGatewayError(res, err);
      return sendGatewayError(
        res,
        GatewayError.upstream(err instanceof Error ? err.message : String(err)),
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    res.write(`event: chat_error\ndata: ${JSON.stringify({ message })}\n\n`);
    res.write("data: [DONE]\n\n");
    res.end();
  }
}

function buildCorsOptions(origins: string[]): cors.CorsOptions {
  const hasWildcard = origins.some((origin) => origin.trim() === "*");
  return {
    origin: hasWildcard ? "*" : origins.length > 0 ? origins : false,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type"],
  };
}

function gatewayAuthMiddleware(apiKey: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const header = req.header("authorization");
    if (!header || !header.startsWith("Bearer ")) {
      return sendGatewayError(res, GatewayError.unauthorized());
    }
    const token = header.slice("Bearer ".length).trim();
    if (token !== apiKey) {
      return sendGatewayError(res, GatewayError.unauthorized());
    }
    next();
  };
}

function sendGatewayError(res: Response, err: GatewayError): void {
  res.status(err.status).json(err.toResponse());
}

function sendRouteError(res: Response, err: unknown, fallback: string): void {
  if (err instanceof GatewayError) return sendGatewayError(res, err);
  console.error(`${fallback}:`, err);
  return sendGatewayError(
    res,
    GatewayError.upstream(err instanceof Error ? err.message : fallback),
  );
}

function requiredQuery(req: Request, name: string): string {
  const value = req.query[name];
  if (typeof value !== "string" || !value.trim()) {
    throw GatewayError.invalidRequest(`${name} 是必填项`);
  }
  return value.trim();
}

function requiredBodyString(body: Record<string, unknown>, name: string): string {
  const value = body[name];
  if (typeof value !== "string" || !value.trim()) {
    throw GatewayError.invalidRequest(`${name} 是必填项`);
  }
  return value.trim();
}

/**
 * 构造 agent 循环用的上游流请求：调用代理的 `forwardChatRequest`，
 * 非 2xx 转成 GatewayError（保持与透传一致的错误行为），返回 SSE body。
 */
function buildStreamRequest(endpoint: ProviderEndpoint) {
  return async (requestBody: ChatCompletionRequest): Promise<ReadableStream<Uint8Array>> => {
    const upstream = await forwardChatRequest(endpoint, requestBody);
    if (!upstream.ok) {
      const text = await upstream.text().catch(() => "");
      throw GatewayError.upstream(
        `upstream ${endpoint.api} request failed with status ${upstream.status}: ${text}`,
      );
    }
    if (!upstream.body) {
      throw GatewayError.upstream(`No response body from upstream ${endpoint.api} stream`);
    }
    return upstream.body;
  };
}

/** True when the request `tools` array declares a `web_search` function tool. */
function isWebSearchTool(tool: unknown): boolean {
  if (typeof tool !== "object" || tool === null) return false;
  const fn = (tool as { function?: unknown }).function;
  return typeof fn === "object" && fn !== null && (fn as { name?: unknown }).name === "web_search";
}

function hasWebSearchTool(tools: unknown): boolean {
  return Array.isArray(tools) && tools.some(isWebSearchTool);
}

/** Remove the `web_search` tool from the request (used when no search backend). */
function stripWebSearchTool(body: ChatCompletionRequest): void {
  const tools = body.tools;
  if (!Array.isArray(tools)) return;
  const filtered = tools.filter((tool) => !isWebSearchTool(tool));
  if (filtered.length === 0) {
    delete body.tools;
  } else {
    body.tools = filtered;
  }
}

/**
 * 本地聊天：把 OpenAI 格式请求转给本地 opencode（AI 取本地的）。
 *
 * - 会话按 `conversationId` 复用 opencode 长会话（历史积累在本地），
 *   只发最后一条用户消息；无 conversationId 时按消息内容生成兜底 key。
 * - 输出 OpenAI SSE 流（content / reasoning_content），前端 SDK 无需改动。
 */
async function handleLocalChat(
  req: Request,
  res: Response,
  body: ChatCompletionRequest,
  localChat: LocalChatManager,
): Promise<void> {
  const model = body.model as string;
  const messages = body.messages;
  // system prompt 经前端 transformParams 合并进了 messages[0]（role: system），
  // body.systemPrompt 字段不存在；这里从 messages 里提取。
  const systemPrompt = messages
    .filter((m) => (m as { role?: unknown }).role === "system")
    .map((m) => extractTextFromMessage(m))
    .filter((text) => text.trim().length > 0)
    .join("\n");
  const lastUser = [...messages].reverse().find((m) => {
    const role = (m as { role?: unknown }).role;
    return role === "user";
  });
  const text = lastUser ? extractTextFromMessage(lastUser) : "";
  if (!text.trim()) {
    throw GatewayError.invalidRequest("本地模型需要至少一条 user 消息");
  }
  const conversationId = (body as Record<string, unknown>).conversationId;
  const key =
    typeof conversationId === "string" && conversationId.trim()
      ? conversationId.trim()
      : hashKey([systemPrompt, ...messages.map((m) => extractTextFromMessage(m))]);

  const session = await localChat.getOrCreateSession(key, model);

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const abort = attachAbortOnClose(res);
  try {
    await localChat.runTurn(session, text, model, systemPrompt, res, abort.signal);
  } catch (err) {
    if (abort.signal.aborted) {
      // 客户端断开：静默结束（runTurn 已中断本地回合）。
      return;
    }
    console.error("Local chat error:", err);
    if (!res.headersSent) {
      if (err instanceof GatewayError) return sendGatewayError(res, err);
      return sendGatewayError(
        res,
        GatewayError.upstream(err instanceof Error ? err.message : String(err)),
      );
    }
    try {
      const message = err instanceof Error ? err.message : String(err);
      res.write(
        `event: chat_error\n` +
          `data: ${JSON.stringify({ message, type: "upstream_error", code: "provider_error" })}\n\n`,
      );
      res.write("data: [DONE]\n\n");
      res.end();
    } catch {
      // response already ended
    }
  }
}

main();

/**
 * Open Chat 网关应用（可编程入口）。
 *
 * `createGatewayApp` 构建 Express 应用（不监听端口）；`startGateway`
 * 负责加载配置、构建运行时、监听端口并返回优雅停止句柄。
 * 独立入口（src/index.ts）与 CLI（tools/open-chat）都基于这两个函数。
 */
import express from "express";
import type { Express, NextFunction, Request, Response } from "express";
import cors from "cors";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { randomBytes, timingSafeEqual } from "node:crypto";
import {
  attachmentStore,
  type AttachmentStore,
  ATTACHMENT_SCHEME,
  attachmentContentType,
  defaultWorkspaceDir,
} from "./attachments";
import { defaultAppConfig, type AppConfig, type LocalConfig } from "./config";
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
import type { AcpPermissionMode } from "./acpManager";
import { resolveExecutable } from "./commandEnv";
import { pickProjectDirectory } from "./projectPicker";
import { writeNativeEvent } from "./nativeEvents";
import { readGitWorkspace, switchGitBranch } from "./gitWorkspace";
import { listSkills } from "./skills";
import { isAllowedStateName, readState, writeState, deleteState } from "./stateStore";
import { listBoardTasks, createBoardTask, patchBoardTask, deleteBoardTask } from "./boardTasks";

/** 附件存储单例：落盘到 ~/.cc-hearts-open-code/attachments（OPEN_CHAT_DATA_DIR 可覆盖）。 */
const attachments = attachmentStore;

/** 网关运行时：配置 + 由配置构建的各管理器。 */
export interface GatewayRuntime {
  config: AppConfig;
  searchProvider: SearchProvider | null;
  localChat: LocalChatManager | null;
  agentManager: AgentManager;
}

export interface GatewayStartOptions {
  /** 覆盖默认监听地址（0.0.0.0，可从局域网访问）。 */
  host?: string;
  /** 覆盖默认端口（8082）；0 表示自动分配（以实际监听端口为准）。 */
  port?: number;
  /** 提供时以静态站点（SPA）形式托管 Web UI，与 API 同源。 */
  staticDir?: string;
  /** 监听成功回调（URL 已确定，可用于自动打开浏览器）。 */
  onListen?: (info: { url: string; host: string; port: number }) => void;
}

export interface GatewayHandle {
  server: Server;
  url: string;
  host: string;
  port: number;
  /** 本次启动的 Web 访问密码（始终生成；用于拼接 ?token= 自动登录 URL）。 */
  password?: string;
  /** 停止本地 agent / opencode 会话并关闭 HTTP 服务。 */
  stop(): Promise<void>;
}

/** One process-local password and session. Both disappear when the gateway stops. */
interface WebAccessControl {
  password: string;
  sessionToken: string;
}

/** 构建内置默认运行时（无配置文件，自动发现本机 CLI）。 */
export function loadGatewayRuntime(): GatewayRuntime {
  const config = defaultAppConfig();
  const searchProvider = createSearchProvider(config.search);
  const localChat = createLocalChatManager(config);
  const agentManager = new AgentManager(config.acp, localChat);
  return { config, searchProvider, localChat, agentManager };
}

/** 构建网关 Express 应用；`staticDir` 非空时在同一端口托管 Web UI。 */
export function createGatewayApp(
  runtime: GatewayRuntime,
  staticDir?: string,
  access?: WebAccessControl,
): Express {
  const { config, searchProvider, localChat, agentManager } = runtime;
  // 无项目目录时的默认 agent 工作目录：~/.cc-hearts-open-code/workspace
  mkdirSync(defaultWorkspaceDir(), { recursive: true });
  const app = express();
  app.disable("x-powered-by");
  app.use(cors(buildCorsOptions(config.corsAllowedOrigins)));
  // 附件上传走 base64 JSON，放大后可达 40MB 左右，放宽 body 上限。
  app.use(express.json({ limit: "44mb" }));

  // 访问控制路由总是注册，供前端 App.vue 统一探测状态：
  // - 启用密码（access）时：status 返回真实授权状态，未授权走密码登录；
  // - 未启用（access 为 undefined，仅供纯 API-key 客户端复用）时：status 恒为
  //   authorized: true，登录直接放行，且不挂 /api 鉴权中间件。
  // startGateway 总会生成 access；任何模式（含 --dev）都有 Web 访问密码。
  app.get("/api/access/status", (req: Request, res: Response) => {
    res.json({ authorized: access ? hasWebAccess(req, access, config.gatewayApiKey) : true });
  });
  app.post("/api/access/login", (req: Request, res: Response) => {
    if (access) {
      const password = typeof req.body?.password === "string" ? req.body.password : "";
      if (!sameSecret(password, access.password)) {
        return res
          .status(401)
          .json({ error: { message: "密码不正确", type: "authentication_error" } });
      }
      res.setHeader("Set-Cookie", buildWebAccessCookie(access.sessionToken));
    }
    return res.json({ authorized: true });
  });
  app.post("/api/access/logout", (_req: Request, res: Response) => {
    res.setHeader("Set-Cookie", "open_chat_access=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0");
    res.json({ authorized: false });
  });
  if (access) {
    // Static assets remain public so the login screen can load, but every
    // operational API requires the per-start password session.
    app.use("/api", (req: Request, res: Response, next: NextFunction) => {
      if (hasWebAccess(req, access, config.gatewayApiKey)) return next();
      return res
        .status(401)
        .json({ error: { message: "请输入访问密码", type: "authentication_error" } });
    });
  }

  if (config.gatewayApiKey && !access) {
    app.use(gatewayAuthMiddleware(config.gatewayApiKey));
  }

  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // ===== 状态持久化：任务 / 会话索引存网关，浏览器无状态，局域网共享 =====
  app.get("/api/state/:name", (req: Request, res: Response) => {
    const name = String(req.params.name);
    if (!isAllowedStateName(name)) {
      return res.status(404).json({ error: { message: `unknown state: ${name}` } });
    }
    const envelope = readState(name);
    if (!envelope) return res.status(404).json({ found: false });
    res.json({ found: true, updatedAt: envelope.updatedAt, data: envelope.data });
  });

  app.put("/api/state/:name", (req: Request, res: Response) => {
    const name = String(req.params.name);
    if (!isAllowedStateName(name)) {
      return res.status(404).json({ error: { message: `unknown state: ${name}` } });
    }
    try {
      const envelope = writeState(name, req.body ?? null);
      res.json({ ok: true, updatedAt: envelope.updatedAt });
    } catch (err) {
      sendRouteError(res, err, "状态写入失败");
    }
  });

  app.delete("/api/state/:name", (req: Request, res: Response) => {
    const name = String(req.params.name);
    if (!isAllowedStateName(name)) {
      return res.status(404).json({ error: { message: `unknown state: ${name}` } });
    }
    try {
      deleteState(name);
      res.json({ ok: true });
    } catch (err) {
      sendRouteError(res, err, "状态清除失败");
    }
  });

  // ===== 看板任务操作：看板 AI 助手（本地 ACP agent 经 curl）读写任务 =====
  app.get("/api/board/tasks", (_req: Request, res: Response) => {
    res.json({ tasks: listBoardTasks() });
  });

  app.post("/api/board/tasks", (req: Request, res: Response) => {
    try {
      const task = createBoardTask(req.body);
      if (!task) {
        return sendGatewayError(res, GatewayError.invalidRequest("请求体需包含 title 字段"));
      }
      res.status(201).json({ task });
    } catch (err) {
      sendRouteError(res, err, "任务创建失败");
    }
  });

  app.patch("/api/board/tasks/:id", (req: Request, res: Response) => {
    const id = typeof req.params.id === "string" ? req.params.id : "";
    try {
      const result = patchBoardTask(id, req.body);
      if (result === null) {
        return sendGatewayError(res, GatewayError.invalidRequest("请求体包含非法字段"));
      }
      if (result === undefined) {
        return res.status(404).json({ error: { message: `task not found: ${id}` } });
      }
      res.json({ task: result });
    } catch (err) {
      sendRouteError(res, err, "任务更新失败");
    }
  });

  app.delete("/api/board/tasks/:id", (req: Request, res: Response) => {
    const id = typeof req.params.id === "string" ? req.params.id : "";
    try {
      // 硬确认门槛：DELETE 必须带 { "confirmed": true }，否则拒绝。
      // 仅靠系统提示无法保证 agent 先征求用户同意，删除是不可逆操作，在 API 层兜底。
      const body = (req.body ?? {}) as Record<string, unknown>;
      if (body.confirmed !== true) {
        return sendGatewayError(
          res,
          GatewayError.invalidRequest(
            '删除任务前必须先向用户确认，征得明确同意后在请求体中加入 "confirmed": true 再重试',
          ),
        );
      }
      if (!deleteBoardTask(id)) {
        return res.status(404).json({ error: { message: `task not found: ${id}` } });
      }
      res.json({ ok: true });
    } catch (err) {
      sendRouteError(res, err, "任务删除失败");
    }
  });

  // 模型发现：服务端搜索能力 + 本地 opencode（AI 取本地的）模型/供应商。
  // 手动配置的服务商数据存网关（/api/state/providers，局域网共享），前端合并展示。
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

  // 附件上传：浏览器 → 网关落盘到 ~/.cc-hearts-open-code/attachments/<uuid>/<name>。
  // 返回持久引用 `cc-attachment:<uuid>`；agent 发送时直接读磁盘路径（同机）。
  app.post("/api/attachments", (req: Request, res: Response) => {
    try {
      const body = req.body as { name?: unknown; dataBase64?: unknown };
      if (typeof body.name !== "string" || typeof body.dataBase64 !== "string") {
        throw GatewayError.invalidRequest("name 与 dataBase64 是必填项");
      }
      const stored = attachments.importBytes(body.name, Buffer.from(body.dataBase64, "base64"));
      res.json({ ok: true, ...stored });
    } catch (err) {
      sendRouteError(res, err, "附件上传失败");
    }
  });

  // 附件读取：渲染历史消息图片用。reference(UUID) + 文件名双重校验，防路径穿越。
  app.get("/api/attachments/:reference/:name", (req: Request, res: Response) => {
    try {
      const reference = String(req.params.reference);
      const name = String(req.params.name);
      const bytes = attachments.read(reference, name);
      res.setHeader("Content-Type", attachmentContentType(name));
      res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
      res.send(bytes);
    } catch (err) {
      if (err instanceof Error && err.message.includes("不存在")) {
        return sendGatewayError(res, GatewayError.invalidRequest("附件不存在或引用无效"));
      }
      sendRouteError(res, err, "附件读取失败");
    }
  });

  // 手动触发孤儿附件清理（默认保留 7 天未修改的目录）。
  app.post("/api/attachments/sweep", (_req: Request, res: Response) => {
    try {
      res.json({ ok: true, removed: attachments.sweep() });
    } catch (err) {
      sendRouteError(res, err, "附件清理失败");
    }
  });

  app.post("/api/project-path/pick", async (req: Request, res: Response) => {
    try {
      if (!isLoopbackRequest(req)) {
        throw GatewayError.unauthorized();
      }
      const path = await pickProjectDirectory();
      res.json({ canceled: !path, ...(path ? { path } : {}) });
    } catch (err) {
      if (err instanceof GatewayError) return sendGatewayError(res, err);
      console.error("Project directory picker failed:", err);
      return sendGatewayError(
        res,
        GatewayError.upstream(err instanceof Error ? err.message : "系统目录选择器不可用"),
      );
    }
  });

  app.get("/api/project-path/default", (req: Request, res: Response) => {
    if (!isLoopbackRequest(req)) return sendGatewayError(res, GatewayError.unauthorized());
    res.json({ path: defaultWorkspaceDir() });
  });

  app.get("/api/project-path/git", async (req: Request, res: Response) => {
    try {
      if (!isLoopbackRequest(req)) throw GatewayError.unauthorized();
      const projectPath = parseProjectPath(requiredQuery(req, "path"));
      if (!projectPath) throw GatewayError.invalidRequest("path 是必填项");
      res.json(await readGitWorkspace(projectPath));
    } catch (err) {
      return sendRouteError(res, err, "Git 状态读取失败");
    }
  });

  // 输入区 "/" suggestion 的 skills 列表；projectPath 可选，缺省只返回全局。
  app.get("/api/skills", async (req: Request, res: Response) => {
    try {
      if (!isLoopbackRequest(req)) throw GatewayError.unauthorized();
      const rawProjectPath = optionalString(req.query.projectPath);
      const projectPath = rawProjectPath ? parseProjectPath(rawProjectPath) : undefined;
      res.json(await listSkills(projectPath ?? ""));
    } catch (err) {
      return sendRouteError(res, err, "Skills 列表读取失败");
    }
  });

  app.post("/api/project-path/git/switch", async (req: Request, res: Response) => {
    try {
      if (!isLoopbackRequest(req)) throw GatewayError.unauthorized();
      const body = req.body as { path?: unknown; branch?: unknown };
      const projectPath = parseProjectPath(body.path);
      if (!projectPath) throw GatewayError.invalidRequest("path 是必填项");
      if (typeof body.branch !== "string" || !body.branch.trim()) {
        throw GatewayError.invalidRequest("branch 是必填项");
      }
      res.json(await switchGitBranch(projectPath, body.branch.trim()));
    } catch (err) {
      return sendRouteError(res, err, "Git 分支切换失败");
    }
  });

  app.get("/api/acp/agents", (_req: Request, res: Response) => {
    res.json({ agents: agentManager.listAgents() });
  });

  app.get("/api/acp/session", async (req: Request, res: Response) => {
    try {
      const agentId = requiredQuery(req, "agentId");
      const conversationId = requiredQuery(req, "conversationId");
      res.json(
        await agentManager.getSessionState(
          agentId,
          conversationId,
          parseProjectPath(req.query.projectPath),
          optionalString(req.query.providerSessionId),
        ),
      );
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
        await agentManager.setSessionConfigOption(
          agentId,
          conversationId,
          configId,
          body.value,
          parseProjectPath(body.projectPath),
          optionalString(body.providerSessionId),
        ),
      );
    } catch (err) {
      return sendRouteError(res, err, "ACP 会话配置更新失败");
    }
  });

  // 会话实时输出：SSE 订阅（多标签 / 刷新恢复后继续观看运行中的回合）
  app.get("/api/acp/session/stream", async (req: Request, res: Response) => {
    try {
      const agentId = requiredQuery(req, "agentId");
      const conversationId = requiredQuery(req, "conversationId");
      if (!(await agentManager.subscribeSessionStream(agentId, conversationId, res))) {
        // The run may finish between the sessions poll and this subscription.
        // No active stream is a normal race, not a missing API resource.
        res.status(204).end();
        return;
      }
      // SSE 心跳：长时间无输出时防止代理/浏览器超时断连
      const heartbeat = setInterval(() => {
        if (!res.writableEnded && !res.destroyed) res.write(": ping\n\n");
      }, 15_000);
      res.on("close", () => clearInterval(heartbeat));
    } catch (err) {
      return sendRouteError(res, err, "ACP 会话流订阅失败");
    }
  });

  // 取消运行中的回合（多标签 / 刷新后停止孤儿回合）
  app.post("/api/acp/session/cancel", async (req: Request, res: Response) => {
    try {
      const body = req.body as Record<string, unknown>;
      const agentId = requiredBodyString(body, "agentId");
      const conversationId = requiredBodyString(body, "conversationId");
      res.json({ cancelled: await agentManager.cancelTurn(agentId, conversationId) });
    } catch (err) {
      return sendRouteError(res, err, "ACP 回合取消失败");
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
      // goal / instruction 为 sender 斜杠指令的单次高优输入：注入为 system 消息后剔除独立字段
      injectGoalMessages(body as unknown as Record<string, unknown>);
      delete body.provider;
      delete body.mode;
      delete body.permission;
      delete body.projectPath;
      delete (body as Record<string, unknown>).goal;
      delete (body as Record<string, unknown>).instruction;
      // 附件引用 → OpenAI 多模态 image_url（data URL，远端模型读不到本地路径）。
      injectAttachmentsForUpstream(body.messages as unknown[], attachments);
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

  // 未匹配的 API 路由：JSON 404（避免被 SPA fallback 吞掉）。
  app.use("/api", (_req: Request, res: Response) => {
    res.status(404).json({
      error: { message: "Not found", type: "invalid_request_error", code: "not_found" },
    });
  });

  if (staticDir) {
    app.use(express.static(staticDir, { index: "index.html" }));
    // SPA fallback：非 API 的 GET/HEAD 全部回 index.html（支持 /chat/... 深链接）。
    const indexFile = join(staticDir, "index.html");
    if (existsSync(indexFile)) {
      app.use((req: Request, res: Response, next: NextFunction) => {
        if (req.method !== "GET" && req.method !== "HEAD") return next();
        res.sendFile(indexFile);
      });
    }
  }

  return app;
}

/**
 * 加载配置并启动网关。监听成功后返回句柄（含 URL 与优雅停止方法）。
 * 配置/端口错误会以异常形式抛出，由调用方决定如何提示。
 */
export async function startGateway(options: GatewayStartOptions): Promise<GatewayHandle> {
  const runtime = loadGatewayRuntime();
  // 任何模式都生成一次性访问密码：前端优先读 URL 里的 ?token= 自动登录，
  // 手动输入框作回退；密码随进程退出失效。
  const access: WebAccessControl = {
    password: randomBytes(12).toString("base64url"),
    sessionToken: randomBytes(32).toString("base64url"),
  };
  const app = createGatewayApp(runtime, options.staticDir, access);

  const host = options.host ?? "0.0.0.0";
  const port = options.port ?? 8082;

  const server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException): void => {
      if ((err as NodeJS.ErrnoException).code === "EADDRINUSE") {
        reject(
          new Error(
            `端口 ${port} 已被占用（EADDRINUSE）。\n` +
              `  解决：\n` +
              `    1) pnpm kill                      # 清理 3000/8082/4311\n` +
              `    2) lsof -ti :${port} | xargs kill -9\n` +
              `    3) open-chat --port 0             # 自动分配可用端口\n` +
              `    4) hub stop open-chat-app         # 如果是 omp 托管进程\n` +
              `  原始错误: ${err.message}`,
          ),
        );
        return;
      }
      reject(err);
    };
    server.once("error", onError);
    server.listen(port, host, () => {
      server.off("error", onError);
      resolve();
    });
  });

  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  const displayHost = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
  const url = `http://${displayHost}:${actualPort}/`;

  console.log(`Server running at http://${host}:${actualPort}`);
  console.log(`Config:      built-in defaults（无配置文件，自动发现本机 CLI）`);
  console.log(`Health:      http://${host}:${actualPort}/health`);
  console.log(`Models:      http://${host}:${actualPort}/api/models`);
  console.log(`Chat:        http://${host}:${actualPort}/api/chat/completions`);
  if (options.staticDir) {
    console.log(`Web UI:      ${url}?token=${access.password}`);
  } else {
    // 无静态托管 = 开发模式（Vite dev server 代理 /api 到本网关）。
    // 密码在网关启动后才生成，Vite 横幅早打印了不含 token 的 URL，这里补全。
    console.log(`Web UI (dev): http://localhost:3000/?token=${access.password}`);
  }
  console.log(`Web password: ${access.password}`);
  console.log("Web access:  打开带 ?token= 的 URL 自动登录；密码每次启动变化");
  console.log(`Gateway auth: ${runtime.config.gatewayApiKey ? "enabled" : "disabled"}`);
  console.log(`Web search:  ${runtime.searchProvider ? runtime.searchProvider.name : "disabled"}`);
  console.log(`Local AI:    ${runtime.localChat ? "enabled (opencode)" : "disabled"}`);
  console.log(
    `CLI agents:  ${runtime.agentManager.listAgents().filter((agent) => agent.available).length} available`,
  );

  options.onListen?.({ url, host: displayHost, port: actualPort });

  let stopped = false;
  const stop = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    runtime.localChat?.stop();
    runtime.agentManager.stop();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      // SSE / keep-alive 连接会阻塞 close 完成，主动断开。
      server.closeAllConnections();
    });
  };

  return { server, url, host: displayHost, port: actualPort, password: access.password, stop };
}

function createLocalChatManager(config: AppConfig): LocalChatManager | null {
  if (config.local.enabled) {
    return new LocalChatManager({
      ...config.local,
      cwd: config.local.cwd || config.acp.cwd || defaultWorkspaceDir(),
    });
  }

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
    cwd: openCode.cwd || config.acp.cwd || defaultWorkspaceDir(),
  };
  return new LocalChatManager(localConfig);
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
  const rawGoal =
    typeof (body as Record<string, unknown>).goal === "string"
      ? String((body as Record<string, unknown>).goal).trim()
      : "";
  const rawInstruction =
    typeof (body as Record<string, unknown>).instruction === "string"
      ? String((body as Record<string, unknown>).instruction).trim()
      : "";
  // Oh My Pi 优先：goal 与 review 均以高优 system 上下文注入，Pi 系对 [GOAL]/[REVIEW] 前缀有更明确的执行语义
  const isOhMyPi = agentId === "pi" || agentId === "omp";
  let goalBlock = "";
  let goalPrefix = "";
  if (rawGoal || rawInstruction) {
    // 区分 goal 与 review/instruction，若仅 instruction 有值且疑似 review，则用 [REVIEW]（Oh My Pi 专用）
    const isReviewLike =
      !rawGoal && rawInstruction && /review|复审/i.test(rawInstruction.slice(0, 20));
    if (isOhMyPi && isReviewLike) {
      goalBlock = rawInstruction;
      goalPrefix = `[REVIEW]\n${goalBlock}\n\n`;
    } else {
      goalBlock = [rawGoal, rawInstruction].filter(Boolean).join("\n\n");
      goalPrefix = isOhMyPi ? `[OH_MY_PI_GOAL]\n${goalBlock}\n\n` : `[GOAL]\n${goalBlock}\n\n`;
    }
  }
  const userText = lastUser ? extractTextFromMessage(lastUser as unknown) : "";
  const text = [goalPrefix + userText, ...attachmentMentions(messages, attachments)]
    .filter(Boolean)
    .join(" ");
  if (!text.trim()) throw GatewayError.invalidRequest("本地 Agent 需要至少一条 user 消息");
  const conversationId =
    typeof body.conversationId === "string" && body.conversationId.trim()
      ? body.conversationId.trim()
      : hashKey(messages.map((message) => extractTextFromMessage(message as unknown)));
  const projectPath = parseProjectPath(body.projectPath);
  const providerSessionId = optionalString(body.providerSessionId);
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  try {
    await agentManager.runTurn(
      agentId,
      conversationId,
      text,
      projectPath,
      providerSessionId,
      res,
      parsePermissionMode(body.permission),
    );
  } catch (err) {
    // A page refresh only disconnects this response; the tracked run continues
    // and can be re-subscribed through /api/acp/session/stream. AbortError here
    // therefore only comes from the explicit session cancellation endpoint.
    // acp-hub 把取消包成 AdapterError('prompt_failed', 'Prompt aborted')，
    // 真正的 AbortError 放在 cause 上——同样视为用户主动取消。
    const abortCause =
      err instanceof Error && err.cause instanceof DOMException && err.cause.name === "AbortError";
    if ((err instanceof Error && err.name === "AbortError") || abortCause) return;
    console.error(`Agent ${agentId} error:`, err);
    if (!res.headersSent) {
      if (err instanceof GatewayError) return sendGatewayError(res, err);
      return sendGatewayError(
        res,
        GatewayError.upstream(err instanceof Error ? err.message : String(err)),
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    if (!res.writableEnded && !res.destroyed) {
      writeNativeEvent(res, { type: "turn.failed", message });
      res.write("data: [DONE]\n\n");
      res.end();
    }
  }
}

/**
 * 本地聊天：把 OpenAI 格式请求转给本地 opencode（AI 取本地的）。
 *
 * - 会话按 `conversationId` 复用 opencode 长会话（历史积累在本地），
 *   只发最后一条用户消息；无 conversationId 时按消息内容生成兜底 key。
 * - 输出 native_event 流（正文 / 思考 / 工具），前端只负责事件投影。
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
  const baseSystemPrompt = messages
    .filter((m) => (m as { role?: unknown }).role === "system")
    .map((m) => extractTextFromMessage(m as unknown))
    .filter((text) => text.trim().length > 0)
    .join("\n");
  const rawGoal =
    typeof (body as Record<string, unknown>).goal === "string"
      ? String((body as Record<string, unknown>).goal).trim()
      : "";
  const rawInstruction =
    typeof (body as Record<string, unknown>).instruction === "string"
      ? String((body as Record<string, unknown>).instruction).trim()
      : "";
  const goalBlock = [rawGoal, rawInstruction].filter(Boolean).join("\n\n");
  const systemPrompt = goalBlock
    ? `[GOAL]\n${goalBlock}${baseSystemPrompt ? `\n\n${baseSystemPrompt}` : ""}`
    : baseSystemPrompt;
  const lastUser = [...messages].reverse().find((m) => {
    const role = (m as { role?: unknown }).role;
    return role === "user";
  });
  const text = [
    lastUser ? extractTextFromMessage(lastUser as unknown) : "",
    ...attachmentMentions(messages, attachments),
  ]
    .filter(Boolean)
    .join(" ");
  if (!text.trim()) {
    throw GatewayError.invalidRequest("本地模型需要至少一条 user 消息");
  }
  const conversationId = (body as Record<string, unknown>).conversationId;
  const key =
    typeof conversationId === "string" && conversationId.trim()
      ? conversationId.trim()
      : hashKey([systemPrompt, ...messages.map((m) => extractTextFromMessage(m as unknown))]);
  const projectPath = parseProjectPath((body as Record<string, unknown>).projectPath);

  const session = await localChat.getOrCreateSession(key, model, projectPath);

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
      writeNativeEvent(res, { type: "turn.failed", message });
      res.write("data: [DONE]\n\n");
      res.end();
    } catch {
      // response already ended
    }
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

function hasWebAccess(req: Request, access: WebAccessControl, gatewayApiKey: string): boolean {
  // Existing API-key clients keep working; browser sessions use the generated
  // cookie instead, so the key never has to be embedded in the Web UI.
  const header = req.header("authorization");
  if (
    gatewayApiKey &&
    header?.startsWith("Bearer ") &&
    sameSecret(header.slice(7), gatewayApiKey)
  ) {
    return true;
  }
  return sameSecret(readCookie(req, "open_chat_access"), access.sessionToken);
}

function readCookie(req: Request, name: string): string {
  const prefix = `${name}=`;
  for (const part of (req.header("cookie") || "").split(";")) {
    const value = part.trim();
    if (value.startsWith(prefix)) return value.slice(prefix.length);
  }
  return "";
}

function sameSecret(value: string, expected: string): boolean {
  const actualBuffer = Buffer.from(value);
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

function buildWebAccessCookie(token: string): string {
  return `open_chat_access=${token}; Path=/; HttpOnly; SameSite=Strict`;
}

function isLoopbackRequest(req: Request): boolean {
  const address = req.socket.remoteAddress || "";
  return address === "::1" || address === "127.0.0.1" || address.startsWith("::ffff:127.");
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

function parseProjectPath(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw GatewayError.invalidRequest("projectPath 必须是字符串");
  const projectPath = value.trim();
  if (!projectPath) return undefined;
  if (!isAbsolute(projectPath)) {
    throw GatewayError.invalidRequest("projectPath 必须是绝对路径");
  }
  try {
    if (!statSync(projectPath).isDirectory()) {
      throw new Error("不是目录");
    }
  } catch {
    throw GatewayError.invalidRequest(`项目目录不存在或不可访问：${projectPath}`);
  }
  return projectPath;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** 解析请求体携带的权限模式；缺省/非法值回落到 supervised（人工审批）。 */
function parsePermissionMode(value: unknown): AcpPermissionMode {
  return value === "full" || value === "auto" ? value : "supervised";
}

// ============ 附件 → 发送分派 ============

/** 从 OpenAI 格式消息里收集最后一条 user 消息携带的附件引用。 */
function extractAttachments(messages: unknown[]): Array<{ reference: string; name: string }> {
  const user = [...messages].reverse().find((message) => {
    const role = (message as { role?: unknown } | null)?.role;
    return role === "user";
  });
  if (!user || typeof user !== "object" || user === null) return [];
  const list = (user as { attachments?: unknown }).attachments;
  if (!Array.isArray(list)) return [];
  return list.flatMap((item) => {
    if (typeof item !== "object" || item === null) return [];
    const reference = (item as { reference?: unknown }).reference;
    const name = (item as { name?: unknown }).name;
    if (typeof reference !== "string" || !reference.startsWith(ATTACHMENT_SCHEME)) return [];
    if (typeof name !== "string" || !name.trim()) return [];
    return [{ reference, name: name.trim() }];
  });
}

/** 把附件解析成网关侧绝对路径的 `@路径` mention，供同机 agent 直接读文件。 */
function attachmentMentions(messages: unknown[], store: AttachmentStore): string[] {
  return extractAttachments(messages).flatMap(({ reference, name }) => {
    const directory = store.pathFor(reference);
    if (!directory) return [];
    const file = join(directory, name);
    return existsSync(file) ? [`@${file}`] : [];
  });
}

/** 透传上游前，把消息里的附件引用注入为 OpenAI 多模态 image_url（data URL）。 */
function injectAttachmentsForUpstream(messages: unknown[], store: AttachmentStore): void {
  for (const message of messages) {
    if (typeof message !== "object" || message === null) continue;
    const record = message as { content?: unknown; attachments?: unknown };
    if (!Array.isArray(record.attachments)) continue;
    const attachments = extractAttachments([record]);
    delete record.attachments;
    if (attachments.length === 0) continue;

    const parts: unknown[] = [];
    const text = extractTextFromMessage(record);
    if (text.trim()) parts.push({ type: "text", text });
    for (const { reference, name } of attachments) {
      try {
        const bytes = store.read(reference, name);
        parts.push({
          type: "image_url",
          image_url: {
            url: `data:${attachmentContentType(name)};base64,${bytes.toString("base64")}`,
          },
        });
      } catch {
        // 附件缺失时跳过，保留文本继续发送
      }
    }
    if (parts.length > 0) record.content = parts;
  }
}

/** Sender 斜杠指令（/goal 等）注入：把独立字段转为最高优先级 system 消息。 */
function injectGoalMessages(body: Record<string, unknown>): void {
  const rawGoal = typeof body.goal === "string" ? body.goal.trim() : "";
  const rawInstruction = typeof body.instruction === "string" ? body.instruction.trim() : "";
  const block = [rawGoal, rawInstruction].filter(Boolean).join("\n\n");
  if (!block) return;
  const messages = body.messages;
  if (!Array.isArray(messages)) return;
  // 已通过前端 transformParams 注入过则不再重复
  const alreadyHasGoal = messages.some((item) => {
    if (typeof item !== "object" || item === null) return false;
    if (!("content" in item)) return false;
    const content = (item as { content: unknown }).content;
    return typeof content === "string" && content.includes("[GOAL]");
  });
  if (alreadyHasGoal) return;
  messages.unshift({ role: "system", content: `[GOAL]\n${block}` });
}

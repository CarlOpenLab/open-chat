/**
 * Open Chat 网关应用（可编程入口 / 组合根）。
 *
 * `loadGatewayRuntime` 打开 SQLite 并构建各管理器；`createGatewayApp` 只负责
 * 中间件与路由挂载（业务在 routes/*、存储在 store/*）；`startGateway` 监听端口并
 * 返回优雅停止句柄。独立入口（src/index.ts）与 CLI（tools/open-chat）都基于它们。
 */
import { existsSync, mkdirSync } from "node:fs";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { join } from "node:path";
import cors from "cors";
import express from "express";
import type { Express, NextFunction, Request, Response } from "express";
import {
  createAccessRouter,
  createWebAccessControl,
  requireApiAccess,
  type WebAccessControl,
} from "./access";
import { AgentManager } from "./agentManager";
import { attachmentStore, dataRootDir, defaultWorkspaceDir } from "./attachments";
import { resolveExecutable } from "./commandEnv";
import { defaultAppConfig, type AppConfig, type LocalConfig } from "./config";
import { GatewayError } from "./error";
import { jsonErrorHandler } from "./http";
import { LocalChatManager } from "./localProvider";
import { createAgentRouter } from "./routes/agents";
import { createAttachmentRouter } from "./routes/attachments";
import { createChatRouter, createModelsRouter } from "./routes/chat";
import { createConversationRouter } from "./routes/conversations";
import { createProjectPathRouter, createSkillsRouter } from "./routes/projects";
import { createProviderRouter } from "./routes/providers";
import { createTaskRouter } from "./routes/tasks";
import { createPreferenceRouter, createWorkspaceRouter } from "./routes/workspace";
import { createSearchProvider, type SearchProvider } from "./search";
import { importLegacyStateDirectory } from "./store/legacyImport";
import { WorkspaceStore } from "./store/workspace";

/** 网关运行时：配置、数据存储与由配置构建的各管理器。 */
export interface GatewayRuntime {
  config: AppConfig;
  store: WorkspaceStore;
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
  /** 停止本地 agent / opencode 会话、关闭数据库并关闭 HTTP 服务。 */
  stop(): Promise<void>;
}

/**
 * @description 构建内置默认运行时：打开工作区数据库（首次启动时导入旧版 JSON 状态），自动发现本机 CLI。
 * @param {WorkspaceStore} store - 可选的存储实例（测试注入内存库）；缺省打开数据根目录下的 open-chat.db
 * @returns {GatewayRuntime} 网关运行时
 */
export function loadGatewayRuntime(store?: WorkspaceStore): GatewayRuntime {
  const config = defaultAppConfig();
  const workspaceStore = store ?? openWorkspaceStore();
  const searchProvider = createSearchProvider(config.search);
  const localChat = createLocalChatManager(config);
  const agentManager = new AgentManager(config.acp, localChat);
  return { config, store: workspaceStore, searchProvider, localChat, agentManager };
}

/**
 * @description 打开默认数据库，并把旧版网关的 `state/*.json` 合并进来（一次性，之后目录改名备份）。
 * @returns {WorkspaceStore} 工作区存储
 */
function openWorkspaceStore(): WorkspaceStore {
  const store = WorkspaceStore.open();
  const imported = importLegacyStateDirectory(store, join(dataRootDir(), "state"));
  if (imported) console.log("[store] 已从旧版 JSON 状态导入：", imported);
  return store;
}

/**
 * @description 构建网关 Express 应用（不监听端口）；`staticDir` 非空时在同一端口托管 Web UI。
 * @param {GatewayRuntime} runtime - 网关运行时
 * @param {string} staticDir - 可选的静态站点目录
 * @param {WebAccessControl} access - 可选的 Web 访问控制（不传时只按 API Key 鉴权）
 * @returns {Express} Express 应用
 */
export function createGatewayApp(
  runtime: GatewayRuntime,
  staticDir?: string,
  access?: WebAccessControl,
): Express {
  const { config, store, searchProvider, localChat, agentManager } = runtime;
  // 无项目目录时的默认 agent 工作目录：~/.cc-hearts-open-code/workspace
  mkdirSync(defaultWorkspaceDir(), { recursive: true });
  const app = express();
  app.disable("x-powered-by");
  app.use(cors(buildCorsOptions(config.corsAllowedOrigins)));
  // 附件上传走 base64 JSON，放大后可达 40MB 左右，放宽 body 上限
  app.use(express.json({ limit: "44mb" }));

  // 访问控制路由始终公开，供前端探测登录状态；其余 /api 一律鉴权
  app.use("/api/access", createAccessRouter(access, config.gatewayApiKey));
  app.use("/api", requireApiAccess(access, config.gatewayApiKey));

  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // 工作区数据（SQLite）
  const taskRouter = createTaskRouter(store);
  app.use("/api/tasks", taskRouter);
  // 看板 AI 助手的系统指令使用该路径（已持久化的助手会话上下文里也是它）
  app.use("/api/board/tasks", taskRouter);
  app.use("/api/conversations", createConversationRouter(store));
  app.use("/api/providers", createProviderRouter(store));
  app.use("/api/preferences", createPreferenceRouter(store));
  app.use("/api/workspace", createWorkspaceRouter(store));

  // 本机能力与会话
  app.use("/api/project-path", createProjectPathRouter(store));
  app.use("/api/skills", createSkillsRouter());
  app.use("/api/attachments", createAttachmentRouter(attachmentStore));
  app.use("/api/acp", createAgentRouter(agentManager));
  const chatDeps = {
    config,
    store,
    attachments: attachmentStore,
    agentManager,
    localChat,
    searchProvider,
  };
  app.use("/api/models", createModelsRouter(chatDeps));
  app.use("/api/chat", createChatRouter(chatDeps));

  // 未匹配的 API 路由：JSON 404（避免被 SPA fallback 吞掉）
  app.use("/api", (_req: Request, res: Response) => {
    res.status(404).json(GatewayError.notFound("Not found").toResponse());
  });
  app.use(jsonErrorHandler);

  if (staticDir) {
    app.use(express.static(staticDir, { index: "index.html" }));
    // SPA fallback：非 API 的 GET/HEAD 全部回 index.html（支持 /chat/... 深链接）
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
 * @description 加载配置并启动网关。监听成功后返回句柄（含 URL 与优雅停止方法）。
 * 配置 / 端口错误以异常形式抛出，由调用方决定如何提示。
 * @param {GatewayStartOptions} options - 启动选项
 * @returns {Promise<GatewayHandle>} 网关句柄
 */
export async function startGateway(options: GatewayStartOptions): Promise<GatewayHandle> {
  const runtime = loadGatewayRuntime();
  // 任何模式都生成一次性访问密码：前端优先读 URL 里的 ?token= 自动登录，手动输入框作回退
  const access = createWebAccessControl();
  const app = createGatewayApp(runtime, options.staticDir, access);

  const host = options.host ?? "0.0.0.0";
  const port = options.port ?? 8082;

  const server = createServer(app);
  try {
    await new Promise<void>((resolve, reject) => {
      const onError = (err: NodeJS.ErrnoException): void => {
        if (err.code === "EADDRINUSE") {
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
  } catch (error) {
    runtime.store.close();
    throw error;
  }

  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  const displayHost = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
  const url = `http://${displayHost}:${actualPort}/`;

  console.log(`Server running at http://${host}:${actualPort}`);
  console.log(`Config:      built-in defaults（无配置文件，自动发现本机 CLI）`);
  console.log(`Database:    ${runtime.store.databasePath}`);
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
      // SSE / keep-alive 连接会阻塞 close 完成，主动断开
      server.closeAllConnections();
    });
    runtime.store.close();
  };

  return { server, url, host: displayHost, port: actualPort, password: access.password, stop };
}

/**
 * @description 构建本地 opencode 管理器：显式启用本地 AI，或 opencode agent 可用时自动启用。
 * @param {AppConfig} config - 网关配置
 * @returns {LocalChatManager | null} 管理器；不可用时为 null
 */
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

/**
 * @description 构建 CORS 选项（dev 下经 Vite 代理同源访问，CORS 只影响跨源 API 客户端）。
 * @param {string[]} origins - 允许的来源；包含 "*" 时放开全部
 * @returns {cors.CorsOptions} CORS 选项
 */
function buildCorsOptions(origins: string[]): cors.CorsOptions {
  const hasWildcard = origins.some((origin) => origin.trim() === "*");
  return {
    origin: hasWildcard ? "*" : origins.length > 0 ? origins : false,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type"],
  };
}

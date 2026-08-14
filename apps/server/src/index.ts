import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import type { NextFunction, Request, Response } from "express";
import { loadConfigFile, parseBindAddr, type AppConfig } from "./config";
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

const DEFAULT_CONFIG_PATH = "config/providers.toml";

function resolveConfigPath(): string {
  return process.env.CONFIG_PATH ?? process.argv[2] ?? DEFAULT_CONFIG_PATH;
}

function main(): void {
  const configPath = resolveConfigPath();

  let config: AppConfig;
  let searchProvider: SearchProvider | null;
  try {
    config = loadConfigFile(configPath);
    searchProvider = createSearchProvider(config.search);
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

  // 服务商数据在客户端本地，这里只暴露服务端的搜索能力。
  app.get("/api/models", (_req: Request, res: Response) => {
    res.json({
      search: { enabled: !!searchProvider, provider: searchProvider?.name ?? "" },
    });
  });

  // ============ 聊天：无状态代理转发 + 可选 websearch ============

  app.post("/api/chat/completions", async (req: Request, res: Response) => {
    try {
      const body = req.body as ChatCompletionRequest;
      if (!body || !Array.isArray(body.messages) || body.messages.length === 0) {
        throw GatewayError.invalidRequest("messages array is required");
      }

      // 转发目标由客户端在请求体携带；解析后从 body 剔除，避免上游报未知字段。
      const endpoint = parseRequestProvider(body);
      delete body.provider;

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
  });

  process.on("SIGTERM", () => {
    server.close(() => {
      console.log("Server closed");
      process.exit(0);
    });
  });
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

main();

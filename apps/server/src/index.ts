import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import type { NextFunction, Request, Response } from "express";
import {
  loadConfigFile,
  parseBindAddr,
  type AppConfig,
  type ModelConfig,
  type ProviderConfig,
} from "./config";
import { GatewayError } from "./error";
import type { ChatCompletionRequest } from "./provider";
import { ProviderRegistry } from "./registry";
import { ProviderStore, type StoredProviderInput } from "./provider-store";
import { createSearchProvider, type SearchProvider } from "./search";
import { runSearchAgentLoop } from "./search-agent";

const DEFAULT_CONFIG_PATH = "config/providers.toml";
const DEFAULT_STORE_PATH = "config/providers.json";

function resolveConfigPath(): string {
  return process.env.CONFIG_PATH ?? process.argv[2] ?? DEFAULT_CONFIG_PATH;
}

function resolveStorePath(): string {
  return process.env.PROVIDER_STORE_PATH ?? DEFAULT_STORE_PATH;
}

function main(): void {
  const configPath = resolveConfigPath();
  const storePath = resolveStorePath();

  let config: AppConfig;
  let registry: ProviderRegistry;
  let searchProvider: SearchProvider | null;
  let providerStore: ProviderStore;
  try {
    config = loadConfigFile(configPath);
    providerStore = new ProviderStore(storePath);
    registry = buildRegistry(config, providerStore);
    searchProvider = createSearchProvider(config.search);
  } catch (err) {
    if (err instanceof GatewayError) {
      console.error(`Failed to load config from ${configPath}: ${err.message}`);
    } else {
      console.error(`Failed to load config from ${configPath}:`, err);
    }
    process.exit(1);
  }

  /** Rebuilds the model→provider routing table from TOML + stored providers. */
  const refreshRegistry = (): void => {
    registry = buildRegistry(config, providerStore);
  };

  /** Merges TOML providers with user-added stored providers. */
  const allProviderConfigs = (): ProviderConfig[] => [
    ...config.providers,
    ...providerStore.resolveForGateway(),
  ];

  /** Model ids must stay unique across TOML providers and the provider store. */
  const assertUniqueModels = (input: StoredProviderInput, skipId?: string): void => {
    const seen = new Set<string>();
    for (const provider of config.providers) {
      for (const model of provider.models) seen.add(model.id);
    }
    for (const provider of providerStore.list()) {
      if (skipId && provider.id === skipId) continue;
      for (const model of provider.models) seen.add(model.id);
    }
    for (const model of input.models ?? []) {
      if (seen.has(model.id)) {
        throw GatewayError.invalidRequest(`Model is configured more than once: ${model.id}`);
      }
      seen.add(model.id);
    }
  };

  const app = express();
  app.use(cors(buildCorsOptions(config.corsAllowedOrigins)));
  app.use(express.json());

  if (config.gatewayApiKey) {
    app.use(gatewayAuthMiddleware(config.gatewayApiKey));
  }

  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  app.get("/api/models", (_req: Request, res: Response) => {
    res.json(buildModelsResponse(allProviderConfigs(), config.defaultModel, searchProvider));
  });

  // ============ 服务商管理（存储到服务端，密钥加密落盘） ============

  app.get("/api/providers", (_req: Request, res: Response) => {
    res.json({ providers: providerStore.list() });
  });

  app.post("/api/providers", (req: Request, res: Response) => {
    try {
      const input = req.body as StoredProviderInput;
      assertUniqueModels(input);
      const provider = providerStore.create(input);
      refreshRegistry();
      res.status(201).json({ provider });
    } catch (err) {
      sendKnownError(res, err, "Failed to create provider");
    }
  });

  app.put("/api/providers/:id", (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      const input = req.body as StoredProviderInput;
      assertUniqueModels(input, id);
      const provider = providerStore.update(id, input);
      refreshRegistry();
      res.json({ provider });
    } catch (err) {
      sendKnownError(res, err, "Failed to update provider");
    }
  });

  app.delete("/api/providers/:id", (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      const removed = providerStore.remove(id);
      if (!removed) {
        throw GatewayError.invalidRequest(`Provider not found: ${id}`);
      }
      refreshRegistry();
      res.status(204).end();
    } catch (err) {
      sendKnownError(res, err, "Failed to delete provider");
    }
  });

  app.post("/api/chat/completions", async (req: Request, res: Response) => {
    try {
      const body = req.body as ChatCompletionRequest;
      if (!body || !Array.isArray(body.messages)) {
        throw GatewayError.invalidRequest("messages array is required");
      }
      if (body.messages.length === 0) {
        throw GatewayError.invalidRequest("messages must not be empty");
      }

      const route = registry.resolveModel(body.model);
      const stream = body.stream === true;

      // The client declares a `web_search` tool in `tools` when it wants the
      // model to be able to search. Detect it and route through the agent loop
      // that intercepts the tool call and executes the search provider.
      const canSearch =
        stream && route.provider.api === "chat/completions" && hasWebSearchTool(body.tools);

      if (canSearch && searchProvider) {
        await runSearchAgentLoop(req, res, route, body, searchProvider);
      } else {
        // No search backend: strip the tool so the model doesn't attempt to
        // call a function nobody will execute.
        if (canSearch) stripWebSearchTool(body);
        if (stream) {
          const upstream = await route.provider.chatStream(body, route.model);
          await pipeSseStream(req, res, upstream);
        } else {
          const data = await route.provider.chat(body, route.model);
          res.json(data);
        }
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
    console.log(`Providers:   ${config.providers.map((p) => `${p.name} (${p.api})`).join(", ")}`);
    console.log(`Provider store: ${storePath} (${providerStore.size} user-added)`);
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

function buildRegistry(config: AppConfig, providerStore: ProviderStore): ProviderRegistry {
  const merged: AppConfig = {
    ...config,
    providers: [...config.providers, ...providerStore.resolveForGateway()],
  };
  return ProviderRegistry.fromConfig(merged);
}

function buildModelsResponse(
  providers: ProviderConfig[],
  defaultModel: string,
  searchProvider: SearchProvider | null,
): {
  defaultModel: string;
  search: { enabled: boolean; provider: string };
  providers: {
    name: string;
    models: ModelConfig[];
  }[];
} {
  return {
    defaultModel,
    search: { enabled: !!searchProvider, provider: searchProvider?.name ?? "" },
    providers: providers.map((provider: ProviderConfig) => ({
      name: provider.name,
      models: provider.models,
    })),
  };
}

async function pipeSseStream(
  req: Request,
  res: Response,
  upstream: ReadableStream<Uint8Array>,
): Promise<void> {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const reader = upstream.getReader();
  const decoder = new TextDecoder();
  let sawDone = false;
  let clientClosed = false;

  const onClose = () => {
    clientClosed = true;
    reader.cancel().catch(() => {});
  };
  req.on("close", onClose);

  try {
    while (!clientClosed) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      const text = decoder.decode(value, { stream: true });
      if (text.includes("data: [DONE]")) sawDone = true;
      res.write(Buffer.from(value));
    }
  } catch (err) {
    console.error("Stream read error:", err);
  } finally {
    req.off("close", onClose);
    try {
      reader.releaseLock();
    } catch {
      // reader already released/cancelled
    }
    if (!clientClosed && !sawDone) {
      res.write("data: [DONE]\n\n");
    }
    res.end();
  }
}

function sendGatewayError(res: Response, err: GatewayError): void {
  res.status(err.status).json(err.toResponse());
}

/** Uniform error handling for the provider-management endpoints. */
function sendKnownError(res: Response, err: unknown, fallback: string): void {
  if (err instanceof GatewayError) {
    return sendGatewayError(res, err);
  }
  console.error(`${fallback}:`, err);
  return sendGatewayError(res, GatewayError.invalidRequest(fallback));
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

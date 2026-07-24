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

const DEFAULT_CONFIG_PATH = "config/providers.toml";

function resolveConfigPath(): string {
  return process.env.CONFIG_PATH ?? process.argv[2] ?? DEFAULT_CONFIG_PATH;
}

function main(): void {
  const configPath = resolveConfigPath();

  let config: AppConfig;
  let registry: ProviderRegistry;
  try {
    config = loadConfigFile(configPath);
    registry = ProviderRegistry.fromConfig(config);
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

  app.get("/api/models", (_req: Request, res: Response) => {
    res.json(buildModelsResponse(config));
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

      if (stream) {
        const upstream = await route.provider.chatStream(body, route.model);
        await pipeSseStream(req, res, upstream);
      } else {
        const data = await route.provider.chat(body, route.model);
        res.json(data);
      }
    } catch (err) {
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

function buildModelsResponse(config: AppConfig): {
  defaultModel: string;
  providers: {
    name: string;
    models: ModelConfig[];
  }[];
} {
  return {
    defaultModel: config.defaultModel,
    providers: config.providers.map((provider: ProviderConfig) => ({
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

main();

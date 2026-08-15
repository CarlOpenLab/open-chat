/**
 * 纯代理转发：把客户端的请求原样转发给上游，并把上游响应（状态码、
 * 请求头、body）原样回传。不做格式转换、不做模型路由、不拦截工具调用。
 *
 * 服务商信息由客户端在请求体 `provider` 字段携带（baseUrl / apiKey / api），
 * 服务端无状态：不存储、不落盘、不打日志。
 */
import type { Request as ExpressRequest, Response as ExpressResponse } from "express";
import { GatewayError } from "./error";

export type ProviderApi = "chat/completions" | "responses";

export interface ChatCompletionRequest {
  model?: string;
  messages: unknown[];
  stream?: boolean;
  [key: string]: unknown;
}

export interface ProviderEndpoint {
  baseUrl: string;
  apiKey: string;
  /** 决定上游 URL 路径后缀：`chat/completions` 或 `responses`。 */
  api: ProviderApi;
}

function upstreamUrl(endpoint: ProviderEndpoint): string {
  return `${endpoint.baseUrl.replace(/\/+$/, "")}/${endpoint.api}`;
}

/**
 * 从请求体解析并校验转发目标。客户端每次请求都携带
 * `provider: { baseUrl, apiKey, api }`。
 */
export function parseRequestProvider(body: ChatCompletionRequest): ProviderEndpoint {
  const raw = body.provider;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw GatewayError.invalidRequest("provider { baseUrl, apiKey, api } is required");
  }
  const p = raw as Record<string, unknown>;
  const baseUrl = typeof p.baseUrl === "string" ? p.baseUrl.trim() : "";
  const apiKey = typeof p.apiKey === "string" ? p.apiKey.trim() : "";
  const api: ProviderApi = p.api === "responses" ? "responses" : "chat/completions";
  if (!/^https?:\/\//.test(baseUrl)) {
    throw GatewayError.invalidRequest("provider.baseUrl must be an http(s) URL");
  }
  if (!apiKey) {
    throw GatewayError.invalidRequest("provider.apiKey is required");
  }
  return { baseUrl, apiKey, api };
}

/** 把客户端 body 原样 POST 给上游，返回未读取的 fetch Response。 */
export async function forwardChatRequest(
  endpoint: ProviderEndpoint,
  body: ChatCompletionRequest,
): Promise<Response> {
  return fetch(upstreamUrl(endpoint), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${endpoint.apiKey}`,
      ...(body.stream === true ? { Accept: "text/event-stream" } : {}),
    },
    body: JSON.stringify(body),
  });
}

/**
 * 把上游响应（状态码、头、body）原样管道回客户端。
 * - 上游 4xx/5xx 也原样回传，客户端直接看到上游的真实错误。
 * - 客户端中途断开时取消上游读取。
 */
export async function pipeUpstream(
  req: ExpressRequest,
  res: ExpressResponse,
  upstream: Response,
): Promise<void> {
  res.status(upstream.status);
  upstream.headers.forEach((value, key) => {
    if (isForwardableHeader(key)) res.setHeader(key, value);
  });

  if (!upstream.body) {
    res.end();
    return;
  }

  const reader = upstream.body.getReader();
  let clientClosed = false;
  const onClose = (): void => {
    clientClosed = true;
    reader.cancel().catch(() => {});
  };
  // 监听 res 的 close（客户端真正断开时触发；express.json 已消费完请求体，
  // req 的 close 会在 handler 刚开始时就触发，不能作为断开信号）。
  res.on("close", onClose);

  try {
    while (!clientClosed) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      try {
        res.write(Buffer.from(value));
      } catch {
        clientClosed = true;
      }
    }
  } catch (err) {
    console.error("Upstream stream read error:", err);
  } finally {
    res.off("close", onClose);
    if (!clientClosed) {
      try {
        res.end();
      } catch {
        // response already ended
      }
    }
  }
}

/** 不转发的逐跳头 / 由 Node 自行处理的头。 */
const SKIPPED_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "content-length",
  "content-encoding",
]);

function isForwardableHeader(key: string): boolean {
  const lower = key.toLowerCase();
  return !SKIPPED_HEADERS.has(lower) && !lower.startsWith("x-accel-");
}

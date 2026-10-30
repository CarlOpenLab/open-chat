/**
 * 网关请求层：所有 `/api` 调用的唯一出口。
 *
 * - 统一附加可选的网关 API Key（Bearer），浏览器会话则依赖 HttpOnly cookie；
 * - 未登录时直接拒绝发起请求，收到 401 时广播「需要重新输入密码」；
 * - 非 2xx 响应解析网关的 `{ error: { message } }` 并抛出 ApiError。
 */
import { handleGatewayUnauthorized, requireGatewayAccess } from "./access";

/**
 * 网关地址：默认相对路径，开发时经 Vite 代理（`/api` → http://localhost:8082）避免 CORS；
 * 设置 `VITE_API_URL` 可直连网关。
 */
export const API_BASE_URL = (import.meta.env.VITE_API_URL || "").replace(/\/+$/, "");

/** 可选的网关 Bearer Token（仅网关启用 API Key 鉴权时需要）。 */
export const GATEWAY_API_KEY = import.meta.env.VITE_GATEWAY_API_KEY || "";

/** 网关返回的业务错误：携带 HTTP 状态码，供调用方区分 404 / 409 等情形。 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * @description 生成鉴权请求头（仅在配置了网关 API Key 时附加）。
 * @returns {Record<string, string>} 可展开进 fetch headers 的对象
 */
export function authHeaders(): Record<string, string> {
  return GATEWAY_API_KEY ? { Authorization: `Bearer ${GATEWAY_API_KEY}` } : {};
}

/**
 * @description 拼接网关完整地址。
 * @param {string} path - 以 `/api` 开头的路径
 * @returns {string} 完整 URL
 */
export function apiUrl(path: string): string {
  return `${API_BASE_URL}${path}`;
}

/**
 * @description 发起网关请求（原始 Response，供 SSE / 二进制等场景使用）：自动附加鉴权头并处理 401。
 * @param {string} path - 以 `/api` 开头的路径
 * @param {RequestInit} init - fetch 参数
 * @returns {Promise<Response>} 原始响应（不检查状态码）
 * @throws {Error} 尚未通过访问密码验证时抛出
 */
export async function gatewayFetch(path: string, init: RequestInit = {}): Promise<Response> {
  requireGatewayAccess();
  const headers = new Headers(init.headers);
  for (const [name, value] of Object.entries(authHeaders())) headers.set(name, value);
  const response = await fetch(apiUrl(path), { ...init, headers });
  handleGatewayUnauthorized(response);
  return response;
}

/**
 * @description 读取网关错误体中的提示信息。
 * @param {Response} response - 非 2xx 响应
 * @param {string} fallback - 无法解析时的提示
 * @returns {Promise<string>} 错误提示
 */
export async function readErrorMessage(response: Response, fallback: string): Promise<string> {
  const data = (await response.json().catch(() => null)) as {
    error?: { message?: unknown };
  } | null;
  const message = data?.error?.message;
  return typeof message === "string" && message.trim()
    ? message
    : `${fallback}（HTTP ${response.status}）`;
}

export interface ApiRequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** JSON 请求体（自动序列化并设置 Content-Type）。 */
  json?: unknown;
  signal?: AbortSignal;
  /** 网关未返回错误信息时使用的提示。 */
  errorMessage?: string;
}

/**
 * @description 发起 JSON 请求并解析 JSON 响应。
 * @param {string} path - 以 `/api` 开头的路径
 * @param {ApiRequestOptions} options - 方法、请求体、取消信号与错误提示
 * @returns {Promise<T>} 解析后的响应体
 * @throws {ApiError} 网关返回非 2xx 时抛出，message 为网关给出的错误信息
 */
export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const { method = "GET", json, signal, errorMessage = "请求失败" } = options;
  const response = await gatewayFetch(path, {
    method,
    signal,
    ...(json !== undefined
      ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(json) }
      : {}),
  });
  if (!response.ok) {
    throw new ApiError(await readErrorMessage(response, errorMessage), response.status);
  }
  return (await response.json()) as T;
}

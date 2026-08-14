/**
 * 网关设置解析（TOML）。
 *
 * 服务商数据由客户端本地存储（浏览器 IndexedDB），服务端**无状态**：
 * 每次聊天请求由客户端在 body 里携带 `provider: { baseUrl, apiKey, api }`，
 * 服务端据此转发，不落盘、不存储任何密钥。这里只保留网关自身行为
 * 与联网搜索（Tavily）配置。
 */
import { readFileSync } from "node:fs";
import { parse, TomlError } from "smol-toml";
import { GatewayError } from "./error";

export interface AppConfig {
  /** 空字符串表示关闭鉴权。 */
  gatewayApiKey: string;
  bindAddr: string;
  corsAllowedOrigins: string[];
  search: SearchConfig;
}

export interface SearchConfig {
  /** 空或 "disabled" 表示关闭联网搜索。目前支持 "tavily"。 */
  provider: string;
  apiKey: string;
  maxResults: number;
  searchDepth: "basic" | "advanced";
  includeAnswer: boolean;
}

interface RawGatewayConfig {
  gateway_api_key?: unknown;
  bind_addr?: unknown;
  cors_allowed_origins?: unknown;
  search?: unknown;
}

interface RawSearchConfig {
  provider?: unknown;
  api_key?: unknown;
  max_results?: unknown;
  search_depth?: unknown;
  include_answer?: unknown;
}

const DEFAULT_BIND_ADDR = "127.0.0.1:8082";

export function loadConfigFile(path: string): AppConfig {
  let tomlStr: string;
  try {
    tomlStr = readFileSync(path, "utf8");
  } catch (err) {
    throw GatewayError.invalidRequest(
      `Failed to read config file ${path}: ${(err as Error).message}`,
    );
  }
  return parseConfig(tomlStr);
}

export function parseConfig(tomlStr: string): AppConfig {
  let raw: RawGatewayConfig;
  try {
    raw = parse(tomlStr) as RawGatewayConfig;
  } catch (err) {
    if (err instanceof TomlError) {
      throw GatewayError.invalidRequest(`Invalid gateway config TOML: ${err.message}`);
    }
    throw err;
  }

  return {
    gatewayApiKey: optionalString(raw.gateway_api_key) ?? "",
    bindAddr: optionalString(raw.bind_addr) ?? DEFAULT_BIND_ADDR,
    corsAllowedOrigins: parseStringArray(raw.cors_allowed_origins, "cors_allowed_origins"),
    search: parseSearch(raw.search),
  };
}

export function parseBindAddr(addr: string): { host: string; port: number } {
  const match = addr.match(/^(\d{1,3}(?:\.\d{1,3}){3}):(\d+)$/);
  if (!match) {
    throw GatewayError.invalidRequest(`Invalid bind_addr (expected host:port): ${addr}`);
  }
  const port = Number(match[2]);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw GatewayError.invalidRequest(`Invalid bind_addr port: ${addr}`);
  }
  return { host: match[1], port };
}

function parseSearch(raw: unknown): SearchConfig {
  if (raw === undefined || raw === null) {
    return { provider: "", apiKey: "", maxResults: 5, searchDepth: "basic", includeAnswer: true };
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw GatewayError.invalidRequest("[search] must be a table");
  }
  const s = raw as RawSearchConfig;
  const provider = optionalString(s.provider) ?? "";
  const apiKey = optionalString(s.api_key) ?? "";
  const maxResults =
    typeof s.max_results === "number" && Number.isFinite(s.max_results) && s.max_results > 0
      ? Math.floor(s.max_results)
      : 5;
  const depthRaw = optionalString(s.search_depth);
  const searchDepth = depthRaw === "advanced" ? "advanced" : "basic";
  const includeAnswer = typeof s.include_answer === "boolean" ? s.include_answer : true;
  return { provider, apiKey, maxResults, searchDepth, includeAnswer };
}

/** Returns a trimmed non-empty string, or `undefined` when missing/blank. */
function optionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseStringArray(value: unknown, field: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw GatewayError.invalidRequest(`${field} must be an array of strings`);
  }
  return value
    .map((item, index) => {
      if (typeof item !== "string") {
        throw GatewayError.invalidRequest(`${field}[${index}] must be a string`);
      }
      return item.trim();
    })
    .filter((item) => item.length > 0);
}

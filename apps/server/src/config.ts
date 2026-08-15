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
  /** 本地 opencode（ACP 服务）配置；`enabled=false` 时服务端不启动本地 AI。 */
  local: LocalConfig;
  /** ACP stdio Agents（Codex / OpenCode / Claude / Pi 等）的统一入口。 */
  acp: AcpConfig;
}

export interface AcpAgentConfig {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  command: string;
  args: string[];
  /** 原始 CLI，用于区分“CLI 已安装”和“ACP 适配器可用”。 */
  cliCommand: string;
  cwd: string;
  adapterHint: string;
  transport: AgentTransport;
}

export type AgentTransport = "acp" | "codex" | "claude" | "pi" | "opencode";

export interface AcpConfig {
  enabled: boolean;
  cwd: string;
  permissionTimeoutMs: number;
  agents: AcpAgentConfig[];
}

/**
 * 本地 AI（opencode serve）配置。
 *
 * 服务端驱动本地 `opencode serve`（HTTP + SSE），
 * 模型与供应商从本地发现（`GET /api/model` 返回 `providerID/modelID`），
 * 聊天请求转发到本地 opencode，不再依赖客户端上传 baseUrl/apiKey。
 */
export interface LocalConfig {
  enabled: boolean;
  /** opencode 可执行文件；空字符串自动从 PATH 查找。 */
  binary: string;
  /** opencode serve 的工作目录；空字符串用服务端启动目录。 */
  cwd: string;
  /** 使用的 agent：`build` 或 `plan`。 */
  agent: string;
  /** 前端会话 → opencode session 的缓存上限。 */
  maxSessions: number;
  /** 会话空闲回收时间（毫秒）。 */
  sessionIdleMs: number;
  /** 单次模型请求超时（毫秒）。 */
  requestTimeoutMs: number;
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
  local?: unknown;
  acp?: unknown;
}

interface RawAcpConfig {
  enabled?: unknown;
  cwd?: unknown;
  permission_timeout_ms?: unknown;
  agents?: unknown;
}

interface RawAcpAgentConfig {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  enabled?: unknown;
  command?: unknown;
  args?: unknown;
  cli_command?: unknown;
  cwd?: unknown;
  adapter_hint?: unknown;
  transport?: unknown;
}

interface RawLocalConfig {
  enabled?: unknown;
  binary?: unknown;
  cwd?: unknown;
  agent?: unknown;
  max_sessions?: unknown;
  session_idle_ms?: unknown;
  request_timeout_ms?: unknown;
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
    local: parseLocal(raw.local),
    acp: parseAcp(raw.acp),
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

const DEFAULT_LOCAL: LocalConfig = {
  enabled: false,
  binary: "",
  cwd: "",
  agent: "build",
  maxSessions: 50,
  sessionIdleMs: 30 * 60 * 1000,
  requestTimeoutMs: 5 * 60 * 1000,
};

const DEFAULT_ACP_AGENTS: AcpAgentConfig[] = [
  {
    id: "codex",
    name: "Codex",
    description: "OpenAI Codex CLI via native app-server",
    enabled: true,
    command: "codex",
    args: [],
    cliCommand: "codex",
    cwd: "",
    adapterHint: "请先安装并登录 Codex CLI",
    transport: "codex",
  },
  {
    id: "opencode",
    name: "OpenCode",
    description: "OpenCode CLI via its local HTTP server",
    enabled: true,
    command: "opencode",
    args: [],
    cliCommand: "opencode",
    cwd: "",
    adapterHint: "请先安装并登录 OpenCode CLI",
    transport: "opencode",
  },
  {
    id: "claude",
    name: "Claude Code",
    description: "Claude Code CLI via native stream-json",
    enabled: true,
    command: "claude",
    args: [],
    cliCommand: "claude",
    cwd: "",
    adapterHint: "请先安装并登录 Claude Code CLI",
    transport: "claude",
  },
  {
    id: "pi",
    name: "Pi",
    description: "Pi coding agent via native RPC mode",
    enabled: true,
    command: "pi",
    args: [],
    cliCommand: "pi",
    cwd: "",
    adapterHint: "请先安装并配置 Pi coding agent",
    transport: "pi",
  },
];

function parseAcp(raw: unknown): AcpConfig {
  if (raw === undefined || raw === null) {
    return {
      enabled: true,
      cwd: "",
      permissionTimeoutMs: 5 * 60 * 1000,
      agents: DEFAULT_ACP_AGENTS.map((agent) => ({ ...agent, args: [...agent.args] })),
    };
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw GatewayError.invalidRequest("[acp] must be a table");
  }
  const value = raw as RawAcpConfig;
  const configuredAgents = parseAcpAgents(value.agents);
  return {
    enabled: typeof value.enabled === "boolean" ? value.enabled : true,
    cwd: optionalString(value.cwd) ?? "",
    permissionTimeoutMs:
      typeof value.permission_timeout_ms === "number" &&
      Number.isFinite(value.permission_timeout_ms) &&
      value.permission_timeout_ms > 0
        ? Math.floor(value.permission_timeout_ms)
        : 5 * 60 * 1000,
    agents: configuredAgents.length > 0 ? configuredAgents : DEFAULT_ACP_AGENTS,
  };
}

function parseAcpAgents(raw: unknown): AcpAgentConfig[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw GatewayError.invalidRequest("acp.agents must be an array of tables");
  }
  const seen = new Set<string>();
  return raw.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw GatewayError.invalidRequest(`acp.agents[${index}] must be a table`);
    }
    const agent = item as RawAcpAgentConfig;
    const id = optionalString(agent.id)?.toLowerCase();
    const command = optionalString(agent.command);
    if (!id || !/^[a-z0-9][a-z0-9_-]*$/.test(id)) {
      throw GatewayError.invalidRequest(`acp.agents[${index}].id is invalid`);
    }
    if (seen.has(id)) throw GatewayError.invalidRequest(`duplicate ACP agent id: ${id}`);
    if (!command) {
      throw GatewayError.invalidRequest(`acp.agents[${index}].command is required`);
    }
    seen.add(id);
    return {
      id,
      name: optionalString(agent.name) ?? id,
      description: optionalString(agent.description) ?? "ACP coding agent",
      enabled: typeof agent.enabled === "boolean" ? agent.enabled : true,
      command,
      args: parseStringArray(agent.args, `acp.agents[${index}].args`),
      cliCommand: optionalString(agent.cli_command) ?? command,
      cwd: optionalString(agent.cwd) ?? "",
      adapterHint: optionalString(agent.adapter_hint) ?? "",
      transport: parseAgentTransport(agent.transport, id, command),
    };
  });
}

function parseAgentTransport(raw: unknown, id: string, command: string): AgentTransport {
  const value = optionalString(raw)?.toLowerCase();
  if (value === "acp" || value === "codex" || value === "claude" || value === "pi") {
    return value;
  }
  if (value === "opencode") return value;
  if (value) throw GatewayError.invalidRequest(`unsupported agent transport: ${value}`);

  // Existing custom configs predate `transport` and used adapter commands.
  // Infer native mode only when both the id and executable are unambiguous.
  if (id === "codex" && command === "codex") return "codex";
  if (id === "claude" && command === "claude") return "claude";
  if (id === "pi" && command === "pi") return "pi";
  if (id === "opencode" && command === "opencode") return "opencode";
  return "acp";
}

export function parseLocal(raw: unknown): LocalConfig {
  if (raw === undefined || raw === null) return { ...DEFAULT_LOCAL };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw GatewayError.invalidRequest("[local] must be a table");
  }
  const l = raw as RawLocalConfig;
  const agentRaw = optionalString(l.agent);
  return {
    enabled: typeof l.enabled === "boolean" ? l.enabled : DEFAULT_LOCAL.enabled,
    binary: optionalString(l.binary) ?? DEFAULT_LOCAL.binary,
    cwd: optionalString(l.cwd) ?? DEFAULT_LOCAL.cwd,
    agent: agentRaw === "plan" ? "plan" : "build",
    maxSessions:
      typeof l.max_sessions === "number" && Number.isFinite(l.max_sessions) && l.max_sessions > 0
        ? Math.floor(l.max_sessions)
        : DEFAULT_LOCAL.maxSessions,
    sessionIdleMs:
      typeof l.session_idle_ms === "number" &&
      Number.isFinite(l.session_idle_ms) &&
      l.session_idle_ms > 0
        ? Math.floor(l.session_idle_ms)
        : DEFAULT_LOCAL.sessionIdleMs,
    requestTimeoutMs:
      typeof l.request_timeout_ms === "number" &&
      Number.isFinite(l.request_timeout_ms) &&
      l.request_timeout_ms > 0
        ? Math.floor(l.request_timeout_ms)
        : DEFAULT_LOCAL.requestTimeoutMs,
  };
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

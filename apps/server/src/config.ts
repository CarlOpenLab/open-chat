/**
 * 网关内置配置（无配置文件）。
 *
 * Open Chat 是纯本地 CLI 工具：所有配置都是代码内置默认值，
 * 不读取任何配置文件。运行时仅可通过 CLI 参数（--port / --host）覆盖。
 * 默认自动发现本机已安装的 CLI agents：codex / claude / pi / opencode / omp。
 */

export interface AppConfig {
  /** 空字符串表示关闭鉴权。 */
  gatewayApiKey: string;
  bindAddr: string;
  corsAllowedOrigins: string[];
  search: SearchConfig;
  /** 本地 opencode（ACP 服务）配置；`enabled=false` 时服务端不启动本地 AI。 */
  local: LocalConfig;
  /** ACP stdio Agents（Codex / OpenCode / Claude / Pi / omp 等）的统一入口。 */
  acp: AcpConfig;
}

export interface AcpAgentConfig {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  command: string;
  args: string[];
  /** 原始 CLI，用于区分"CLI 已安装"和"ACP 适配器可用"。 */
  cliCommand: string;
  cwd: string;
  adapterHint: string;
  transport: AgentTransport;
}

export type AgentTransport = "acp" | "codex" | "claude" | "pi" | "omp" | "opencode";

export interface AcpConfig {
  enabled: boolean;
  cwd: string;
  permissionTimeoutMs: number;
  agents: AcpAgentConfig[];
}

/**
 * 本地 AI（opencode serve）配置。
 *
 * 服务端驱动本地 `opencode serve`（HTTP + SSE，与 opencode transport 相同），
 * 模型与供应商从本地发现。默认关闭。
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

export const DEFAULT_BIND_ADDR = "127.0.0.1:8082";

const DEFAULT_LOCAL: LocalConfig = {
  enabled: false,
  binary: "",
  cwd: "",
  agent: "build",
  maxSessions: 50,
  sessionIdleMs: 30 * 60 * 1000,
  requestTimeoutMs: 5 * 60 * 1000,
};

/**
 * 内置默认 agents：自动发现本机已安装的编码 CLI。
 *
 * - codex / claude / pi / opencode / omp 均走原生传输（无需 ACP 适配器）
 * - omp（Oh My Pi）是 Pi 的 fork，`--mode rpc` 协议兼容，但 CLI 参数
 *   （`--auto-approve` 而非 `--approve`）与会话存储目录（`~/.omp` 而非 `~/.pi`）
 *   不同，因此单独列为 `omp` transport，与 pi 区分开。
 * - 未安装的 CLI 会在界面里标记为"不可用"，不影响其他 agent
 */
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
  {
    id: "omp",
    name: "Oh My Pi",
    description: "Oh My Pi (omp) coding agent via native RPC mode",
    enabled: true,
    command: "omp",
    args: [],
    cliCommand: "omp",
    cwd: "",
    adapterHint: "请先安装 Oh My Pi (https://omp.sh)",
    transport: "omp",
  },
];

/** 内置默认配置（无配置文件，运行时唯一来源）。 */
export function defaultAppConfig(): AppConfig {
  return {
    gatewayApiKey: "",
    bindAddr: DEFAULT_BIND_ADDR,
    corsAllowedOrigins: [],
    search: {
      provider: "",
      apiKey: "",
      maxResults: 5,
      searchDepth: "basic",
      includeAnswer: true,
    },
    local: { ...DEFAULT_LOCAL },
    acp: {
      enabled: true,
      cwd: "",
      permissionTimeoutMs: 5 * 60 * 1000,
      agents: DEFAULT_ACP_AGENTS.map((agent) => ({ ...agent, args: [...agent.args] })),
    },
  };
}

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
 * 所有 stdio CLI（codex / claude / pi / omp / 自定义 ACP）统一经 acp-hub
 * 适配器走 Agent Client Protocol：内置 CLI 由各自的 ACP 桥接包启动
 * （首次运行经 npx 自动获取，需本机已安装并登录对应的 CLI）：
 * - codex   → npx -y acp-extension-codex（内部 spawn codex app-server）
 * - claude  → npx -y @zed-industries/claude-code-acp（需 Claude Code CLI）
 * - pi / omp → npx @mariozechner/pi --mode acp / oh-my-pi --mode acp
 * - opencode 保持原生本地 HTTP 服务（localProvider），不经 ACP。
 * `cliCommand` 仍指向原始 CLI，用于"CLI 已安装"检测；`command` 是 ACP 桥接启动命令。
 * 未安装的 CLI 会在界面里标记为"不可用"，不影响其他 agent。
 */
const DEFAULT_ACP_AGENTS: AcpAgentConfig[] = [
  {
    id: "codex",
    name: "Codex",
    description: "OpenAI Codex CLI via ACP (acp-extension-codex)",
    enabled: true,
    command: "npx",
    args: ["-y", "acp-extension-codex"],
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
    description: "Claude Code CLI via ACP (claude-code-acp)",
    enabled: true,
    command: "npx",
    args: ["-y", "@zed-industries/claude-code-acp"],
    cliCommand: "claude",
    cwd: "",
    adapterHint: "请先安装并登录 Claude Code CLI",
    transport: "claude",
  },
  {
    id: "pi",
    name: "Pi",
    description: "Pi coding agent via ACP (pi --mode acp)",
    enabled: true,
    command: "pi",
    args: ["--mode", "acp"],
    cliCommand: "pi",
    cwd: "",
    adapterHint: "需要本地安装支持 ACP 模式的 Pi CLI（pi --mode acp）",
    transport: "pi",
  },
  {
    id: "omp",
    name: "Oh My Pi",
    description: "Oh My Pi (omp) via ACP (omp acp)",
    enabled: true,
    command: "omp",
    args: ["acp"],
    cliCommand: "omp",
    cwd: "",
    adapterHint: "需要支持 ACP 的 Oh My Pi（omp acp，v18+）",
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

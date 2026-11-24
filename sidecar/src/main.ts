/**
 * open-chat sidecar: the only place that speaks ACP.
 *
 * The Go host spawns `node sidecar.mjs` and talks NDJSON over stdio:
 *
 *   → {"id":1,"method":"open","params":{...}}
 *   ← {"id":1,"result":{...}}            or {"id":1,"error":{"message":"…","code":"…"}}
 *   ← {"method":"events","params":{"key":"…","events":[…]}}   (notifications)
 *
 * Every agent is driven through @cc-heart/acp-hub: the adapter packages give
 * the launch presets, core gives the typed session and event stream. One
 * agent process is shared by every conversation opened with the same launch
 * spec; a conversation maps to one ACP session, keyed by the host's id.
 *
 * stdout carries protocol frames only — logs go to stderr.
 */
import { existsSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import {
  AcpAgentAdapter,
  AcpSession,
  AdapterError,
  type AgentCapabilities,
  type ContentBlock,
  type SessionEvent,
} from "@cc-heart/acp-hub-core";
import { CLAUDE_CODE_ACP_DEFAULT } from "@cc-heart/acp-hub-adapter-claude";
import { CODEX_ACP_DEFAULT } from "@cc-heart/acp-hub-adapter-codex";
import { OH_MY_PI_ACP_DEFAULT } from "@cc-heart/acp-hub-adapter-pi";
import { runDemoAgent } from "./demo-agent.js";

// ---------------------------------------------------------------- protocol

interface Request {
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

export interface AgentLaunch {
  id: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

/** What the host needs to know about an agent before launching it. */
export interface AgentPreset {
  id: string;
  name: string;
  description: string;
  command: string;
  args: string[];
  /** Executable whose presence on PATH means the agent can run. */
  probe: string;
  homepage: string;
  /** Hidden unless the host runs with demo agents enabled. */
  demo?: boolean;
}

function send(frame: unknown): void {
  process.stdout.write(`${JSON.stringify(frame)}\n`);
}

function notify(method: string, params: unknown): void {
  send({ method, params });
}

function log(level: string, message: string): void {
  process.stderr.write(`[sidecar] ${level} ${message}\n`);
}

// ----------------------------------------------------------------- catalog

const selfPath = fileURLToPath(import.meta.url);

export function catalog(): AgentPreset[] {
  return [
    {
      id: "claude-code",
      name: "Claude Code",
      description: "Anthropic 的编码 agent，经官方 claude-agent-acp 桥接",
      command: CLAUDE_CODE_ACP_DEFAULT.command,
      args: [...CLAUDE_CODE_ACP_DEFAULT.args],
      probe: "claude",
      homepage: "https://docs.anthropic.com/en/docs/claude-code",
    },
    {
      id: "codex",
      name: "Codex",
      description: "OpenAI Codex CLI，经官方 codex-acp 桥接",
      command: CODEX_ACP_DEFAULT.command,
      args: [...CODEX_ACP_DEFAULT.args],
      probe: "codex",
      homepage: "https://github.com/openai/codex",
    },
    {
      id: "codebuddy",
      name: "CodeBuddy",
      description: "腾讯 CodeBuddy Code，原生 ACP（codebuddy --acp）",
      command: "codebuddy",
      args: ["--acp"],
      probe: "codebuddy",
      homepage: "https://cnb.cool/codebuddy/codebuddy-code",
    },
    {
      id: "qoder",
      name: "Qoder",
      description: "Qoder CLI，原生 ACP（qoder --acp）",
      command: "qoder",
      args: ["--acp"],
      probe: "qoder",
      homepage: "https://qoder.com",
    },
    {
      id: "oh-my-pi",
      name: "Oh My Pi",
      description: "omp acp，本地 CLI 直连",
      command: OH_MY_PI_ACP_DEFAULT.command,
      args: [...OH_MY_PI_ACP_DEFAULT.args],
      probe: "omp",
      homepage: "https://github.com/can1357/oh-my-pi",
    },
    {
      id: "pi",
      name: "Pi",
      description: "Pi Coding Agent，经 pi-acp 桥接（内部调用 pi --mode rpc）",
      command: "npx",
      args: ["-y", "pi-acp"],
      probe: "pi",
      homepage: "https://github.com/earendil-works/pi",
    },
    {
      id: "dsh",
      name: "DeepSeek Harness",
      description: "DeepSeek Harness，通过 dsh --profile acp 直连",
      command: "dsh",
      args: ["--profile", "acp"],
      probe: "dsh",
      homepage: "https://github.com/deepseek-ai/deepseek-harness",
    },
    {
      id: "demo",
      name: "Demo Agent",
      description: "内置演示 agent：思考、计划、工具调用、权限请求全流程",
      command: process.execPath,
      args: [selfPath, "--demo-agent"],
      probe: process.execPath,
      homepage: "",
      demo: true,
    },
  ];
}

// ---------------------------------------------------------------- sessions

interface Live {
  key: string;
  agentKey: string;
  session: AcpSession;
  autoAllow: boolean;
  buffer: SessionEvent[];
  timer: NodeJS.Timeout | null;
  /** Permission requests waiting on the user, so a closing session can release them. */
  pendingPermissions: Set<string>;
}

const adapters = new Map<
  string,
  { adapter: AcpAgentAdapter; caps: AgentCapabilities; users: number; stderrTail: string[] }
>();
const lives = new Map<string, Live>();

/** Sentinel pushed into a session's own queue so it arrives after every event of the turn. */
const TURN_END = "__open_chat_turn_end__";

/**
 * Cache key for a shared agent process. A per-launch generation counter lets
 * "refresh model list" force a fresh process: bump the generation, and the
 * next adapterFor spawns anew while already-live sessions keep their old
 * process (they hold the old key) until they close naturally.
 */
const launchGeneration = new Map<string, number>();

function launchBase(agent: AgentLaunch): string {
  return JSON.stringify([agent.command, agent.args ?? [], agent.env ?? {}]);
}

function bumpGeneration(agent: AgentLaunch): void {
  const base = launchBase(agent);
  launchGeneration.set(base, (launchGeneration.get(base) ?? 0) + 1);
}

function agentKeyOf(agent: AgentLaunch): string {
  return `${launchBase(agent)}#${launchGeneration.get(launchBase(agent)) ?? 0}`;
}

function isPnpmShimDir(dir: string): boolean {
  const low = dir.toLowerCase();
  return low.includes("pnpm") && (low.includes("shim") || low.includes("node_modules/.bin") || low.includes("node_modules\\.bin"));
}

/**
 * When `open-chat` is launched via `pnpm dev`, pnpm injects a shim `npx` on PATH
 * that fails with ERR_PNPM_SHIM_NO_TARGET inside projects pinned to pnpm.
 * Resolve the real `npx` beside `process.execPath` (or non-shim PATH) instead,
 * and fall back to `pnpm dlx` if no standalone `npx` exists.
 */
function resolveLaunch(agent: AgentLaunch, env: Record<string, string>): { command: string; args: string[] } {
  const args = [...(agent.args ?? [])];
  if (agent.command !== "npx") return { command: agent.command, args };

  const npxName = process.platform === "win32" ? "npx.cmd" : "npx";
  const nodeBinDir = dirname(process.execPath);
  const pathKey = Object.keys(process.env).find((k) => k.toLowerCase() === "path") ?? "PATH";
  const rawPath = env[pathKey] ?? process.env[pathKey] ?? "";
  const pathDirs = rawPath.split(delimiter).filter(Boolean);

  // Strip pnpm shim directories from child PATH so npx -> npm/node won't hit the shim either.
  const cleanPathDirs = pathDirs.filter((d) => !isPnpmShimDir(d));
  const candidateDirs = [nodeBinDir, ...cleanPathDirs];

  for (const dir of candidateDirs) {
    if (isPnpmShimDir(dir)) continue;
    const candidate = join(dir, npxName);
    if (existsSync(candidate)) {
      const nextDirs = [dir, ...cleanPathDirs.filter((d) => d !== dir)];
      env[pathKey] = nextDirs.join(delimiter);
      return { command: candidate, args };
    }
  }

  // Last resort: use `pnpm dlx` without the `-y` flag.
  return { command: "pnpm", args: ["dlx", ...args.filter((a) => a !== "-y" && a !== "--yes")] };
}

async function withStderrContext(error: unknown, stderrTail: string[]): Promise<never> {
  if (stderrTail.length === 0) {
    // Give child stderr a brief tick to flush after stdout closes.
    await new Promise((r) => setTimeout(r, 80));
  }
  if (stderrTail.length > 0) {
    const base = error instanceof Error ? error.message : String(error);
    const tail = stderrTail.slice(-2).join(" | ");
    throw new AdapterError(
      error instanceof AdapterError ? error.code : "initialize_failed",
      `${base}（${tail}）`,
    );
  }
  throw error;
}

async function adapterFor(agent: AgentLaunch): Promise<{
  key: string;
  adapter: AcpAgentAdapter;
  caps: AgentCapabilities;
  stderrTail: string[];
}> {
  const key = agentKeyOf(agent);
  const cached = adapters.get(key);
  if (cached && cached.adapter.rawConnection?.isConnected) return { key, ...cached };
  if (cached) adapters.delete(key);
  const stderrTail: string[] = [];
  const cleanEnv: Record<string, string> = { ...(agent.env ?? {}) };
  // Avoid nested Claude Code rejection when open-chat is launched from inside Claude Code.
  if ("CLAUDECODE" in process.env) delete process.env.CLAUDECODE;
  const resolved = resolveLaunch(agent, cleanEnv);
  const adapter = new AcpAgentAdapter(
    agent.id,
    { command: resolved.command, args: resolved.args, env: cleanEnv },
    {
      clientInfo: { name: "open-chat", version: "0.1.0" },
      initializeTimeoutMs: 120_000,
      logger: (level, message) => {
        if (message.includes("stderr]")) {
          stderrTail.push(message);
          if (stderrTail.length > 8) stderrTail.shift();
          log("stderr", `${agent.id}: ${message}`);
        } else if (level !== "debug") {
          log(level, `${agent.id}: ${message}`);
        }
      },
    },
  );
  try {
    const caps = await adapter.connect();
    adapters.set(key, { adapter, caps, users: 0, stderrTail });
    return { key, adapter, caps, stderrTail };
  } catch (error) {
    await adapter.dispose().catch(() => {});
    return await withStderrContext(error, stderrTail);
  }
}

function flush(live: Live): void {
  if (live.timer) {
    clearTimeout(live.timer);
    live.timer = null;
  }
  if (live.buffer.length === 0) return;
  const events = live.buffer;
  live.buffer = [];
  notify("events", { key: live.key, events });
}

/** Coalesce adjacent deltas; a 24ms window keeps the page at ~40 updates/s while streaming. */
function enqueue(live: Live, event: SessionEvent): void {
  const last = live.buffer[live.buffer.length - 1];
  if (
    last &&
    (event.type === "message_delta" || event.type === "thought_delta") &&
    last.type === event.type
  ) {
    last.text += event.text;
  } else {
    live.buffer.push(event);
  }
  if (!live.timer) live.timer = setTimeout(() => flush(live), 24);
}

function normalize(event: SessionEvent): SessionEvent | Record<string, unknown> | null {
  if (event.type === "session_info") {
    // ACP puts the title on the update itself; core 0.0.1 looks under `sessionInfo`.
    const title = event.title ?? (event.meta?.title as string | undefined);
    return title ? { type: "session_info", title } : null;
  }
  if (event.type === "usage") {
    const { meta: _meta, ...usage } = event.usage;
    return { type: "usage", usage };
  }
  if (event.type !== "raw") return event;
  const update = event.update as Record<string, unknown> | null;
  if (update && typeof update === "object") {
    if (update[TURN_END]) return null;
    if (update.sessionUpdate === "config_option_update") {
      return { type: "config_update", configOptions: update.configOptions ?? [] };
    }
    if (update.sessionUpdate === "agent_message_chunk" || update.sessionUpdate === "agent_thought_chunk") {
      const content = update.content as { type?: string; uri?: string; name?: string } | undefined;
      if (content?.type === "resource_link") {
        return { type: "message_delta", text: `[${content.name ?? content.uri}](${content.uri})` };
      }
    }
  }
  return event;
}

function pump(live: Live): void {
  void (async () => {
    let failure: string | undefined;
    try {
      for await (const event of live.session.events) {
        if (event.type === "raw") {
          const update = event.update as Record<string, unknown> | null;
          const end = update?.[TURN_END] as Record<string, unknown> | undefined;
          if (end) {
            flush(live);
            notify("events", { key: live.key, events: [{ type: "turn_end", ...end }] });
            continue;
          }
        }
        if (event.type === "permission_request") {
          if (live.autoAllow) {
            const allow =
              event.options.find((option) => option.kind === "allow_once") ??
              event.options.find((option) => option.kind.startsWith("allow"));
            if (allow) {
              // Deliver the request and its auto-resolution in ONE batch.
              // respondPermission is an async round trip to the agent; the 24ms
              // debounce would otherwise flush the bare request first, flashing
              // a confirm card for every auto-approved call. The request itself
              // carries `resolved` so no consumer mistakes it for pending.
              enqueue(live, {
                ...event,
                resolved: { optionId: allow.optionId, auto: true },
              } as never);
              enqueue(live, { type: "permission_resolved", requestId: event.requestId, optionId: allow.optionId, auto: true } as never);
              flush(live);
              await live.session.respondPermission(event.requestId, allow.optionId).catch(() => {});
              continue;
            }
          }
          live.pendingPermissions.add(event.requestId);
        }
        const normalized = normalize(event);
        if (normalized) enqueue(live, normalized as SessionEvent);
        // Permission requests block the agent: deliver them without waiting for the window.
        if (event.type === "permission_request") flush(live);
      }
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }
    flush(live);
    if (lives.get(live.key) === live) {
      lives.delete(live.key);
      release(live.agentKey);
    }
    notify("closed", { key: live.key, ...(failure ? { error: failure } : {}) });
  })();
}

function release(agentKey: string): void {
  const entry = adapters.get(agentKey);
  if (!entry) return;
  entry.users -= 1;
  if (entry.users > 0) return;
  // Idle agent processes are reclaimed after a grace period, so switching
  // between conversations of one agent doesn't respawn it every time.
  setTimeout(() => {
    const current = adapters.get(agentKey);
    if (current === entry && entry.users <= 0) {
      adapters.delete(agentKey);
      void entry.adapter.dispose().catch(() => {});
    }
  }, 5 * 60_000).unref();
}

function liveOf(params: Record<string, unknown> | undefined): Live {
  const key = String(params?.key ?? "");
  const live = lives.get(key);
  if (!live) throw new AdapterError("unknown", `会话未连接：${key}`);
  return live;
}

function describeSession(session: AcpSession, caps: AgentCapabilities, resumed: boolean) {
  const raw = session.raw as {
    modes?: { currentModeId: string; availableModes: { id: string; name: string; description?: string | null }[] } | null;
    configOptions?: unknown[] | null;
  };
  const prompt = (caps.raw.agentCapabilities?.promptCapabilities ?? {}) as Record<string, unknown>;
  const info = (caps.raw as { agentInfo?: { name?: string; title?: string; version?: string } }).agentInfo;
  return {
    acpSessionId: session.id,
    resumed,
    agentInfo: info ? { name: info.title ?? info.name ?? "", version: info.version ?? "" } : null,
    capabilities: {
      loadSession: caps.supportsLoad,
      image: prompt.image === true,
      audio: prompt.audio === true,
      embeddedContext: prompt.embeddedContext === true,
    },
    authMethods: caps.authMethods.map((method) => ({ id: method.id, name: method.name, description: method.description ?? "" })),
    modes: raw.modes
      ? {
          currentModeId: raw.modes.currentModeId,
          availableModes: raw.modes.availableModes.map((mode) => ({
            id: mode.id,
            name: mode.name,
            ...(mode.description ? { description: mode.description } : {}),
          })),
        }
      : null,
    configOptions: raw.configOptions ?? [],
  };
}

// ----------------------------------------------------------------- methods

const methods: Record<string, (params: Record<string, unknown> | undefined) => Promise<unknown>> = {
  async catalog() {
    return catalog();
  },

  async probe(params) {
    const agent = params?.agent as AgentLaunch;
    const cwd = String(params?.cwd ?? process.cwd());
    // refresh: probe a freshly spawned process instead of the cached one, so
    // config changed outside (new models, new providers) is picked up.
    const refresh = params?.refresh === true;
    if (!agent?.command) throw new AdapterError("unknown", "probe 需要 agent");
    if (refresh) bumpGeneration(agent);
    const { key: agentKey, adapter, caps, stderrTail } = await adapterFor(agent);
    const entry = adapters.get(agentKey);
    if (entry) entry.users += 1;
    let session: AcpSession | null = null;
    try {
      session = (await adapter.createSession({ cwd })) as AcpSession;
      return describeSession(session, caps, false);
    } catch (error) {
      if (!adapter.rawConnection?.isConnected) adapters.delete(agentKey);
      return await withStderrContext(error, stderrTail);
    } finally {
      if (session) await session.dispose().catch(() => {});
      if (refresh) {
        // The probe process only existed to read config; reclaim it right away
        // instead of parking it in the idle cache for five minutes.
        adapters.delete(agentKey);
        await adapter.dispose().catch(() => {});
      }
      release(agentKey);
    }
  },

  async open(params) {
    const key = String(params?.key ?? "");
    const agent = params?.agent as AgentLaunch;
    const cwd = String(params?.cwd ?? process.cwd());
    const resumeId = typeof params?.resumeId === "string" ? params.resumeId : undefined;
    if (!key || !agent?.command) throw new AdapterError("unknown", "open 需要 key 与 agent");
    const existing = lives.get(key);
    if (existing) {
      lives.delete(key);
      await existing.session.dispose().catch(() => {});
      release(existing.agentKey);
    }

    const { key: agentKey, adapter, caps, stderrTail } = await adapterFor(agent);
    let session: AcpSession;
    let resumed = false;
    try {
      if (resumeId && caps.supportsLoad) {
        try {
          session = (await adapter.createSession({ cwd, resumeSessionId: resumeId })) as AcpSession;
          resumed = true;
        } catch (error) {
          const detail =
            error && typeof error === "object"
              ? JSON.stringify({
                  message: (error as { message?: unknown }).message,
                  code: (error as { code?: unknown }).code,
                  data: (error as { data?: unknown }).data,
                })
              : String(error);
          log("warn", `${agent.id}: session/load ${resumeId} failed, starting fresh: ${detail}`);
          session = (await adapter.createSession({ cwd })) as AcpSession;
        }
      } else {
        session = (await adapter.createSession({ cwd })) as AcpSession;
      }
    } catch (error) {
      if (!adapter.rawConnection?.isConnected) adapters.delete(agentKey);
      return await withStderrContext(error, stderrTail);
    }
    const entry = adapters.get(agentKey);
    if (entry) entry.users += 1;
    const live: Live = {
      key,
      agentKey,
      session,
      autoAllow: params?.autoAllow === true,
      buffer: [],
      timer: null,
      pendingPermissions: new Set(),
    };
    lives.set(key, live);
    pump(live);
    return describeSession(session, caps, resumed);
  },

  async prompt(params) {
    const live = liveOf(params);
    const blocks = (params?.blocks ?? []) as ContentBlock[];
    if (blocks.length === 0) throw new AdapterError("unknown", "消息不能为空");
    // Answer at once: the turn's progress and its end arrive as events.
    void live.session
      .prompt(blocks)
      .then((result) => live.session.emit({ type: "raw", update: { [TURN_END]: { stopReason: result.stopReason } } }))
      .catch((error: unknown) =>
        live.session.emit({
          type: "raw",
          update: {
            [TURN_END]: {
              stopReason: "error",
              error: error instanceof Error ? error.message : String(error),
            },
          },
        }),
      );
    return { accepted: true };
  },

  async cancel(params) {
    const live = liveOf(params);
    for (const requestId of live.pendingPermissions) {
      await live.session.cancelPermission(requestId).catch(() => {});
      enqueue(live, { type: "permission_resolved", requestId, optionId: null } as never);
    }
    live.pendingPermissions.clear();
    await live.session.interrupt();
    return { ok: true };
  },

  async permission(params) {
    const live = liveOf(params);
    const requestId = String(params?.requestId ?? "");
    const optionId = typeof params?.optionId === "string" ? params.optionId : null;
    if (optionId) await live.session.respondPermission(requestId, optionId);
    else await live.session.cancelPermission(requestId);
    live.pendingPermissions.delete(requestId);
    enqueue(live, { type: "permission_resolved", requestId, optionId } as never);
    flush(live);
    return { ok: true };
  },

  async setMode(params) {
    const live = liveOf(params);
    const modeId = String(params?.modeId ?? "");
    if (!live.session.setMode) throw new AdapterError("unsupported", "该 agent 不支持切换模式");
    await live.session.setMode(modeId);
    enqueue(live, { type: "mode_update", currentModeId: modeId });
    flush(live);
    return { ok: true };
  },

  async setConfig(params) {
    const live = liveOf(params);
    const configId = String(params?.configId ?? "");
    const value = params?.value;
    const request =
      typeof value === "boolean"
        ? { sessionId: live.session.id, configId, type: "boolean" as const, value }
        : { sessionId: live.session.id, configId, value: String(value) };
    const response = await live.session.setConfigOption(request);
    const configOptions = (response as { configOptions?: unknown[] }).configOptions ?? [];
    enqueue(live, { type: "config_update", configOptions } as never);
    flush(live);
    return { configOptions };
  },

  async setAutoAllow(params) {
    const val = params?.autoAllow === true;
    const key = typeof params?.key === "string" ? params.key : "";
    if (key) {
      const live = lives.get(key);
      if (live) live.autoAllow = val;
    } else {
      for (const live of lives.values()) live.autoAllow = val;
    }
    return { ok: true };
  },

  async close(params) {
    const key = String(params?.key ?? "");
    const live = lives.get(key);
    if (!live) return { ok: true };
    lives.delete(key);
    await live.session.dispose().catch(() => {});
    release(live.agentKey);
    return { ok: true };
  },

  async shutdown() {
    await disposeAll();
    setTimeout(() => process.exit(0), 10);
    return { ok: true };
  },
};

async function disposeAll(): Promise<void> {
  for (const live of lives.values()) await live.session.dispose().catch(() => {});
  lives.clear();
  for (const { adapter } of adapters.values()) await adapter.dispose().catch(() => {});
  adapters.clear();
}

function errorFrame(id: number, error: unknown) {
  if (error instanceof AdapterError) return { id, error: { message: error.message, code: error.code } };
  return { id, error: { message: error instanceof Error ? error.message : String(error), code: "unknown" } };
}

function serve(): void {
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  lines.on("line", (line) => {
    if (!line.trim()) return;
    let request: Request;
    try {
      request = JSON.parse(line) as Request;
    } catch {
      log("error", `bad frame: ${line.slice(0, 200)}`);
      return;
    }
    const handler = methods[request.method];
    if (!handler) {
      send({ id: request.id, error: { message: `unknown method ${request.method}`, code: "unknown" } });
      return;
    }
    handler(request.params).then(
      (result) => send({ id: request.id, result: result ?? null }),
      (error: unknown) => send(errorFrame(request.id, error)),
    );
  });
  // The host going away (stdin closed) takes every agent process with it.
  lines.on("close", () => {
    void disposeAll().finally(() => process.exit(0));
  });
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.on(signal, () => {
      void disposeAll().finally(() => process.exit(0));
    });
  }
  notify("ready", { version: "0.1.0", node: process.version });
}

if (process.argv.includes("--demo-agent")) {
  runDemoAgent();
} else {
  serve();
}
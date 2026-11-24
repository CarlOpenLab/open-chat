// App state: one reactive store, fed by the host's pushes.
import { computed, reactive, ref, watch } from "vue";
import { api, inApp, subscribe } from "./api";
import { initNotifications, notifyNeedYou, notifyTurnDone } from "./notify";
import { apply, emptyTranscript, type Transcript } from "./transcript";
import type { AgentInfo, AgentUpdateProgress, Block, Bootstrap, ConfigOption, LiveState, Meta, Push, Settings } from "./types";

export interface QueuedMessage {
  id: string;
  blocks: Block[];
  createdAt: number;
}

const idleLive = (): LiveState => ({
  status: "idle",
  agentInfo: null,
  capabilities: { loadSession: false, image: false, audio: false, embeddedContext: false },
  modes: null,
  configOptions: [],
  commands: [],
  resumed: false,
});

export const store = reactive({
  ready: false,
  bootError: "",
  boot: null as Bootstrap | null,
  settings: null as Settings | null,
  agents: [] as AgentInfo[],
  metas: {} as Record<string, Meta>,
  transcripts: {} as Record<string, Transcript>,
  lives: {} as Record<string, LiveState>,
  drafts: {} as Record<string, string>,
  /** Per-conversation draft attachments (images & files) in the composer. */
  draftAttachments: {} as Record<string, Block[]>,
  /** Per-conversation queued follow-up messages while a turn is running. */
  queues: {} as Record<string, QueuedMessage[]>,
  /** The open conversation; null shows the new-conversation screen. */
  activeId: null as string | null,
  loading: {} as Record<string, boolean>,
  sidebarCollapsed: localStorage.getItem("oc.sidebar") === "0",
  workspaceOpen: false,
  workspaceTab: (localStorage.getItem("oc.workspaceTab") === "terminal" ? "terminal" : "files") as "files" | "terminal",
  workspaceWidth: Math.min(820, Math.max(340, Number(localStorage.getItem("oc.workspaceWidth")) || 480)),
  /** Pending file to open and highlight in the WorkspacePanel file tree. */
  workspaceReveal: null as { path: string[]; seq: number } | null,
  settingsOpen: false,
  search: "",
  userAvatar: localStorage.getItem("oc.userAvatar") || "",
  /** Tracks turn completion outcomes per conversation for sidebar status badges. */
  turnOutcome: {} as Record<string, "done" | "unseen" | "error">,
  /** Cached ACP model lists per agentId so New Chat can pick models before connecting. */
  cachedModels: (() => {
    try {
      return JSON.parse(localStorage.getItem("oc.agentModels") || "{}") as Record<string, ConfigOption>;
    } catch {
      return {};
    }
  })(),
  probingModels: {} as Record<string, boolean>,
  probeErrors: {} as Record<string, string>,
  agentUpdateProgress: null as AgentUpdateProgress | null,
  agentUpdateProgressById: {} as Record<string, AgentUpdateProgress>,
});

function captureModels(agentId: string | undefined, configOptions: ConfigOption[] | undefined) {
  if (!agentId || !configOptions?.length) return;
  const opt =
    configOptions.find((o) => o.category === "model") ??
    configOptions.find((o) => o.type === "select" && o.id.includes("model"));
  if (!opt?.options?.length) return;
  store.cachedModels[agentId] = opt;
  try {
    localStorage.setItem("oc.agentModels", JSON.stringify(store.cachedModels));
  } catch {
    /* ignore quota errors */
  }
}

export function setUserAvatar(dataUrl: string) {
  store.userAvatar = dataUrl;
  if (dataUrl) {
    localStorage.setItem("oc.userAvatar", dataUrl);
  } else {
    localStorage.removeItem("oc.userAvatar");
  }
}

export function isArchived(id: string): boolean {
  return Boolean(store.metas[id]?.archived);
}

export async function setArchived(id: string, archived: boolean) {
  store.metas[id] = await api.archive(id, archived);
}

watch(
  () => store.sidebarCollapsed,
  (v) => localStorage.setItem("oc.sidebar", v ? "0" : "1"),
);
const workspaceOpenById: Record<string, boolean> = (() => {
  try {
    const raw = JSON.parse(localStorage.getItem("oc.workspaceOpenById") || "{}") as Record<string, unknown>;
    const out: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(raw)) {
      if (v === true) out[k] = true;
    }
    return out;
  } catch {
    return {};
  }
})();

function saveWorkspaceOpenMap() {
  try {
    localStorage.setItem("oc.workspaceOpenById", JSON.stringify(workspaceOpenById));
  } catch {
    /* ignore quota errors */
  }
}

watch(
  () => store.workspaceOpen,
  (v) => {
    const id = store.activeId;
    if (!id) return;
    if (v) workspaceOpenById[id] = true;
    else delete workspaceOpenById[id];
    saveWorkspaceOpenMap();
  },
);
watch(
  () => store.workspaceTab,
  (v) => localStorage.setItem("oc.workspaceTab", v),
);
watch(
  () => store.workspaceWidth,
  (v) => localStorage.setItem("oc.workspaceWidth", String(Math.round(v))),
);

function normalizeSlashPath(p: string): string {
  const parts = p.replace(/\\/g, "/").split("/");
  const isAbs = p.startsWith("/") || /^[a-zA-Z]:\//.test(p.replace(/\\/g, "/"));
  const drive = /^[a-zA-Z]:\//.test(p.replace(/\\/g, "/")) ? parts.shift()! : "";
  const stack: string[] = [];
  for (const seg of parts) {
    if (!seg || seg === ".") continue;
    if (seg === "..") {
      if (stack.length && stack[stack.length - 1] !== "..") stack.pop();
      else if (!isAbs) stack.push("..");
    } else {
      stack.push(seg);
    }
  }
  if (drive) return `${drive}/${stack.join("/")}`;
  return (isAbs ? "/" : "") + stack.join("/");
}

/**
 * Resolves a local file link or path (file://, absolute, ~/, or relative, with optional :line:col)
 * into a workspace-relative path inside `cwd`. Returns null if it is a web URL or outside `cwd`.
 */
export function resolveWorkspaceRelPath(target: string, cwd: string): string | null {
  let raw = target.trim();
  if (!raw || raw.startsWith("#")) return null;

  // Reject web or unsafe schemes, while allowing file:// and Windows drive letters (C:\...)
  const schemeMatch = raw.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/);
  if (schemeMatch) {
    const scheme = schemeMatch[1].toLowerCase();
    const isWinDrive = scheme.length === 1 && /^([a-zA-Z]):[\\/]/.test(raw);
    if (scheme === "file") {
      try {
        const u = new URL(raw);
        raw = decodeURIComponent(u.pathname);
        if (/^\/[a-zA-Z]:\//.test(raw)) raw = raw.slice(1);
      } catch {
        raw = raw.replace(/^file:\/\/(?:localhost)?/i, "");
        try {
          raw = decodeURIComponent(raw);
        } catch {
          /* keep raw */
        }
      }
    } else if (!isWinDrive) {
      return null;
    }
  }

  // Strip #L12 / :line / :line:col suffixes often attached by coding agents
  raw = raw.replace(/#.*$/, "").replace(/:\d+(?::\d+)?$/, "").trim();
  if (!raw) return null;

  const home = (store.boot?.home ?? "").replace(/\\/g, "/").replace(/\/+$/, "");
  const expand = (p: string) => {
    const s = p.replace(/\\/g, "/");
    if (home && (s === "~" || s.startsWith("~/"))) return home + s.slice(1);
    return s;
  };

  const baseCwd = normalizeSlashPath(expand(cwd.trim())).replace(/\/+$/, "");
  if (!baseCwd) return null;

  const expanded = expand(raw);
  const isAbs = expanded.startsWith("/") || /^[a-zA-Z]:\//.test(expanded);
  if (isAbs) {
    const clean = normalizeSlashPath(expanded);
    const isWin = /^[a-zA-Z]:\//.test(baseCwd);
    const prefix = baseCwd + "/";
    const matches = isWin
      ? clean.toLowerCase().startsWith(prefix.toLowerCase())
      : clean.startsWith(prefix);
    if (!matches) return null;
    const rel = clean.slice(prefix.length).replace(/^\/+/, "");
    return rel || null;
  }

  const rel = normalizeSlashPath(expanded);
  if (!rel || rel === "." || rel === ".." || rel.startsWith("../")) return null;
  return rel;
}

let workspaceRevealSeq = 0;

/** Opens a file inside the current workspace in the right-hand WorkspacePanel file tree. */
export function openWorkspaceFile(target: string, cwd?: string): boolean {
  const base = cwd ?? activeMeta.value?.cwd ?? "";
  const rel = resolveWorkspaceRelPath(target, base);
  if (!rel) return false;
  const segments = rel.split("/").filter(Boolean);
  if (!segments.length) return false;
  store.workspaceOpen = true;
  store.workspaceTab = "files";
  store.workspaceReveal = { path: segments, seq: ++workspaceRevealSeq };
  return true;
}

type TermOutListener = (id: string, data: string) => void;
type TermExitListener = (id: string, exitCode: number) => void;
const termOutListeners = new Set<TermOutListener>();
const termExitListeners = new Set<TermExitListener>();

export function onTermOut(fn: TermOutListener): () => void {
  termOutListeners.add(fn);
  return () => termOutListeners.delete(fn);
}

export function onTermExit(fn: TermExitListener): () => void {
  termExitListeners.add(fn);
  return () => termExitListeners.delete(fn);
}

// ------------------------------------------------------------------ theme

const media = window.matchMedia("(prefers-color-scheme: dark)");
const systemDark = ref(media.matches);
media.addEventListener("change", (e) => (systemDark.value = e.matches));

export const isDark = computed(() => {
  const t = store.settings?.theme ?? "system";
  return t === "dark" || (t === "system" && systemDark.value);
});

watch(
  isDark,
  (dark) => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
  },
  { immediate: true },
);

// -------------------------------------------------------------- selectors

export const activeMeta = computed(() => (store.activeId ? store.metas[store.activeId] ?? null : null));
export const activeLive = computed(() => (store.activeId ? store.lives[store.activeId] ?? idleLive() : idleLive()));
export const activeTranscript = computed(() => (store.activeId ? store.transcripts[store.activeId] ?? null : null));

export const sortedMetas = computed(() =>
  Object.values(store.metas).sort((a, b) => b.updatedAt - a.updatedAt),
);

export function agentById(id: string): AgentInfo | undefined {
  return store.agents.find((a) => a.id === id);
}

export const platform = computed(() => store.boot?.platform ?? "");
export const isMac = computed(() => platform.value === "darwin" || (!inApp && /Mac/.test(navigator.platform)));

// ------------------------------------------------------------------ boot

function notifyCtxFor(conversationId: string) {
  return {
    conversationId,
    activeId: store.activeId,
    meta: store.metas[conversationId],
    settings: store.settings,
    onSelect: (id: string) => void select(id),
  };
}

function onPush(p: Push) {
  switch (p.kind) {
    case "events": {
      const tr = store.transcripts[p.conversationId];
      if (tr) apply(tr, p.events);
      // Requests auto-resolved within the same batch (the sidecar answers them
      // before flushing) must not fire "需要你的确认" toasts.
      const settled = new Set(
        p.events.filter((e) => e.type === "permission_resolved").map((e) => e.requestId),
      );
      for (const ev of p.events) {
        if (ev.type === "permission_request" && !ev.resolved && !settled.has(ev.requestId)) {
          const detail = ev.toolCall?.title || ev.toolCall?.kind;
          notifyNeedYou(notifyCtxFor(p.conversationId), detail);
        } else if (ev.type === "turn_end") {
          const reason = String((ev as { stopReason?: string }).stopReason ?? "");
          if (reason === "error" || reason === "max_tokens") {
            store.turnOutcome[p.conversationId] = "error";
            const errMsg =
              (ev as { error?: string }).error || (reason === "max_tokens" ? "回答超长被截断" : undefined);
            notifyTurnDone(notifyCtxFor(p.conversationId), "error", errMsg);
          } else if (reason === "end_turn") {
            store.turnOutcome[p.conversationId] = store.activeId === p.conversationId ? "done" : "unseen";
            notifyTurnDone(notifyCtxFor(p.conversationId), "done");
          }
        }
      }
      return;
    }
    case "live": {
      const prev = store.lives[p.conversationId]?.status;
      store.lives[p.conversationId] = p.live;
      captureModels(store.metas[p.conversationId]?.agentId, p.live.configOptions);
      if (p.live.status === "running") {
        delete store.turnOutcome[p.conversationId];
        manualStop.delete(p.conversationId);
      } else if (p.live.status === "error") {
        store.turnOutcome[p.conversationId] = "error";
        steerPending.delete(p.conversationId);
      } else if (prev === "running" && (p.live.status === "ready" || p.live.status === "idle")) {
        if (!store.turnOutcome[p.conversationId]) {
          store.turnOutcome[p.conversationId] = store.activeId === p.conversationId ? "done" : "unseen";
        }
        const shouldSteer = steerPending.delete(p.conversationId);
        const wasManualStop = manualStop.delete(p.conversationId);
        if (shouldSteer || !wasManualStop) {
          void drainQueue(p.conversationId);
        }
      }
      return;
    }
    case "meta":
      store.metas[p.conversationId] = p.meta;
      return;
    case "removed":
      delete store.metas[p.conversationId];
      delete store.transcripts[p.conversationId];
      delete store.lives[p.conversationId];
      delete store.turnOutcome[p.conversationId];
      delete store.queues[p.conversationId];
      delete store.drafts[p.conversationId];
      delete store.draftAttachments[p.conversationId];
      if (workspaceOpenById[p.conversationId]) {
        delete workspaceOpenById[p.conversationId];
        saveWorkspaceOpenMap();
      }
      steerPending.delete(p.conversationId);
      manualStop.delete(p.conversationId);
      if (store.activeId === p.conversationId) {
        store.activeId = null;
        store.workspaceOpen = false;
      }
      return;
    case "focus":
      if (p.conversationId && store.metas[p.conversationId]) {
        void select(p.conversationId);
      }
      return;
    case "settings":
      store.settings = p.settings;
      return;
    case "agent_update":
      store.agentUpdateProgress = p.agentUpdate;
      if (p.agentUpdate.agentId) {
        store.agentUpdateProgressById[p.agentUpdate.agentId] = p.agentUpdate;
      }
      return;
    case "term_out":
      for (const fn of termOutListeners) fn(p.termOut.id, p.termOut.data);
      return;
    case "term_exit":
      for (const fn of termExitListeners) fn(p.termExit.id, p.termExit.exitCode);
      return;
  }
}

async function reload() {
  const boot = await api.bootstrap();
  store.boot = boot;
  store.settings = boot.settings;
  store.agents = boot.agents ?? [];
  const metas: Record<string, Meta> = {};
  for (const m of boot.conversations ?? []) metas[m.id] = m;
  store.metas = metas;
  // Transcripts may have moved on while the stream was down: reload the open one.
  const open = store.activeId;
  store.transcripts = {};
  if (open && metas[open]) await load(open);
  else store.activeId = null;
}

async function migrateLegacyArchives() {
  const raw = localStorage.getItem("oc.archivedIds");
  if (!raw) return;
  try {
    const ids = JSON.parse(raw) as unknown;
    if (Array.isArray(ids)) {
      for (const id of ids) {
        if (typeof id === "string" && store.metas[id] && !store.metas[id].archived) {
          store.metas[id] = await api.archive(id, true);
        }
      }
    }
    localStorage.removeItem("oc.archivedIds");
  } catch {
    localStorage.removeItem("oc.archivedIds");
  }
}

export async function init() {
  initNotifications();
  subscribe(onPush, () => void reload().catch(() => {}));
  try {
    await reload();
    await migrateLegacyArchives();
    const last = localStorage.getItem("oc.active");
    if (last && store.metas[last]) await select(last);
    store.ready = true;
    // The agent catalog arrives with the sidecar; probe again once it's warm.
    if (store.agents.length === 0) setTimeout(() => void refreshAgents(), 1500);
  } catch (e) {
    store.bootError = e instanceof Error ? e.message : String(e);
  }
}

export async function refreshAgents() {
  store.agents = await api.agents();
}

export async function probeModels(agentId: string, cwd = "", force = false) {
  if (!agentId || store.probingModels[agentId]) return;
  if (!force && store.cachedModels[agentId]?.options?.length) return;
  const agent = agentById(agentId);
  if (!agent?.available) return;
  store.probingModels[agentId] = true;
  delete store.probeErrors[agentId];
  try {
    const opts = await api.probeModels(agentId, cwd || store.boot?.home || "");
    captureModels(agentId, opts);
  } catch (e) {
    store.probeErrors[agentId] = e instanceof Error ? e.message : String(e);
  } finally {
    store.probingModels[agentId] = false;
  }
}

/** Re-read an agent's model list from a freshly spawned agent process; errors propagate to the caller. */
export async function refreshModels(agentId: string, cwd = "") {
  if (!agentId || store.probingModels[agentId]) return;
  const agent = agentById(agentId);
  if (!agent?.available) return;
  store.probingModels[agentId] = true;
  delete store.probeErrors[agentId];
  try {
    const opts = await api.refreshModels(agentId, cwd || store.boot?.home || "");
    captureModels(agentId, opts);
  } finally {
    store.probingModels[agentId] = false;
  }
}

async function load(id: string) {
  if (store.loading[id]) return;
  store.loading[id] = true;
  try {
    const conv = await api.open(id);
    const tr = emptyTranscript();
    apply(tr, conv.events ?? []);
    store.transcripts[id] = tr;
    store.lives[id] = conv.live;
    store.metas[id] = conv.meta;
    captureModels(conv.meta.agentId, conv.live.configOptions);
  } finally {
    store.loading[id] = false;
  }
}

// --------------------------------------------------------------- actions

export async function select(id: string | null) {
  store.activeId = id;
  store.workspaceOpen = id ? Boolean(workspaceOpenById[id]) : false;
  if (id) {
    localStorage.setItem("oc.active", id);
    if (store.turnOutcome[id] === "unseen") store.turnOutcome[id] = "done";
  } else {
    localStorage.removeItem("oc.active");
  }
  if (id && !store.transcripts[id]) await load(id);
}

export function newConversation() {
  void select(null);
}

export type PermissionMode = "supervised" | "auto" | "full";

const PERM_MODE_CANDIDATES: Record<PermissionMode, string[]> = {
  supervised: ["default", "read-only", "readonly", "ask", "supervised", "standard", "manual"],
  auto: ["acceptedits", "accept-edits", "accept_edits", "agent", "auto", "agent-auto-review", "workspace-write", "default"],
  full: [
    "bypasspermissions",
    "bypass-permissions",
    "bypass_permissions",
    "agent-full-access",
    "full-access",
    "full_access",
    "danger-full-access",
    "yolo",
    "dontask",
    "dont-ask",
    "acceptedits",
    "accept-edits",
    "agent",
  ],
};

function pickBestModeId(mode: PermissionMode, availableIds: string[]): string | null {
  if (!availableIds.length) return null;
  const byLower = new Map(availableIds.map((id) => [id.toLowerCase(), id]));
  for (const candidate of PERM_MODE_CANDIDATES[mode]) {
    const hit = byLower.get(candidate);
    if (hit) return hit;
  }
  return null;
}

export function resolvePermissionTarget(
  mode: PermissionMode,
  live: LiveState,
): { kind: "mode"; modeId: string } | { kind: "config"; configId: string; value: string } | null {
  const availableModes = live.modes?.availableModes ?? [];
  if (availableModes.length) {
    const target = pickBestModeId(
      mode,
      availableModes.map((m) => m.id),
    );
    if (target && target !== live.modes?.currentModeId) {
      return { kind: "mode", modeId: target };
    }
    return null;
  }
  const cfg = (live.configOptions ?? []).find((o) => o.category === "mode" || o.id === "mode");
  if (!cfg) return null;
  const raw = cfg.options ?? [];
  const values =
    Array.isArray(raw) && raw.length && "group" in (raw[0] as object)
      ? (raw as { options: { value: string }[] }[]).flatMap((g) => g.options.map((x) => x.value))
      : (raw as { value: string }[]).map((x) => x.value);
  const target = pickBestModeId(mode, values);
  if (target && target !== String(cfg.currentValue ?? "")) {
    return { kind: "config", configId: cfg.id, value: target };
  }
  return null;
}

export function currentPermissionMode(): PermissionMode {
  const saved = localStorage.getItem("oc.permMode") as PermissionMode | null;
  if (saved === "supervised" || saved === "auto" || saved === "full") return saved;
  return store.settings?.autoAllow ? "auto" : "supervised";
}

function isPiAgent(agentId: string): boolean {
  const id = (agentId ?? "").toLowerCase();
  return id === "pi" || id === "omp" || id.includes("oh-my-pi");
}

export async function start(
  agentId: string,
  cwd: string,
  blocks: Block[],
  initialModel?: { configId: string; value: string } | null,
) {
  const meta = await api.create(agentId, cwd);
  store.metas[meta.id] = meta;
  store.transcripts[meta.id] = emptyTranscript();
  store.lives[meta.id] = { ...idleLive(), status: "connecting" };
  await select(meta.id);
  if (blocks.length || (initialModel?.configId && initialModel.value)) {
    try {
      const live = await api.connect(meta.id);
      if (initialModel?.configId && initialModel.value) {
        await api.setConfig(meta.id, initialModel.configId, initialModel.value).catch(() => {});
      }
      if (!isPiAgent(agentId)) {
        const target = resolvePermissionTarget(currentPermissionMode(), live);
        if (target?.kind === "mode") {
          await api.setMode(meta.id, target.modeId).catch(() => {});
        } else if (target?.kind === "config") {
          await api.setConfig(meta.id, target.configId, target.value).catch(() => {});
        }
      }
    } catch {
      /* fall back to agent defaults if pre-connect fails */
    }
  }
  if (blocks.length) await send(meta.id, blocks);
  return meta;
}

const steerPending = new Set<string>();
const manualStop = new Set<string>();
const draining = new Set<string>();
let queueSeq = 0;

export function enqueueMessage(id: string, blocks: Block[]) {
  if (!blocks.length) return;
  store.drafts[id] = "";
  const list = store.queues[id] ?? [];
  store.queues[id] = [...list, { id: `q-${Date.now()}-${++queueSeq}`, blocks, createdAt: Date.now() }];
}

export function removeQueued(id: string, queueId: string) {
  const list = store.queues[id];
  if (!list) return;
  store.queues[id] = list.filter((item) => item.id !== queueId);
}

export function popQueuedToDraft(id: string, queueId: string) {
  const list = store.queues[id];
  if (!list) return;
  const target = list.find((item) => item.id === queueId);
  if (!target) return;
  store.queues[id] = list.filter((item) => item.id !== queueId);
  const text = target.blocks
    .filter((b): b is Extract<Block, { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("\n");
  if (text) {
    store.drafts[id] = store.drafts[id] ? `${text}\n${store.drafts[id]}` : text;
  }
  const attachments = target.blocks.filter((b) => b.type !== "text");
  if (attachments.length) {
    store.draftAttachments[id] = [...attachments, ...(store.draftAttachments[id] ?? [])];
  }
}

async function drainQueue(id: string) {
  if (draining.has(id)) return;
  const list = store.queues[id];
  if (!list?.length) return;
  if (store.lives[id]?.status === "running") return;
  const [next, ...rest] = list;
  store.queues[id] = rest;
  draining.add(id);
  try {
    await api.send(id, next.blocks);
  } catch {
    // Restore failed item to the front so the user doesn't lose it.
    store.queues[id] = [next, ...(store.queues[id] ?? [])];
  } finally {
    draining.delete(id);
  }
}

export async function steerQueued(id: string, queueId: string) {
  const list = store.queues[id];
  if (!list?.length) return;
  const idx = list.findIndex((item) => item.id === queueId);
  if (idx === -1) return;
  const [target] = list.splice(idx, 1);
  store.queues[id] = [target, ...list];
  if (store.lives[id]?.status === "running") {
    steerPending.add(id);
    manualStop.delete(id);
    await api.cancel(id);
  } else {
    await drainQueue(id);
  }
}

export async function send(id: string, blocks: Block[]) {
  store.drafts[id] = "";
  await api.send(id, blocks);
}

export const cancel = (id: string) => {
  manualStop.add(id);
  steerPending.delete(id);
  return api.cancel(id);
};
export const respond = (id: string, requestId: string, optionId: string) => api.respond(id, requestId, optionId);
export const setMode = (id: string, modeId: string) => api.setMode(id, modeId);
export const setConfig = (id: string, configId: string, value: string | boolean) => api.setConfig(id, configId, value);
export const connect = (id: string) => api.connect(id);

export async function rename(id: string, title: string) {
  store.metas[id] = await api.rename(id, title);
}

export async function pin(id: string, pinned: boolean) {
  store.metas[id] = await api.pin(id, pinned);
}

export async function remove(id: string) {
  await api.remove(id);
  delete store.metas[id];
  if (store.activeId === id) await select(null);
}

export async function saveSettings(patch: Partial<Settings>) {
  if (!store.settings) return;
  store.settings = await api.saveSettings({ ...store.settings, ...patch });
  await refreshAgents();
}
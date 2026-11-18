// App state: one reactive store, fed by the host's pushes.
import { computed, reactive, ref, watch } from "vue";
import { api, inApp, subscribe } from "./api";
import { apply, emptyTranscript, type Transcript } from "./transcript";
import type { AgentInfo, Block, Bootstrap, LiveState, Meta, Push, Settings } from "./types";

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
  /** The open conversation; null shows the new-conversation screen. */
  activeId: null as string | null,
  loading: {} as Record<string, boolean>,
  sidebarCollapsed: localStorage.getItem("oc.sidebar") === "0",
  settingsOpen: false,
  search: "",
});

watch(
  () => store.sidebarCollapsed,
  (v) => localStorage.setItem("oc.sidebar", v ? "0" : "1"),
);

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

function onPush(p: Push) {
  switch (p.kind) {
    case "events": {
      const tr = store.transcripts[p.conversationId];
      if (tr) apply(tr, p.events);
      return;
    }
    case "live":
      store.lives[p.conversationId] = p.live;
      return;
    case "meta":
      store.metas[p.conversationId] = p.meta;
      return;
    case "removed":
      delete store.metas[p.conversationId];
      delete store.transcripts[p.conversationId];
      delete store.lives[p.conversationId];
      if (store.activeId === p.conversationId) store.activeId = null;
      return;
    case "settings":
      store.settings = p.settings;
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

export async function init() {
  subscribe(onPush, () => void reload().catch(() => {}));
  try {
    await reload();
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

async function load(id: string) {
  store.loading[id] = true;
  try {
    const conv = await api.open(id);
    const tr = emptyTranscript();
    apply(tr, conv.events ?? []);
    store.transcripts[id] = tr;
    store.lives[id] = conv.live;
    store.metas[id] = conv.meta;
  } finally {
    store.loading[id] = false;
  }
}

// --------------------------------------------------------------- actions

export async function select(id: string | null) {
  store.activeId = id;
  if (id) localStorage.setItem("oc.active", id);
  else localStorage.removeItem("oc.active");
  if (id && !store.transcripts[id]) await load(id);
}

export function newConversation() {
  void select(null);
}

export async function start(agentId: string, cwd: string, blocks: Block[]) {
  const meta = await api.create(agentId, cwd);
  store.metas[meta.id] = meta;
  store.transcripts[meta.id] = emptyTranscript();
  store.lives[meta.id] = { ...idleLive(), status: "connecting" };
  await select(meta.id);
  if (blocks.length) await send(meta.id, blocks);
  return meta;
}

export async function send(id: string, blocks: Block[]) {
  store.drafts[id] = "";
  await api.send(id, blocks);
}

export const cancel = (id: string) => api.cancel(id);
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
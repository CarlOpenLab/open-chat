<script setup lang="ts">
import { ClearOutlined, CloseOutlined, PlusOutlined } from "@antdv-next/icons";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { Tooltip, message } from "antdv-next";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { api } from "../api";
import { isDark, onTermExit, onTermOut } from "../store";

const props = defineProps<{
  cwd: string;
  visible: boolean;
}>();

interface TabItem {
  id: string;
  cwd: string;
  title: string;
  exited: boolean;
  exitCode?: number;
}

const tabs = ref<TabItem[]>([]);
const activeByCwd = ref<Record<string, string>>({});
const creating = ref(false);

const stageRef = ref<HTMLElement | null>(null);
const mountRefs = new Map<string, HTMLElement>();
const instances = new Map<string, { term: Terminal; fit: FitAddon }>();
const pendingChunks = new Map<string, Uint8Array[]>();
let seqByCwd: Record<string, number> = {};
let ro: ResizeObserver | null = null;
let offOut: (() => void) | null = null;
let offExit: (() => void) | null = null;

const cwdTabs = computed(() => tabs.value.filter((t) => t.cwd === props.cwd));
const activeId = computed({
  get: () => activeByCwd.value[props.cwd] ?? cwdTabs.value[0]?.id ?? "",
  set: (id: string) => {
    activeByCwd.value = { ...activeByCwd.value, [props.cwd]: id };
  },
});

function termTheme(dark: boolean) {
  if (dark) {
    return {
      background: "#0d1017",
      foreground: "#e6edf3",
      cursor: "#f4f6fb",
      cursorAccent: "#0d1017",
      selectionBackground: "rgba(148, 163, 184, 0.28)",
      black: "#161b22",
      red: "#f87171",
      green: "#34d399",
      yellow: "#fbbf24",
      blue: "#60a5fa",
      magenta: "#c084fc",
      cyan: "#22d3ee",
      white: "#e2e8f0",
      brightBlack: "#64748b",
      brightRed: "#fca5a5",
      brightGreen: "#6ee7b7",
      brightYellow: "#fde68a",
      brightBlue: "#93c5fd",
      brightMagenta: "#d8b4fe",
      brightCyan: "#67e8f9",
      brightWhite: "#f8fafc",
    };
  }
  return {
    background: "#f8fafc",
    foreground: "#111318",
    cursor: "#14161c",
    cursorAccent: "#f8fafc",
    selectionBackground: "rgba(15, 23, 42, 0.16)",
    black: "#1e293b",
    red: "#dc2626",
    green: "#16a34a",
    yellow: "#d97706",
    blue: "#2563eb",
    magenta: "#9333ea",
    cyan: "#0891b2",
    white: "#f1f5f9",
    brightBlack: "#64748b",
    brightRed: "#ef4444",
    brightGreen: "#22c55e",
    brightYellow: "#f59e0b",
    brightBlue: "#3b82f6",
    brightMagenta: "#a855f7",
    brightCyan: "#06b6d4",
    brightWhite: "#ffffff",
  };
}

function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function setMountRef(id: string, el: unknown) {
  if (el instanceof HTMLElement) {
    mountRefs.set(id, el);
    ensureMounted(id);
  } else {
    mountRefs.delete(id);
  }
}

function ensureMounted(id: string) {
  if (instances.has(id)) return;
  const el = mountRefs.get(id);
  if (!el) return;

  const term = new Terminal({
    fontFamily: '"SF Mono", "JetBrains Mono", "Cascadia Code", Menlo, Consolas, monospace',
    fontSize: 12.5,
    lineHeight: 1.42,
    cursorBlink: true,
    cursorStyle: "bar",
    scrollback: 5000,
    allowProposedApi: false,
    theme: termTheme(isDark.value),
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(el);

  term.onData((data) => {
    void api.termWrite(id, data).catch(() => {});
  });
  term.onResize(({ cols, rows }) => {
    void api.termResize(id, cols, rows).catch(() => {});
  });

  instances.set(id, { term, fit });

  const queued = pendingChunks.get(id);
  if (queued?.length) {
    for (const chunk of queued) term.write(chunk);
    pendingChunks.delete(id);
  }

  requestAnimationFrame(() => fitActive());
}

function fitActive() {
  if (!props.visible || !activeId.value) return;
  const inst = instances.get(activeId.value);
  if (!inst) return;
  try {
    inst.fit.fit();
  } catch {
    /* ignore while hidden or zero-sized */
  }
}

async function createTerminal() {
  if (creating.value) return;
  creating.value = true;
  try {
    const info = await api.termCreate(props.cwd, 80, 24);
    const n = (seqByCwd[props.cwd] ?? 0) + 1;
    seqByCwd[props.cwd] = n;
    const label = `${info.shell || "shell"} ${n}`;
    tabs.value = [...tabs.value, { id: info.id, cwd: props.cwd, title: label, exited: false }];
    activeId.value = info.id;
    await nextTick();
    ensureMounted(info.id);
    requestAnimationFrame(() => {
      fitActive();
      instances.get(info.id)?.term.focus();
    });
  } catch (e) {
    message.error(e instanceof Error ? e.message : String(e));
  } finally {
    creating.value = false;
  }
}

async function closeTerminal(id: string) {
  const target = tabs.value.find((t) => t.id === id);
  tabs.value = tabs.value.filter((t) => t.id !== id);
  const inst = instances.get(id);
  if (inst) {
    inst.term.dispose();
    instances.delete(id);
  }
  mountRefs.delete(id);
  pendingChunks.delete(id);
  if (target && activeByCwd.value[target.cwd] === id) {
    const next = tabs.value.find((t) => t.cwd === target.cwd);
    activeByCwd.value = { ...activeByCwd.value, [target.cwd]: next?.id ?? "" };
  }
  await api.termClose(id).catch(() => {});
  if (activeId.value) {
    requestAnimationFrame(() => {
      fitActive();
      instances.get(activeId.value)?.term.focus();
    });
  }
}

function clearActive() {
  if (!activeId.value) return;
  instances.get(activeId.value)?.term.clear();
  instances.get(activeId.value)?.term.focus();
}

function selectTab(id: string) {
  activeId.value = id;
  nextTick(() => {
    fitActive();
    instances.get(id)?.term.focus();
  });
}

watch(
  () => [props.visible, props.cwd] as const,
  async ([vis]) => {
    if (!vis) return;
    if (cwdTabs.value.length === 0) {
      await createTerminal();
      return;
    }
    await nextTick();
    requestAnimationFrame(() => {
      fitActive();
      if (activeId.value) instances.get(activeId.value)?.term.focus();
    });
  },
  { immediate: true },
);

watch(isDark, (dark) => {
  const th = termTheme(dark);
  for (const { term } of instances.values()) {
    term.options.theme = th;
  }
});

onMounted(() => {
  offOut = onTermOut((id, b64) => {
    const bytes = decodeBase64(b64);
    const inst = instances.get(id);
    if (inst) {
      inst.term.write(bytes);
    } else {
      const q = pendingChunks.get(id) ?? [];
      q.push(bytes);
      pendingChunks.set(id, q);
    }
  });
  offExit = onTermExit((id, exitCode) => {
    const tab = tabs.value.find((t) => t.id === id);
    if (tab) {
      tab.exited = true;
      tab.exitCode = exitCode;
    }
    instances.get(id)?.term.writeln(`\r\n\x1b[90m[进程已退出，状态码 ${exitCode}]\x1b[0m`);
  });
  if (stageRef.value && typeof ResizeObserver !== "undefined") {
    ro = new ResizeObserver(() => fitActive());
    ro.observe(stageRef.value);
  }
});

onBeforeUnmount(() => {
  offOut?.();
  offExit?.();
  ro?.disconnect();
  for (const [id, inst] of instances.entries()) {
    inst.term.dispose();
    void api.termClose(id).catch(() => {});
  }
  instances.clear();
});

defineExpose({ createTerminal });
</script>

<template>
  <div class="term-pane">
    <div class="term-bar">
      <div class="term-tabs">
        <button
          v-for="tab in cwdTabs"
          :key="tab.id"
          type="button"
          class="term-tab"
          :class="{ active: tab.id === activeId, exited: tab.exited }"
          @click="selectTab(tab.id)"
        >
          <span class="term-dot" :class="{ exited: tab.exited }" />
          <span class="term-title mono">{{ tab.title }}</span>
          <span class="term-close" title="关闭终端" @click.stop="closeTerminal(tab.id)">
            <CloseOutlined />
          </span>
        </button>
      </div>
      <div class="term-acts">
        <Tooltip title="清屏" :mouse-enter-delay="0.35">
          <button type="button" class="term-ic" :disabled="!activeId" @click="clearActive">
            <ClearOutlined />
          </button>
        </Tooltip>
        <Tooltip title="新建终端" :mouse-enter-delay="0.35">
          <button type="button" class="term-ic" :disabled="creating" @click="createTerminal">
            <PlusOutlined />
          </button>
        </Tooltip>
      </div>
    </div>

    <div ref="stageRef" class="term-stage">
      <div
        v-for="tab in tabs"
        :key="tab.id"
        v-show="tab.cwd === props.cwd && tab.id === activeId"
        :ref="(el) => setMountRef(tab.id, el)"
        class="term-mount"
      />
      <div v-if="cwdTabs.length === 0 && !creating" class="term-empty">
        <span class="faint">当前项目还没有打开终端</span>
        <button type="button" class="term-new-btn" @click="createTerminal">
          <PlusOutlined /> 新建终端
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.term-pane {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.term-bar {
  flex: none;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--border);
  background: var(--surface-2);
}

.term-tabs {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 4px;
  overflow-x: auto;
}

.term-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 24px;
  padding: 0 7px 0 8px;
  border-radius: 6px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-3);
  font-size: 11.5px;
  cursor: pointer;
  flex: none;
  transition: background 0.12s, color 0.12s, border-color 0.12s;
}
.term-tab:hover {
  background: var(--hover);
  color: var(--text-2);
}
.term-tab.active {
  background: var(--surface-strong);
  border-color: var(--border);
  color: var(--text);
}

.term-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--ok);
  flex: none;
}
.term-dot.exited {
  background: var(--text-3);
  opacity: 0.6;
}

.term-title {
  line-height: 1;
}

.term-close {
  display: inline-grid;
  place-items: center;
  width: 15px;
  height: 15px;
  border-radius: 4px;
  font-size: 9.5px;
  color: var(--text-3);
  opacity: 0.65;
  transition: background 0.12s, color 0.12s, opacity 0.12s;
}
.term-close:hover {
  opacity: 1;
  background: var(--active);
  color: var(--text);
}

.term-acts {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  flex: none;
}

.term-ic {
  display: inline-grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-3);
  cursor: pointer;
  font-size: 12.5px;
  transition: background 0.12s, color 0.12s;
}
.term-ic:hover:not(:disabled) {
  background: var(--hover);
  color: var(--text);
}
.term-ic:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.term-stage {
  flex: 1;
  min-height: 0;
  position: relative;
  background: #f8fafc;
  padding: 6px 8px;
  overflow: hidden;
}
:root[data-theme="dark"] .term-stage {
  background: #0d1017;
}

.term-mount {
  width: 100%;
  height: 100%;
}
.term-mount :deep(.xterm) {
  height: 100%;
}
.term-mount :deep(.xterm-viewport) {
  overflow-y: auto !important;
}

.term-empty {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  font-size: 12.5px;
}

.term-new-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  padding: 0 12px;
  border-radius: 8px;
  border: 1px solid var(--border-strong);
  background: var(--surface);
  color: var(--text);
  font-size: 12px;
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s;
}
.term-new-btn:hover {
  background: var(--surface-strong);
}
</style>

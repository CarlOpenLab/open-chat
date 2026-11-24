<script setup lang="ts">
import { ClearOutlined, CloseOutlined, PlusOutlined } from "@antdv-next/icons";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { Tooltip, message } from "antdv-next";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { ILink, ILinkProvider } from "@xterm/xterm";
import { api, inApp } from "../api";
import { isDark, onTermExit, onTermOut, openWorkspaceFile } from "../store";

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
/** Output from one push batch, merged so xterm parses it once. */
const writeQueues = new Map<string, Uint8Array[]>();
const writeScheduled = new Set<string>();
const lastWriteAt = new Map<string, number>();
/** Keystrokes waiting for the previous TermWrite call to finish. */
const inputQueues = new Map<string, string>();
const inputBusy = new Set<string>();
const inputScheduled = new Set<string>();
let seqByCwd: Record<string, number> = {};
let ro: ResizeObserver | null = null;
let fitTimer: number | null = null;
let lastStageW = 0;
let lastStageH = 0;
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

/** flushWrites hands everything queued for a terminal to xterm at once. */
function flushWrites(id: string) {
  writeScheduled.delete(id);
  const chunks = writeQueues.get(id);
  writeQueues.delete(id);
  if (!chunks?.length) return;
  const inst = instances.get(id);
  if (!inst) {
    const queued = pendingChunks.get(id) ?? [];
    for (const chunk of chunks) queued.push(chunk);
    pendingChunks.set(id, queued);
    return;
  }
  if (chunks.length === 1) {
    inst.term.write(chunks[0]);
    return;
  }
  let total = 0;
  for (const chunk of chunks) total += chunk.length;
  const all = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    all.set(chunk, offset);
    offset += chunk.length;
  }
  inst.term.write(all);
}

function queueWrite(id: string, bytes: Uint8Array) {
  const chunks = writeQueues.get(id);
  if (chunks) chunks.push(bytes);
  else writeQueues.set(id, [bytes]);
  if (writeScheduled.has(id)) return;
  writeScheduled.add(id);
  const now = performance.now();
  const prev = lastWriteAt.get(id) ?? 0;
  lastWriteAt.set(id, now);
  // Echo after a short quiet gap flushes immediately via microtask; rapid
  // output bursts coalesce onto the next animation frame so keyboard events
  // are never starved on the main thread.
  if (now - prev > 16) {
    queueMicrotask(() => flushWrites(id));
  } else {
    requestAnimationFrame(() => flushWrites(id));
  }
}

/**
 * queueInput serializes and coalesces keystrokes per terminal so fast typing
 * never races across IPC or drops characters on transient failures.
 */
function queueInput(id: string, data: string) {
  if (!data) return;
  inputQueues.set(id, (inputQueues.get(id) ?? "") + data);
  if (inputBusy.has(id) || inputScheduled.has(id)) return;
  inputScheduled.add(id);
  queueMicrotask(() => {
    inputScheduled.delete(id);
    if (!inputBusy.has(id) && inputQueues.has(id)) {
      void pumpInput(id);
    }
  });
}

async function pumpInput(id: string) {
  inputBusy.add(id);
  let retries = 0;
  try {
    for (;;) {
      const data = inputQueues.get(id);
      if (!data) break;
      inputQueues.delete(id);
      try {
        await api.termWrite(id, data);
        retries = 0;
      } catch {
        const tab = tabs.value.find((t) => t.id === id);
        if (!tab || tab.exited || !instances.has(id) || retries >= 2) {
          inputQueues.delete(id);
          break;
        }
        // Put unsent bytes back at the head and retry once after a brief yield.
        retries += 1;
        inputQueues.set(id, data + (inputQueues.get(id) ?? ""));
        await new Promise((resolve) => window.setTimeout(resolve, 16));
      }
    }
  } finally {
    inputBusy.delete(id);
    if (inputQueues.has(id) && instances.has(id)) {
      void pumpInput(id);
    }
  }
}

async function openLink(target: string, cwd: string) {
  try {
    if (openWorkspaceFile(target, cwd)) return;
    if (!inApp && /^https?:\/\//i.test(target)) {
      window.open(target, "_blank", "noopener");
      return;
    }
    await api.openLink(target, cwd);
  } catch (e) {
    message.error(e instanceof Error ? e.message : String(e));
  }
}

// URLs and absolute-ish paths (with optional :line[:col]) in terminal output.
const linkPattern = /(?:https?:\/\/|file:\/\/)[^\s"'<>]+|(?:~|\.{1,2})?\/[^\s"'<>]+(?::\d+(?::\d+)?)?/g;

/** terminalLinks makes URLs and paths in the scrollback clickable. */
function terminalLinks(term: Terminal, cwd: string): ILinkProvider {
  return {
    provideLinks(y, callback) {
      const line = term.buffer.active.getLine(y - 1);
      if (!line) {
        callback(undefined);
        return;
      }
      const text = line.translateToString(true);
      const links: ILink[] = [];
      linkPattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = linkPattern.exec(text))) {
        const value = match[0].replace(/[),.;:!?]+$/, "");
        if (!value) continue;
        const start = match.index;
        links.push({
          range: { start: { x: start + 1, y }, end: { x: start + value.length, y } },
          text: value,
          activate: (event, target) => {
            if (event.button !== 0) return;
            event.preventDefault();
            void openLink(target, cwd);
          },
        });
      }
      callback(links.length ? links : undefined);
    },
  };
}

/**
 * Works around xterm.js 6.0.0's `_keyDownSeen` gate bug on macOS WKWebView/Safari
 * (xtermjs/xterm.js#5887 & #5374): during rapid overlapping keystrokes or with
 * IMEs that report keyCode=229 even in English mode (e.g. Doubao / Baidu / macOS IME),
 * `input` (insertText) fires while `_keyDownSeen` is still true from the previous
 * key or a held modifier, causing xterm's `_inputEvent` to drop the character and
 * `CompositionHelper._handleAnyTextareaChanges` to see an empty diff.
 */
function patchXtermFastTyping(term: Terminal) {
  const core = (term as unknown as {
    _core?: {
      _keyDown?: (ev: KeyboardEvent) => boolean;
      _keyPress?: (ev: KeyboardEvent) => boolean;
      _inputEvent?: (ev: InputEvent) => boolean;
      _keyDownSeen?: boolean;
      _keyDownHandled?: boolean;
      _keyPressHandled?: boolean;
      _unprocessedDeadKey?: boolean;
      _compositionHelper?: { _isComposing?: boolean; _isSendingComposition?: boolean };
      optionsService?: { rawOptions?: { screenReaderMode?: boolean } };
      coreService?: { triggerDataEvent: (data: string, wasFromUserInput?: boolean) => void };
      textarea?: HTMLTextAreaElement;
      cancel?: (ev: Event, force?: boolean) => boolean;
    };
  })._core;
  if (!core || typeof core._inputEvent !== "function") return;

  const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta", "CapsLock"]);

  if (typeof core._keyDown === "function") {
    const origKeyDown = core._keyDown.bind(core);
    core._keyDown = (ev: KeyboardEvent) => {
      const res = origKeyDown(ev);
      if (MODIFIER_KEYS.has(ev.key)) {
        core._keyDownSeen = false;
      }
      return res;
    };
  }

  if (typeof core._keyPress === "function") {
    const origKeyPress = core._keyPress.bind(core);
    core._keyPress = (ev: KeyboardEvent) => {
      const res = origKeyPress(ev);
      if (core._keyPressHandled) {
        queueMicrotask(() => {
          core._keyPressHandled = false;
        });
      }
      return res;
    };
  }

  const origInputEvent = core._inputEvent.bind(core);
  core._inputEvent = (ev: InputEvent) => {
    const comp = core._compositionHelper;
    const isComposing = Boolean(ev.isComposing || comp?._isComposing || comp?._isSendingComposition);
    const screenReader = Boolean(core.optionsService?.rawOptions?.screenReaderMode);
    if (ev.data && ev.inputType === "insertText" && !isComposing && !screenReader) {
      if (core._keyPressHandled || core._keyDownHandled) {
        return false;
      }
      core._unprocessedDeadKey = false;
      core.coreService?.triggerDataEvent(ev.data, true);
      if (core.textarea) {
        core.textarea.value = "";
      }
      core.cancel?.(ev);
      return true;
    }
    return origInputEvent(ev);
  };
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
  if (term.textarea) {
    term.textarea.setAttribute("autocorrect", "off");
    term.textarea.setAttribute("autocapitalize", "off");
    term.textarea.setAttribute("autocomplete", "off");
    term.textarea.setAttribute("spellcheck", "false");
    term.textarea.spellcheck = false;
  }

  term.onData((data) => queueInput(id, data));
  term.onBinary((data) => queueInput(id, data));
  term.onResize(({ cols, rows }) => {
    void api.termResize(id, cols, rows).catch(() => {});
  });
  term.registerLinkProvider(terminalLinks(term, tabs.value.find((t) => t.id === id)?.cwd ?? props.cwd));

  patchXtermFastTyping(term);

  instances.set(id, { term, fit });

  const queued = pendingChunks.get(id);
  if (queued?.length) {
    for (const chunk of queued) term.write(chunk);
    pendingChunks.delete(id);
  }

  requestAnimationFrame(() => fitActive(true));
}

function fitActive(force = false) {
  if (!props.visible || !activeId.value) return;
  const stage = stageRef.value;
  if (stage) {
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    if (w <= 0 || h <= 0) return;
    if (!force && w === lastStageW && h === lastStageH) return;
    lastStageW = w;
    lastStageH = h;
  }
  const inst = instances.get(activeId.value);
  if (!inst) return;
  try {
    inst.fit.fit();
  } catch {
    /* ignore while hidden or zero-sized */
  }
}

function scheduleFit() {
  if (fitTimer !== null) window.clearTimeout(fitTimer);
  fitTimer = window.setTimeout(() => {
    fitTimer = null;
    fitActive(false);
  }, 60);
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
      fitActive(true);
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
  writeQueues.delete(id);
  writeScheduled.delete(id);
  lastWriteAt.delete(id);
  inputQueues.delete(id);
  inputScheduled.delete(id);
  if (target && activeByCwd.value[target.cwd] === id) {
    const next = tabs.value.find((t) => t.cwd === target.cwd);
    activeByCwd.value = { ...activeByCwd.value, [target.cwd]: next?.id ?? "" };
  }
  await api.termClose(id).catch(() => {});
  if (activeId.value) {
    requestAnimationFrame(() => {
      fitActive(true);
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
    fitActive(true);
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
      fitActive(true);
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
    queueWrite(id, decodeBase64(b64));
  });
  offExit = onTermExit((id, exitCode) => {
    const tab = tabs.value.find((t) => t.id === id);
    if (tab) {
      tab.exited = true;
      tab.exitCode = exitCode;
    }
    flushWrites(id);
    instances.get(id)?.term.writeln(`\r\n\x1b[90m[进程已退出，状态码 ${exitCode}]\x1b[0m`);
  });
  if (stageRef.value && typeof ResizeObserver !== "undefined") {
    ro = new ResizeObserver(() => scheduleFit());
    ro.observe(stageRef.value);
  }
});

onBeforeUnmount(() => {
  offOut?.();
  offExit?.();
  ro?.disconnect();
  if (fitTimer !== null) window.clearTimeout(fitTimer);
  writeScheduled.clear();
  writeQueues.clear();
  lastWriteAt.clear();
  inputQueues.clear();
  inputScheduled.clear();
  for (const [id, inst] of instances.entries()) {
    inst.term.dispose();
    void api.termClose(id).catch(() => {});
  }
  instances.clear();
});

defineExpose({ createTerminal });
</script>

<template>
  <div class="flex flex-col h-full min-h-0">
    <div class="flex-none flex items-center gap-[6px] px-2 py-[6px] border-0 border-b border-solid border-line bg-surface-2">
      <div class="flex-1 min-w-0 flex items-center gap-1 overflow-x-auto">
        <button
          v-for="tab in cwdTabs"
          :key="tab.id"
          type="button"
          class="inline-flex items-center gap-[6px] h-6 pl-2 pr-[7px] rounded-[6px] border border-solid text-[11.5px] cursor-pointer flex-none transition-colors duration-120"
          :class="
            tab.id === activeId
              ? 'bg-surface-strong border-line text-ink'
              : 'border-transparent bg-transparent text-ink-3 hover:bg-hover hover:text-ink-2'
          "
          @click="selectTab(tab.id)"
        >
          <span
            class="w-[5px] h-[5px] rounded-full flex-none"
            :class="tab.exited ? 'bg-ink-3 opacity-60' : 'bg-ok'"
          />
          <span class="leading-none font-mono">{{ tab.title }}</span>
          <span
            class="inline-grid place-items-center w-[15px] h-[15px] rounded-[4px] text-[9.5px] text-ink-3 opacity-65 transition-all duration-120 hover:opacity-100 hover:bg-active hover:text-ink"
            title="关闭终端"
            @click.stop="closeTerminal(tab.id)"
          >
            <CloseOutlined />
          </span>
        </button>
      </div>
      <div class="inline-flex items-center gap-[2px] flex-none">
        <Tooltip title="清屏" :mouse-enter-delay="0.35">
          <button
            type="button"
            class="inline-grid place-items-center w-6 h-6 border-0 rounded-[6px] bg-transparent text-ink-3 cursor-pointer text-[12.5px] transition-colors duration-120 hover:not-disabled:bg-hover hover:not-disabled:text-ink disabled:opacity-40 disabled:cursor-not-allowed"
            :disabled="!activeId"
            @click="clearActive"
          >
            <ClearOutlined />
          </button>
        </Tooltip>
        <Tooltip title="新建终端" :mouse-enter-delay="0.35">
          <button
            type="button"
            class="inline-grid place-items-center w-6 h-6 border-0 rounded-[6px] bg-transparent text-ink-3 cursor-pointer text-[12.5px] transition-colors duration-120 hover:not-disabled:bg-hover hover:not-disabled:text-ink disabled:opacity-40 disabled:cursor-not-allowed"
            :disabled="creating"
            @click="createTerminal"
          >
            <PlusOutlined />
          </button>
        </Tooltip>
      </div>
    </div>

    <div ref="stageRef" class="flex-1 min-h-0 relative bg-term px-2 py-[6px] overflow-hidden">
      <div
        v-for="tab in tabs"
        :key="tab.id"
        v-show="tab.cwd === props.cwd && tab.id === activeId"
        :ref="(el) => setMountRef(tab.id, el)"
        class="oc-term-mount w-full h-full"
      />
      <div v-if="cwdTabs.length === 0 && !creating" class="absolute inset-0 flex flex-col items-center justify-center gap-[10px] text-[12.5px]">
        <span class="text-ink-3">当前项目还没有打开终端</span>
        <button
          type="button"
          class="inline-flex items-center gap-[5px] h-7 px-3 rounded-[8px] border border-solid border-line-strong bg-surface text-ink text-[12px] cursor-pointer transition-colors duration-120 hover:bg-surface-strong"
          @click="createTerminal"
        >
          <PlusOutlined /> 新建终端
        </button>
      </div>
    </div>
  </div>
</template>

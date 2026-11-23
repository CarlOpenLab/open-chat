<script setup lang="ts">
import { App as AntApp, ConfigProvider, message } from "antdv-next";
import { XProvider } from "@antdv-next/x";
import { XProProvider, zhCN as xProZhCN } from "@antdv-next/x-pro";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import AppSidebar from "./components/AppSidebar.vue";
import ChatView from "./components/ChatView.vue";
import NewChat from "./components/NewChat.vue";
import SettingsDialog from "./components/SettingsDialog.vue";
import { api, inApp } from "./api";
import { activeMeta, init, isDark, newConversation, store } from "./store";
import { antdThemeFor } from "./theme";

const theme = computed(() => antdThemeFor(isDark.value));

const mod = navigator.platform.includes("Mac") ? (e: KeyboardEvent) => e.metaKey : (e: KeyboardEvent) => e.ctrlKey;

function onKey(e: KeyboardEvent) {
  if (!mod(e)) return;
  const key = e.key.toLowerCase();
  if (key === "n") {
    e.preventDefault();
    newConversation();
  } else if (key === "k") {
    e.preventDefault();
    store.sidebarCollapsed = false;
    requestAnimationFrame(() => document.getElementById("conv-search")?.focus());
  } else if (key === "b") {
    e.preventDefault();
    store.sidebarCollapsed = !store.sidebarCollapsed;
  } else if (key === "j") {
    e.preventDefault();
    store.workspaceOpen = !store.workspaceOpen;
  } else if (key === ",") {
    e.preventDefault();
    store.settingsOpen = true;
  }
}

// Custom acrylic context menu (prevents raw WKWebView Reload / Inspect Element menu;
// hold Shift + Right-Click anytime to open native Inspect Element).
const ctxMenu = ref<{
  open: boolean;
  x: number;
  y: number;
  selectedText: string;
  target: HTMLInputElement | HTMLTextAreaElement | null;
}>({ open: false, x: 0, y: 0, selectedText: "", target: null });

function closeCtxMenu() {
  if (ctxMenu.value.open) ctxMenu.value.open = false;
}

function onContextMenu(e: MouseEvent) {
  if (e.shiftKey) return;
  e.preventDefault();
  const targetEl = e.target as HTMLElement | null;
  const editable =
    targetEl instanceof HTMLInputElement || targetEl instanceof HTMLTextAreaElement ? targetEl : null;
  const selectedText = window.getSelection()?.toString() ?? "";
  if (!selectedText && !editable) {
    closeCtxMenu();
    return;
  }
  const menuW = 148;
  const menuH = editable ? 116 : 44;
  const x = Math.min(e.clientX, window.innerWidth - menuW - 8);
  const y = Math.min(e.clientY, window.innerHeight - menuH - 8);
  ctxMenu.value = { open: true, x, y, selectedText, target: editable };
}

async function ctxCopy() {
  const txt = ctxMenu.value.selectedText;
  closeCtxMenu();
  if (!txt) return;
  try {
    await navigator.clipboard.writeText(txt);
    message.success("已复制");
  } catch {
    document.execCommand("copy");
  }
}

async function ctxPaste() {
  const el = ctxMenu.value.target;
  closeCtxMenu();
  if (!el) return;
  try {
    const clip = await navigator.clipboard.readText();
    if (!clip) return;
    el.focus();
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    el.setRangeText(clip, start, end, "end");
    el.dispatchEvent(new Event("input", { bubbles: true }));
  } catch {
    document.execCommand("paste");
  }
}

function ctxSelectAll() {
  const el = ctxMenu.value.target;
  closeCtxMenu();
  if (el) {
    el.focus();
    el.select();
  }
}

// Links in the transcript (and anywhere else) go through the host: http(s)
// opens the browser, paths open their location in the file manager. In a
// browser the page's own handling is already right.
function onLinkClick(e: MouseEvent) {
  if (!inApp) return;
  const anchor = e.target instanceof Element ? e.target.closest("a[href]") : null;
  const href = anchor?.getAttribute("href") ?? "";
  if (!href || href.startsWith("#")) return;
  e.preventDefault();
  e.stopPropagation();
  void api
    .openLink(href, activeMeta.value?.cwd ?? "")
    .catch((err) => message.error(err instanceof Error ? err.message : String(err)));
}

onMounted(() => {
  window.addEventListener("keydown", onKey);
  window.addEventListener("click", onLinkClick, true);
  window.addEventListener("pointerdown", closeCtxMenu);
  window.addEventListener("blur", closeCtxMenu);
  void init();
});
onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKey);
  window.removeEventListener("click", onLinkClick, true);
  window.removeEventListener("pointerdown", closeCtxMenu);
  window.removeEventListener("blur", closeCtxMenu);
});
</script>

<template>
  <ConfigProvider :theme="theme">
    <XProvider :theme="theme">
      <XProProvider :theme="theme" :locale="xProZhCN">
        <AntApp>
          <div class="shell" :class="{ dark: isDark }" @contextmenu="onContextMenu">
            <!-- Subtle Beacon-style ambient light layer refracted through acrylic panels -->
            <div class="ambient" aria-hidden="true">
              <span class="orb orb-1" />
              <span class="orb orb-2" />
              <span class="orb orb-3" />
            </div>

            <div v-if="!store.ready" class="boot">
              <div class="boot-mark" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none">
                  <rect x="3" y="4" width="18" height="14" rx="4" stroke="currentColor" stroke-width="2" />
                  <path d="M8 10h8M8 14h5" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
                  <path d="M9 18l-2 3v-3" fill="currentColor" />
                </svg>
              </div>
              <p v-if="store.bootError" class="boot-error selectable">{{ store.bootError }}</p>
              <p v-else class="faint boot-tip">正在准备你的工作台…</p>
            </div>
            <template v-else>
              <div class="sidebar-slot" :class="{ collapsed: store.sidebarCollapsed }">
                <AppSidebar />
              </div>
              <main class="main">
                <ChatView v-if="store.activeId && store.metas[store.activeId]" />
                <NewChat v-else />
              </main>
              <SettingsDialog v-model:open="store.settingsOpen" />
            </template>

            <div
              v-if="ctxMenu.open"
              class="ctx-menu"
              :style="{ left: `${ctxMenu.x}px`, top: `${ctxMenu.y}px` }"
              @pointerdown.stop
            >
              <button v-if="ctxMenu.selectedText" class="ctx-item" @click="ctxCopy">复制</button>
              <button v-if="ctxMenu.target" class="ctx-item" @click="ctxPaste">粘贴</button>
              <button v-if="ctxMenu.target" class="ctx-item" @click="ctxSelectAll">全选</button>
            </div>
          </div>
        </AntApp>
      </XProProvider>
    </XProvider>
  </ConfigProvider>
</template>

<style scoped>
.shell {
  display: flex;
  height: 100dvh;
  overflow: hidden;
  position: relative;
  background: var(--bg);
}

.ambient {
  position: fixed;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
  z-index: 0;
}

.orb {
  position: absolute;
  border-radius: 50%;
  filter: blur(95px);
  will-change: transform;
}

/* Light mode: cool pearl-sky + subtle lavender + warm sunlight refraction */
.orb-1 {
  width: 560px;
  height: 560px;
  top: -180px;
  left: -100px;
  background: rgba(125, 179, 255, 0.32);
}
.orb-2 {
  width: 520px;
  height: 520px;
  top: 12%;
  right: -140px;
  background: rgba(186, 168, 255, 0.24);
}
.orb-3 {
  width: 480px;
  height: 480px;
  bottom: -200px;
  left: 34%;
  background: rgba(125, 224, 212, 0.2);
}

/* Dark mode: deep Nordic sapphire + subtle indigo + muted cyan glow */
.shell.dark .orb-1 {
  background: rgba(56, 139, 253, 0.14);
}
.shell.dark .orb-2 {
  background: rgba(129, 140, 248, 0.12);
}
.shell.dark .orb-3 {
  background: rgba(20, 184, 166, 0.085);
}

.sidebar-slot {
  width: 262px;
  flex: none;
  height: 100%;
  overflow: hidden;
  position: relative;
  z-index: 2;
  transition: width 0.24s var(--ease), opacity 0.2s var(--ease);
}
.sidebar-slot.collapsed {
  width: 0;
  opacity: 0;
  pointer-events: none;
}

.main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  position: relative;
  z-index: 1;
  background: transparent;
}

.boot {
  flex: 1;
  position: relative;
  z-index: 1;
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 12px;
}

.boot-mark {
  width: 42px;
  height: 42px;
  border-radius: 12px;
  display: grid;
  place-items: center;
  background: var(--surface);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border: 1px solid var(--border-strong);
  box-shadow: var(--shadow-card);
  color: var(--text);
  animation: oc-pulse 1.6s ease-in-out infinite;
}

.boot-mark svg {
  width: 20px;
  height: 20px;
}

.boot-tip {
  font-size: 13px;
  margin: 0;
}

.boot-error {
  max-width: 460px;
  font-size: 13px;
  color: var(--err);
  text-align: center;
  margin: 0;
}

.ctx-menu {
  position: fixed;
  z-index: 2000;
  min-width: 132px;
  padding: 5px;
  border-radius: 11px;
  background: var(--surface-strong);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border: 1px solid var(--border-strong);
  box-shadow: var(--shadow-pop);
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.ctx-item {
  width: 100%;
  border: none;
  background: transparent;
  color: var(--text);
  font-size: 12.5px;
  text-align: left;
  padding: 6px 10px;
  border-radius: 7px;
  cursor: pointer;
  transition: background 0.12s;
}
.ctx-item:hover {
  background: var(--hover);
}
</style>

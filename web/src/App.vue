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
import { activeMeta, init, isDark, newConversation, openWorkspaceFile, store } from "./store";
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

// Links in the transcript (and anywhere else): files inside the active
// workspace open directly in the right-hand file tree; web links and external
// paths go through the host (browser / file manager).
function onLinkClick(e: MouseEvent) {
  const anchor = e.target instanceof Element ? e.target.closest("a[href]") : null;
  const href = anchor?.getAttribute("href") ?? "";
  if (!href || href.startsWith("#")) return;
  const cwd = activeMeta.value?.cwd ?? "";
  if (cwd && openWorkspaceFile(href, cwd)) {
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  if (!inApp) return;
  e.preventDefault();
  e.stopPropagation();
  void api
    .openLink(href, cwd)
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
          <div class="flex h-100dvh overflow-hidden relative bg-bg" @contextmenu="onContextMenu">
            <!-- Subtle Beacon-style ambient light layer refracted through acrylic panels -->
            <div class="fixed inset-0 pointer-events-none overflow-hidden z-0" aria-hidden="true">
              <span
                class="absolute rounded-full blur-[95px] will-change-transform w-[560px] h-[560px] -top-[180px] -left-[100px]"
                :class="isDark ? 'bg-[rgba(56,139,253,0.14)]' : 'bg-[rgba(125,179,255,0.32)]'"
              />
              <span
                class="absolute rounded-full blur-[95px] will-change-transform w-[520px] h-[520px] top-[12%] -right-[140px]"
                :class="isDark ? 'bg-[rgba(129,140,248,0.12)]' : 'bg-[rgba(186,168,255,0.24)]'"
              />
              <span
                class="absolute rounded-full blur-[95px] will-change-transform w-[480px] h-[480px] -bottom-[200px] left-[34%]"
                :class="isDark ? 'bg-[rgba(20,184,166,0.085)]' : 'bg-[rgba(125,224,212,0.2)]'"
              />
            </div>

            <div v-if="!store.ready" class="flex-1 relative z-1 grid place-content-center justify-items-center gap-3">
              <div
                class="w-[42px] h-[42px] rounded-[12px] grid place-items-center bg-surface glass border border-solid border-line-strong shadow-card text-ink animate-oc-pulse"
                aria-hidden="true"
              >
                <svg viewBox="0 0 24 24" fill="none" class="w-5 h-5">
                  <rect x="3" y="4" width="18" height="14" rx="4" stroke="currentColor" stroke-width="2" />
                  <path d="M8 10h8M8 14h5" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
                  <path d="M9 18l-2 3v-3" fill="currentColor" />
                </svg>
              </div>
              <p v-if="store.bootError" class="max-w-[460px] text-[13px] text-err text-center m-0 selectable">{{ store.bootError }}</p>
              <p v-else class="text-ink-3 text-[13px] m-0">正在准备你的工作台…</p>
            </div>
            <template v-else>
              <div
                class="oc-sidebar-slot flex-none h-full overflow-hidden relative z-2 glass border-0 border-r border-solid transition-[width,background-color,border-color] ease-oc"
                :class="
                  store.sidebarCollapsed
                    ? 'is-collapsed w-0 bg-transparent border-r-transparent pointer-events-none duration-220'
                    : 'w-[262px] bg-sidebar border-r-line duration-240'
                "
              >
                <AppSidebar />
              </div>
              <main class="flex-1 min-w-0 flex flex-col relative z-1 bg-transparent">
                <ChatView v-if="store.activeId && store.metas[store.activeId]" />
                <NewChat v-else />
              </main>
              <SettingsDialog v-model:open="store.settingsOpen" />
            </template>

            <div
              v-if="ctxMenu.open"
              class="fixed z-[2000] min-w-[132px] p-[5px] rounded-[11px] bg-surface-strong glass border border-solid border-line-strong shadow-pop flex flex-col gap-[2px]"
              :style="{ left: `${ctxMenu.x}px`, top: `${ctxMenu.y}px` }"
              @pointerdown.stop
            >
              <button
                v-if="ctxMenu.selectedText"
                class="w-full border-0 bg-transparent text-ink text-[12.5px] text-left px-[10px] py-[6px] rounded-[7px] cursor-pointer transition-colors duration-120 hover:bg-hover"
                @click="ctxCopy"
              >
                复制
              </button>
              <button
                v-if="ctxMenu.target"
                class="w-full border-0 bg-transparent text-ink text-[12.5px] text-left px-[10px] py-[6px] rounded-[7px] cursor-pointer transition-colors duration-120 hover:bg-hover"
                @click="ctxPaste"
              >
                粘贴
              </button>
              <button
                v-if="ctxMenu.target"
                class="w-full border-0 bg-transparent text-ink text-[12.5px] text-left px-[10px] py-[6px] rounded-[7px] cursor-pointer transition-colors duration-120 hover:bg-hover"
                @click="ctxSelectAll"
              >
                全选
              </button>
            </div>
          </div>
        </AntApp>
      </XProProvider>
    </XProvider>
  </ConfigProvider>
</template>

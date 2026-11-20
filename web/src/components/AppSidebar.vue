<script setup lang="ts">
import { Conversations } from "@antdv-next/x";
import type { ConversationItemType } from "@antdv-next/x";
import {
  ArrowLeftOutlined,
  DeleteOutlined,
  EditOutlined,
  InboxOutlined,
  MenuFoldOutlined,
  MessageOutlined,
  PushpinFilled,
  PushpinOutlined,
  RollbackOutlined,
} from "@antdv-next/icons";
import { Dropdown, Input, Modal, Tooltip, message } from "antdv-next";
import { computed, h, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { isArchived, isDark, isMac, newConversation, pin, remove, rename, saveSettings, select, setArchived, setUserAvatar, sortedMetas, store } from "../store";
import type { Meta } from "../types";
import ProviderIcon from "./ProviderIcon.vue";

const renaming = ref<Meta | null>(null);
const newTitle = ref("");
const renameInput = ref<{ focus: () => void } | null>(null);
const toDelete = ref<Meta | null>(null);
const avatarInput = ref<HTMLInputElement | null>(null);
const showArchived = ref(false);

const convCtx = ref<{ open: boolean; x: number; y: number; meta: Meta | null }>({
  open: false,
  x: 0,
  y: 0,
  meta: null,
});

function closeConvCtx() {
  if (convCtx.value.open) convCtx.value.open = false;
}

function onListContextMenu(e: MouseEvent) {
  if (e.shiftKey) return;
  const target = e.target as HTMLElement | null;
  const itemEl = target?.closest(".antd-conversations-item");
  const id = itemEl?.querySelector<HTMLElement>("[data-conv-id]")?.dataset.convId;
  if (!id) return;
  const m = filtered.value.find((x) => x.id === id);
  if (!m) return;
  e.preventDefault();
  e.stopPropagation();
  const menuW = 152;
  const menuH = isArchived(m.id) ? 128 : 160;
  convCtx.value = {
    open: true,
    x: Math.min(e.clientX, window.innerWidth - menuW - 8),
    y: Math.min(e.clientY, window.innerHeight - menuH - 8),
    meta: m,
  };
}

function onConvCtxAction(action: "pin" | "rename" | "archive" | "delete") {
  const m = convCtx.value.meta;
  closeConvCtx();
  if (!m) return;
  if (action === "pin") void pin(m.id, !m.pinned);
  if (action === "rename") void startRename(m);
  if (action === "archive") void toggleArchive(m);
  if (action === "delete") toDelete.value = m;
}

function onCtxKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") closeConvCtx();
}

onMounted(() => {
  window.addEventListener("pointerdown", closeConvCtx);
  window.addEventListener("blur", closeConvCtx);
  window.addEventListener("keydown", onCtxKeydown);
});
onBeforeUnmount(() => {
  window.removeEventListener("pointerdown", closeConvCtx);
  window.removeEventListener("blur", closeConvCtx);
  window.removeEventListener("keydown", onCtxKeydown);
});

const groupRank = (m: Meta) => {
  if (m.pinned) return 0;
  const d = new Date(m.updatedAt);
  const today = new Date();
  const day = 86_400_000;
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  if (d.getTime() >= startOfToday) return 1;
  if (d.getTime() >= startOfToday - day) return 2;
  if (d.getTime() >= startOfToday - 7 * day) return 3;
  return 4;
};
const groupName = (m: Meta) => ["置顶", "今天", "昨天", "近 7 天", "更早"][groupRank(m)];

const archivedCount = computed(() => sortedMetas.value.filter((m) => isArchived(m.id)).length);

const filtered = computed(() => {
  const q = store.search.trim().toLowerCase();
  return sortedMetas.value
    .filter((m) => (showArchived.value ? isArchived(m.id) : !isArchived(m.id)))
    .filter((m) => !q || m.title.toLowerCase().includes(q) || m.cwd.toLowerCase().includes(q) || m.agentName.toLowerCase().includes(q))
    .sort((a, b) => groupRank(a) - groupRank(b) || b.updatedAt - a.updatedAt);
});

const items = computed<ConversationItemType[]>(() =>
  filtered.value.map((m) => ({
    key: m.id,
    label: m.title,
    group: showArchived.value ? "已归档" : groupName(m),
    "data-meta": m,
  })),
);

function ago(t: number) {
  const s = Math.max(1, Math.round((Date.now() - t) / 1000));
  if (s < 60) return "刚刚";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d`;
  return new Date(t).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

function shortDir(cwd: string) {
  const home = store.boot?.home;
  if (home && cwd === home) return "~";
  return cwd.split("/").filter(Boolean).pop() || cwd;
}

function statusNodeFor(m: Meta) {
  const status = store.lives[m.id]?.status ?? m.status;
  const outcome = store.turnOutcome[m.id];

  // 1. Need you: waiting for user confirmation (highest priority)
  if ((m.pending ?? 0) > 0) {
    return h("span", { class: "st-pill need", title: "需要你的确认" }, [
      h("i", { class: "st-dot" }),
      "待确认",
    ]);
  }
  // 2. Running / connecting
  if (status === "running" || status === "connecting") {
    return h("span", { class: "st-pill run", title: status === "connecting" ? "连接中" : "运行中" }, [
      h("i", { class: "st-spin" }),
      status === "connecting" ? "连接中" : "运行中",
    ]);
  }
  // 3. Error
  if (status === "error" || outcome === "error") {
    return h("span", { class: "st-pill err", title: "执行出错" }, "失败");
  }
  // 4. Newly completed in background (unseen success)
  if (outcome === "unseen") {
    return h("span", { class: "st-pill ok", title: "任务已完成" }, [
      h("svg", { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "2.4", "stroke-linecap": "round", "stroke-linejoin": "round", class: "st-check" }, [
        h("polyline", { points: "20 6 9 17 4 12" }),
      ]),
      "已完成",
    ]);
  }
  // 5. Completed / ready conversation with replies (subtle quiet check)
  if (outcome === "done" || Boolean(m.preview)) {
    return h("span", { class: "st-done-ic", title: "已完成" }, [
      h("svg", { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "2.2", "stroke-linecap": "round", "stroke-linejoin": "round", class: "st-check" }, [
        h("polyline", { points: "20 6 9 17 4 12" }),
      ]),
    ]);
  }
  return null;
}

function labelRender(item: ConversationItemType) {
  const m = (item as unknown as { "data-meta": Meta })["data-meta"];
  return h("div", { class: "conv", "data-conv-id": m.id }, [
    h("div", { class: "conv-row" }, [
      h(ProviderIcon, { id: m.agentId, name: m.agentName, size: 13, class: "conv-logo" }),
      h("span", { class: "conv-title" }, m.title || "新对话"),
      statusNodeFor(m),
    ]),
    h("div", { class: "conv-meta" }, [
      h("span", { class: "conv-sub" }, [
        h("span", { class: "conv-agent" }, m.agentName),
        m.cwd ? h("span", { class: "conv-sep" }, "·") : null,
        m.cwd ? h("span", { class: "conv-dir mono" }, shortDir(m.cwd)) : null,
      ]),
      h("span", { class: "conv-time mono" }, ago(m.updatedAt)),
    ]),
  ]);
}

async function toggleArchive(m: Meta) {
  const next = !isArchived(m.id);
  try {
    await setArchived(m.id, next);
  } catch (e) {
    message.error(e instanceof Error ? e.message : String(e));
    return;
  }
  if (next && store.activeId === m.id && !showArchived.value) {
    void select(null);
  }
  if (!next && showArchived.value && archivedCount.value === 0) {
    showArchived.value = false;
  }
  message.success(next ? "已归档" : "已恢复到对话列表");
}

function menuFor(value: ConversationItemType) {
  const m = (value as unknown as { "data-meta": Meta })["data-meta"];
  const archived = isArchived(m.id);
  const item = (key: string, icon: () => unknown, label: string, danger = false) => ({
    key,
    danger,
    label: h("span", { class: "menu-item" }, [h("span" as never, { class: "menu-icon" }, [icon() as never]), label]),
  });
  return {
    items: [
      ...(archived ? [] : [item("pin", () => (m.pinned ? h(PushpinFilled) : h(PushpinOutlined)), m.pinned ? "取消置顶" : "置顶")]),
      item("rename", () => h(EditOutlined), "重命名"),
      item("archive", () => (archived ? h(RollbackOutlined) : h(InboxOutlined)), archived ? "取消归档" : "归档"),
      { type: "divider" as const },
      item("delete", () => h(DeleteOutlined), "删除对话", true),
    ],
    onClick: ({ key }: { key: string }) => {
      if (key === "pin") void pin(m.id, !m.pinned);
      if (key === "rename") void startRename(m);
      if (key === "archive") void toggleArchive(m);
      if (key === "delete") toDelete.value = m;
    },
  };
}

async function startRename(m: Meta) {
  renaming.value = m;
  newTitle.value = m.title;
  await nextTick();
  renameInput.value?.focus();
}

async function confirmRename() {
  const m = renaming.value;
  renaming.value = null;
  if (m && newTitle.value.trim() && newTitle.value.trim() !== m.title) {
    await rename(m.id, newTitle.value.trim());
  }
}

async function confirmDelete() {
  const m = toDelete.value;
  toDelete.value = null;
  if (!m) return;
  await remove(m.id);
  message.success("已删除");
}

function toggleTheme() {
  void saveSettings({ theme: isDark.value ? "light" : "dark" });
}

function triggerAvatarUpload() {
  avatarInput.value?.click();
}

async function onAvatarPick(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    message.error("请选择图片文件");
    return;
  }
  try {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new window.Image();
        img.onload = () => {
          const size = 160;
          const canvas = document.createElement("canvas");
          canvas.width = size;
          canvas.height = size;
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            resolve(String(reader.result));
            return;
          }
          const side = Math.min(img.width, img.height);
          const sx = (img.width - side) / 2;
          const sy = (img.height - side) / 2;
          ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
          resolve(canvas.toDataURL("image/webp", 0.9));
        };
        img.onerror = reject;
        img.src = String(reader.result);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    setUserAvatar(dataUrl);
    message.success("头像已保存到本地");
  } catch {
    message.error("读取头像图片失败");
  }
}

const avatarMenu = computed(() => ({
  items: [
    { key: "upload", label: store.userAvatar ? "更换本地头像" : "上传本地头像" },
    ...(store.userAvatar ? [{ key: "reset", label: "恢复默认头像", danger: true }] : []),
  ],
  onClick: ({ key }: { key: string }) => {
    if (key === "upload") triggerAvatarUpload();
    if (key === "reset") {
      setUserAvatar("");
      message.success("已恢复默认头像");
    }
  },
}));

const needsNode = computed(() => Boolean(store.boot?.nodeError));
</script>

<template>
  <aside class="sidebar" :class="{ mac: isMac }">
    <div class="top drag">
      <div class="top-spacer" />
      <div class="top-actions no-drag">
        <Tooltip :title="`收起侧栏 (${isMac ? '⌘' : 'Ctrl'} B)`" :mouse-enter-delay="0.4">
          <button class="icon-btn" @click="store.sidebarCollapsed = true">
            <MenuFoldOutlined />
          </button>
        </Tooltip>
      </div>
    </div>

    <div class="controls">
      <button class="new-btn" @click="newConversation()">
        <!-- Lucide SquarePen -->
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round" class="new-ic">
          <path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
          <path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z" />
        </svg>
        <span>新对话</span>
        <span class="hint kbd">{{ isMac ? "⌘" : "Ctrl" }} N</span>
      </button>

      <label class="search-box" for="conv-search">
        <!-- Lucide Search -->
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round" class="search-ic">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          id="conv-search"
          v-model="store.search"
          type="text"
          class="search-input"
          placeholder="搜索对话…"
          @keydown.esc="store.search = ''"
        />
        <button v-if="store.search" type="button" class="search-clear" aria-label="清空搜索" @click.prevent="store.search = ''">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
        <span v-else class="search-kbd kbd">{{ isMac ? "⌘" : "Ctrl" }} K</span>
      </label>
    </div>

    <div v-if="showArchived" class="archive-bar">
      <button class="archive-back" @click="showArchived = false">
        <ArrowLeftOutlined />
        <span>返回对话</span>
      </button>
      <span class="archive-count mono">{{ archivedCount }}</span>
    </div>

    <div class="list" @contextmenu="onListContextMenu" @scroll="closeConvCtx">
      <Conversations
        v-if="items.length"
        :items="items"
        :active-key="store.activeId ?? undefined"
        :label-render="labelRender"
        :menu="menuFor"
        :groupable="{ label: (g: string) => g, collapsible: false }"
        class="convs"
        @active-change="(key: string) => select(key)"
      />
      <div v-else class="list-empty">
        <InboxOutlined v-if="showArchived" class="empty-icon" />
        <MessageOutlined v-else class="empty-icon" />
        <div class="empty-text">
          {{ store.search ? "没有匹配的对话" : showArchived ? "还没有归档的对话" : "还没有对话记录" }}
        </div>
        <button v-if="store.search" class="empty-btn" @click="store.search = ''">清空搜索</button>
      </div>
    </div>

    <div v-if="!showArchived && archivedCount > 0" class="archive-entry">
      <button class="archive-entry-btn" @click="showArchived = true">
        <InboxOutlined class="archive-ic" />
        <span>已归档</span>
        <span class="archive-count mono">{{ archivedCount }}</span>
      </button>
    </div>

    <div class="foot">
      <button v-if="needsNode" class="warn" @click="store.settingsOpen = true">
        <span class="dot error" />
        <span>未检测到 Node.js</span>
      </button>
      <div class="foot-row">
        <Dropdown :menu="avatarMenu" :trigger="['click']" placement="topLeft">
          <Tooltip :title="store.userAvatar ? '点击更换或重置本地头像' : '上传本地头像（仅保存在本机）'" :mouse-enter-delay="0.35">
            <button class="avatar-btn" aria-label="用户头像">
              <img v-if="store.userAvatar" :src="store.userAvatar" alt="用户头像" />
              <!-- Lucide User -->
              <svg
                v-else
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
                class="avatar-ic"
              >
                <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
              <span class="avatar-cam" aria-hidden="true">
                <!-- Lucide Camera -->
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
                  <circle cx="12" cy="13" r="3" />
                </svg>
              </span>
            </button>
          </Tooltip>
        </Dropdown>
        <input ref="avatarInput" type="file" accept="image/*" hidden @change="onAvatarPick" />

        <span class="foot-spacer" />

        <Tooltip :title="`设置 (${isMac ? '⌘' : 'Ctrl'} ,)`" :mouse-enter-delay="0.35">
          <button class="icon-btn theme-btn" aria-label="设置" @click="store.settingsOpen = true">
            <!-- Lucide Settings -->
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.85"
              stroke-linecap="round"
              stroke-linejoin="round"
              class="theme-ic"
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.6.85 1 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        </Tooltip>

        <Tooltip :title="isDark ? '切换到浅色模式' : '切换到深色模式'" :mouse-enter-delay="0.35">
          <button class="icon-btn theme-btn" :class="{ dark: isDark }" aria-label="切换主题" @click="toggleTheme">
            <!-- Lucide Sun (shown in dark mode) -->
            <svg
              v-if="isDark"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.85"
              stroke-linecap="round"
              stroke-linejoin="round"
              class="theme-ic"
            >
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2" />
              <path d="M12 20v2" />
              <path d="m4.93 4.93 1.41 1.41" />
              <path d="m17.66 17.66 1.41 1.41" />
              <path d="M2 12h2" />
              <path d="M20 12h2" />
              <path d="m6.34 17.66-1.41 1.41" />
              <path d="m19.07 4.93-1.41 1.41" />
            </svg>
            <!-- Lucide Moon (shown in light mode) -->
            <svg
              v-else
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.85"
              stroke-linecap="round"
              stroke-linejoin="round"
              class="theme-ic"
            >
              <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
            </svg>
          </button>
        </Tooltip>
      </div>
    </div>

    <Modal
      :open="Boolean(renaming)"
      title="重命名对话"
      :width="380"
      centered
      ok-text="保存"
      cancel-text="取消"
      @ok="confirmRename"
      @cancel="renaming = null"
    >
      <Input ref="renameInput" v-model:value="newTitle" :maxlength="60" @press-enter="confirmRename" />
    </Modal>
    <Modal
      :open="Boolean(toDelete)"
      title="删除这个对话？"
      :width="380"
      centered
      ok-text="删除"
      ok-type="danger"
      cancel-text="取消"
      @ok="confirmDelete"
      @cancel="toDelete = null"
    >
      <p class="muted" style="margin: 0">
        「{{ toDelete?.title }}」的记录会从本机删除，无法恢复。agent 那边的会话不受影响。
      </p>
    </Modal>

    <Teleport to="body">
      <div
        v-if="convCtx.open && convCtx.meta"
        class="sb-ctx-menu"
        :style="{ left: `${convCtx.x}px`, top: `${convCtx.y}px` }"
        @pointerdown.stop
        @contextmenu.prevent
      >
        <button v-if="!isArchived(convCtx.meta.id)" class="sb-ctx-item" @click="onConvCtxAction('pin')">
          <PushpinFilled v-if="convCtx.meta.pinned" class="sb-ctx-ic" />
          <PushpinOutlined v-else class="sb-ctx-ic" />
          <span>{{ convCtx.meta.pinned ? '取消置顶' : '置顶' }}</span>
        </button>
        <button class="sb-ctx-item" @click="onConvCtxAction('rename')">
          <EditOutlined class="sb-ctx-ic" />
          <span>重命名</span>
        </button>
        <button class="sb-ctx-item" @click="onConvCtxAction('archive')">
          <RollbackOutlined v-if="isArchived(convCtx.meta.id)" class="sb-ctx-ic" />
          <InboxOutlined v-else class="sb-ctx-ic" />
          <span>{{ isArchived(convCtx.meta.id) ? '取消归档' : '归档' }}</span>
        </button>
        <div class="sb-ctx-div" />
        <button class="sb-ctx-item danger" @click="onConvCtxAction('delete')">
          <DeleteOutlined class="sb-ctx-ic" />
          <span>删除对话</span>
        </button>
      </div>
    </Teleport>
  </aside>
</template>

<style scoped>
.sidebar {
  width: 262px;
  height: 100%;
  flex: none;
  display: flex;
  flex-direction: column;
  position: relative;
  background: var(--bg-sidebar);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border-right: 1px solid var(--border);
  min-height: 0;
}

.top {
  height: var(--titlebar);
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px 0 14px;
}
.mac .top {
  padding-left: 78px;
}

.top-spacer {
  flex: 1;
}

.top-actions {
  opacity: 0.55;
  transition: opacity 0.15s var(--ease);
}
.sidebar:hover .top-actions {
  opacity: 1;
}

.icon-btn {
  display: inline-grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--text-3);
  cursor: pointer;
  transition: background 0.14s, color 0.14s;
  font-size: 14px;
}
.icon-btn:hover {
  background: var(--hover);
  color: var(--text);
}

/* Integrated frosted controls: blends into the acrylic sidebar without heavy white boxes */
.controls {
  padding: 2px 10px 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.new-btn {
  width: 100%;
  height: 34px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  border-radius: 9px;
  border: 1px solid transparent;
  background: color-mix(in srgb, var(--ink) 4.5%, transparent);
  color: var(--text);
  font-size: 13px;
  font-weight: 530;
  cursor: pointer;
  transition: background 0.14s var(--ease), border-color 0.14s var(--ease), transform 0.14s var(--ease);
}
.new-btn:hover {
  background: var(--surface);
  border-color: var(--border);
}
.new-btn:active {
  transform: scale(0.99);
}
.new-ic {
  width: 14px;
  height: 14px;
  color: var(--text-2);
  flex: none;
}
.new-btn .hint {
  margin-left: auto;
  background: transparent;
  border-color: transparent;
  opacity: 0.65;
}
.new-btn:hover .hint {
  background: var(--hover);
  border-color: var(--border);
  opacity: 1;
}

.search-box {
  height: 32px;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 0 9px;
  border-radius: 9px;
  border: 1px solid transparent;
  background: color-mix(in srgb, var(--ink) 3.8%, transparent);
  cursor: text;
  transition: background 0.16s var(--ease), border-color 0.16s var(--ease), box-shadow 0.16s var(--ease);
}
.search-box:hover {
  background: var(--surface-2);
  border-color: var(--border);
}
.search-box:focus-within {
  background: var(--surface);
  border-color: var(--border-strong);
  box-shadow: var(--shadow-card);
}
.search-ic {
  width: 13.5px;
  height: 13.5px;
  color: var(--text-3);
  flex: none;
  transition: color 0.14s;
}
.search-box:focus-within .search-ic {
  color: var(--text-2);
}
.search-input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  color: var(--text);
  font-size: 12.5px;
  line-height: 18px;
  padding: 0;
}
.search-input:focus-visible {
  box-shadow: none;
}
.search-input::placeholder {
  color: var(--text-3);
}
.search-clear {
  display: inline-grid;
  place-items: center;
  width: 16px;
  height: 16px;
  border: none;
  border-radius: 50%;
  background: var(--hover);
  color: var(--text-3);
  cursor: pointer;
  flex: none;
  padding: 0;
  transition: background 0.12s, color 0.12s;
}
.search-clear:hover {
  background: var(--active);
  color: var(--text);
}
.search-clear svg {
  width: 10px;
  height: 10px;
}
.search-kbd {
  background: transparent;
  border-color: transparent;
  opacity: 0.55;
  flex: none;
}

.list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 8px 10px;
}

.list-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 40px 14px;
  text-align: center;
}
.empty-icon {
  font-size: 18px;
  color: var(--text-3);
  opacity: 0.5;
}
.empty-text {
  font-size: 12.5px;
  color: var(--text-3);
}
.empty-btn {
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text-2);
  font-size: 11.5px;
  border-radius: 7px;
  padding: 3px 10px;
  cursor: pointer;
}
.empty-btn:hover {
  color: var(--text);
  border-color: var(--border-strong);
}

.convs {
  background: transparent !important;
  padding: 0 !important;
  margin: 0 !important;
}
.convs :deep(.antd-conversations-list),
.convs :deep(.antd-conversations-group) {
  padding: 0 !important;
  margin: 0 !important;
}
.convs :deep(.antd-conversations-item) {
  border-radius: 10px;
  margin: 0 0 2px !important;
  padding: 7px 10px !important;
  height: auto !important;
  min-height: 0 !important;
  align-items: center !important;
  border: 1px solid transparent;
  transition: background 0.14s var(--ease), border-color 0.14s var(--ease), box-shadow 0.14s var(--ease);
}
.convs :deep(.antd-conversations-item:hover) {
  background: var(--hover) !important;
}
.convs :deep(.antd-conversations-item-active) {
  background: var(--surface) !important;
  border-color: var(--border);
  backdrop-filter: var(--glass-blur-sm);
  -webkit-backdrop-filter: var(--glass-blur-sm);
  box-shadow: var(--shadow-card);
}
.convs :deep(.antd-conversations-group-title) {
  font-size: 11px;
  font-weight: 560;
  line-height: 16px;
  color: var(--text-3);
  padding: 10px 10px 5px !important;
  margin: 0 !important;
  letter-spacing: 0.02em;
}
.convs :deep(.antd-conversations-group:first-child .antd-conversations-group-title) {
  padding-top: 4px !important;
}
.convs :deep(.antd-conversations-label) {
  flex: 1;
  min-width: 0;
  overflow: hidden;
}
.convs :deep(.antd-conversations-menu-icon) {
  opacity: 0;
  color: var(--text-3);
  margin-left: 4px;
  transition: opacity 0.14s var(--ease), color 0.14s var(--ease);
}
.convs :deep(.antd-conversations-item:hover) .antd-conversations-menu-icon,
.convs :deep(.antd-conversations-item-active) .antd-conversations-menu-icon {
  opacity: 1;
}

.convs :deep(.conv) {
  min-width: 0;
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.convs :deep(.conv-row) {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
}
.convs :deep(.conv-logo) {
  flex: none;
  opacity: 0.92;
}
.convs :deep(.conv-title) {
  font-size: 13px;
  font-weight: 500;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 18px;
  flex: 1;
  min-width: 0;
}
.convs :deep(.conv-meta) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-left: 20px;
  font-size: 11px;
  color: var(--text-3);
  line-height: 15px;
  min-width: 0;
}
.convs :deep(.conv-sub) {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
}
.convs :deep(.conv-agent) {
  flex-shrink: 0;
}
.convs :deep(.conv-sep) {
  opacity: 0.5;
  flex-shrink: 0;
}
.convs :deep(.conv-dir) {
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 10.5px;
  opacity: 0.85;
}
.convs :deep(.conv-time) {
  flex-shrink: 0;
  font-size: 10.5px;
  opacity: 0.7;
  padding-left: 4px;
}

.convs :deep(.st-pill) {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  line-height: 16px;
  padding: 0 6px;
  border-radius: 999px;
  font-weight: 560;
  letter-spacing: 0.01em;
}
.convs :deep(.st-pill.need) {
  background: var(--warn-soft);
  color: var(--warn);
}
.convs :deep(.st-pill.run) {
  background: rgba(56, 189, 248, 0.14);
  color: #0284c7;
}
:root[data-theme="dark"] .convs :deep(.st-pill.run) {
  color: #38bdf8;
}
.convs :deep(.st-pill.ok) {
  background: var(--ok-soft);
  color: var(--ok);
}
.convs :deep(.st-pill.err) {
  background: var(--err-soft);
  color: var(--err);
}
.convs :deep(.st-dot) {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: currentColor;
  animation: oc-pulse 1.2s ease-in-out infinite;
}
.convs :deep(.st-spin) {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  border: 1.5px solid color-mix(in srgb, currentColor 28%, transparent);
  border-top-color: currentColor;
  animation: oc-spin 0.75s linear infinite;
}
.convs :deep(.st-check) {
  width: 10px;
  height: 10px;
  flex: none;
}
.convs :deep(.st-done-ic) {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--ok);
  opacity: 0.72;
}
@keyframes oc-spin {
  to {
    transform: rotate(360deg);
  }
}

.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex: none;
  background: var(--text-3);
}
.dot.error {
  background: var(--err);
}

.archive-bar {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 10px 6px;
}
.archive-back {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: none;
  background: transparent;
  color: var(--text-2);
  font-size: 12px;
  font-weight: 520;
  padding: 3px 6px;
  border-radius: 7px;
  cursor: pointer;
  transition: background 0.13s, color 0.13s;
}
.archive-back:hover {
  background: var(--hover);
  color: var(--text);
}
.archive-entry {
  flex: none;
  padding: 4px 10px 6px;
}
.archive-entry-btn {
  width: 100%;
  height: 30px;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 0 9px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--text-3);
  font-size: 12px;
  cursor: pointer;
  transition: background 0.14s, color 0.14s, border-color 0.14s;
}
.archive-entry-btn:hover {
  background: var(--hover);
  border-color: var(--border);
  color: var(--text);
}
.archive-ic {
  font-size: 13px;
}
.archive-count {
  margin-left: auto;
  font-size: 11px;
  color: var(--text-3);
  padding: 0 6px;
  line-height: 17px;
  border-radius: 999px;
  background: var(--hover);
}

.foot {
  flex: none;
  padding: 8px 10px 10px;
  border-top: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.foot-row {
  display: flex;
  align-items: center;
  gap: 5px;
}

.avatar-btn {
  position: relative;
  width: 28px;
  height: 28px;
  padding: 0;
  border-radius: 50%;
  border: 1px solid var(--border-strong);
  background: var(--surface);
  color: var(--text-2);
  display: grid;
  place-items: center;
  overflow: hidden;
  cursor: pointer;
  flex: none;
  box-shadow: var(--shadow-card);
  transition: border-color 0.14s, transform 0.14s var(--ease);
}
.avatar-btn:hover {
  border-color: var(--ink);
  transform: scale(1.04);
}
.avatar-btn img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.avatar-ic {
  width: 14px;
  height: 14px;
}
.avatar-cam {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  background: rgba(15, 23, 42, 0.56);
  color: #fff;
  opacity: 0;
  transition: opacity 0.14s;
}
.avatar-cam svg {
  width: 12px;
  height: 12px;
}
.avatar-btn:hover .avatar-cam {
  opacity: 1;
}

.foot-spacer {
  flex: 1;
}

.theme-btn {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  border: 1px solid transparent;
  color: var(--text-3);
  transition: background 0.14s, border-color 0.14s, color 0.14s, transform 0.14s var(--ease);
}
.theme-btn:hover {
  background: var(--hover);
  border-color: var(--border);
  color: var(--text);
}
.theme-btn:active {
  transform: scale(0.94);
}
.theme-ic {
  width: 15px;
  height: 15px;
  display: block;
}

.warn {
  display: flex;
  align-items: center;
  gap: 8px;
  border: 1px solid color-mix(in srgb, var(--err) 30%, transparent);
  background: var(--err-soft);
  color: var(--err);
  border-radius: 9px;
  padding: 6px 9px;
  font-size: 12px;
  cursor: pointer;
  text-align: left;
}

:deep(.menu-item) {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
:deep(.menu-icon) {
  display: inline-grid;
  place-items: center;
  color: var(--text-3);
  font-size: 13px;
}
</style>

<style>
.sb-ctx-menu {
  position: fixed;
  z-index: 2100;
  min-width: 146px;
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
  user-select: none;
  -webkit-user-select: none;
}
.sb-ctx-item {
  width: 100%;
  border: none;
  background: transparent;
  color: var(--text);
  font-size: 12.5px;
  text-align: left;
  padding: 6px 10px;
  border-radius: 7px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  transition: background 0.12s, color 0.12s;
}
.sb-ctx-item:hover {
  background: var(--hover);
}
.sb-ctx-ic {
  font-size: 13px;
  color: var(--text-3);
}
.sb-ctx-item.danger {
  color: var(--err);
}
.sb-ctx-item.danger .sb-ctx-ic {
  color: var(--err);
}
.sb-ctx-item.danger:hover {
  background: var(--err-soft);
}
.sb-ctx-div {
  height: 1px;
  background: var(--border);
  margin: 3px 6px;
}
</style>

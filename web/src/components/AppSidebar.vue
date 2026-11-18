<script setup lang="ts">
import { Conversations } from "@antdv-next/x";
import type { ConversationItemType } from "@antdv-next/x";
import {
  DeleteOutlined,
  EditOutlined,
  MoreOutlined,
  PushpinOutlined,
  PushpinFilled,
  SearchOutlined,
  SettingOutlined,
  MenuFoldOutlined,
  PlusOutlined,
} from "@antdv-next/icons";
import { Dropdown, Input, Modal, Tooltip, message } from "antdv-next";
import { computed, h, nextTick, ref } from "vue";
import { agentById, isDark, isMac, newConversation, pin, remove, rename, select, sortedMetas, store, saveSettings } from "../store";
import type { Meta } from "../types";

const renaming = ref<Meta | null>(null);
const newTitle = ref("");
const renameInput = ref<{ focus: () => void } | null>(null);
const toDelete = ref<Meta | null>(null);

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

const filtered = computed(() => {
  const q = store.search.trim().toLowerCase();
  return sortedMetas.value
    .filter((m) => !q || m.title.toLowerCase().includes(q) || m.cwd.toLowerCase().includes(q) || m.agentName.toLowerCase().includes(q))
    .sort((a, b) => groupRank(a) - groupRank(b) || b.updatedAt - a.updatedAt);
});

const items = computed<ConversationItemType[]>(() =>
  filtered.value.map((m) => ({ key: m.id, label: m.title, group: groupName(m), "data-meta": m })),
);

function ago(t: number) {
  const s = Math.max(1, Math.round((Date.now() - t) / 1000));
  if (s < 60) return "刚刚";
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} 天前`;
  return new Date(t).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

/** A conversation's row: title, the agent it runs on, and live state. */
function labelRender(item: ConversationItemType) {
  const m = (item as unknown as { "data-meta": Meta })["data-meta"];
  const status = store.lives[m.id]?.status ?? m.status;
  return h("div", { class: "conv" }, [
    h("div", { class: "conv-row" }, [
      h("span", { class: "conv-title" }, m.title || "新对话"),
      status === "running"
        ? h("span", { class: "dot running" })
        : (m.pending ?? 0) > 0
          ? h("span", { class: "dot pending" })
          : status === "error"
            ? h("span", { class: "dot error" })
            : null,
    ]),
    h("div", { class: "conv-meta" }, [
      h("span", { class: "conv-agent" }, m.agentName),
      h("span", { class: "conv-sep" }, "·"),
      h("span", {}, ago(m.updatedAt)),
    ]),
  ]);
}

function menuFor(value: ConversationItemType) {
  const m = (value as unknown as { "data-meta": Meta })["data-meta"];
  const item = (key: string, icon: () => unknown, label: string, danger = false) => ({
    key,
    danger,
    label: h("span", { class: "menu-item" }, [h("span" as never, { class: "menu-icon" }, [icon() as never]), label]),
  });
  return {
    items: [
      item("pin", () => (m.pinned ? h(PushpinFilled) : h(PushpinOutlined)), m.pinned ? "取消置顶" : "置顶"),
      item("rename", () => h(EditOutlined), "重命名"),
      { type: "divider" as const },
      item("delete", () => h(DeleteOutlined), "删除对话", true),
    ],
    onClick: ({ key }: { key: string }) => {
      if (key === "pin") void pin(m.id, !m.pinned);
      if (key === "rename") void startRename(m);
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

const needsNode = computed(() => Boolean(store.boot?.nodeError));
</script>

<template>
  <aside class="sidebar" :class="{ mac: isMac }">
    <div class="top drag">
      <div class="brand">
        <span class="logo" />
        <span class="wordmark">open-chat</span>
      </div>
      <div class="top-actions no-drag">
        <Tooltip title="收起侧栏" :mouse-enter-delay="0.4">
          <button class="icon-btn" @click="store.sidebarCollapsed = true">
            <MenuFoldOutlined />
          </button>
        </Tooltip>
      </div>
    </div>

    <div class="actions">
      <button class="new-btn" @click="newConversation()">
        <PlusOutlined />
        <span>新对话</span>
        <span class="hint kbd">{{ isMac ? "⌘" : "Ctrl" }} N</span>
      </button>
    </div>

    <div class="search">
      <Input id="conv-search" v-model:value="store.search" placeholder="搜索对话" allow-clear variant="borderless" size="small">
        <template #prefix><SearchOutlined class="faint" /></template>
      </Input>
    </div>

    <div class="list">
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
      <div v-else class="list-empty faint">
        {{ store.search ? "没有匹配的对话" : "还没有对话" }}
      </div>
    </div>

    <div class="foot">
      <button v-if="needsNode" class="warn" @click="store.settingsOpen = true">
        <span class="dot error" />
        <span>没找到 Node.js</span>
      </button>
      <div class="foot-row">
        <button class="foot-btn" @click="store.settingsOpen = true">
          <SettingOutlined />
          <span>设置</span>
        </button>
        <Tooltip :title="isDark ? '切到浅色' : '切到深色'" :mouse-enter-delay="0.4">
          <button class="icon-btn" @click="toggleTheme">
            <span class="theme-dot" :class="{ dark: isDark }" />
          </button>
        </Tooltip>
      </div>
    </div>

    <Modal
      :open="Boolean(renaming)"
      title="重命名对话"
      :width="380"
      :ok-text="'保存'"
      :cancel-text="'取消'"
      @ok="confirmRename"
      @cancel="renaming = null"
    >
      <Input ref="renameInput" v-model:value="newTitle" :maxlength="60" @press-enter="confirmRename" />
    </Modal>
    <Modal
      :open="Boolean(toDelete)"
      title="删除这个对话？"
      :width="380"
      :ok-text="'删除'"
      ok-type="danger"
      :cancel-text="'取消'"
      @ok="confirmDelete"
      @cancel="toDelete = null"
    >
      <p class="muted" style="margin: 0">
        「{{ toDelete?.title }}」的记录会从本机删除，无法恢复。agent 那边的会话不受影响。
      </p>
    </Modal>
  </aside>
</template>

<style scoped>
.sidebar {
  width: 262px;
  flex: none;
  display: flex;
  flex-direction: column;
  background: var(--bg-sidebar);
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
  padding-left: 80px;
}

.brand {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1;
}

.logo {
  width: 17px;
  height: 17px;
  border-radius: 6px;
  flex: none;
  background: linear-gradient(140deg, #9d9eff, #4a4ad0);
  box-shadow: 0 2px 8px rgba(91, 91, 214, 0.4);
  position: relative;
}
.logo::after {
  content: "";
  position: absolute;
  inset: 5px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.9);
  clip-path: polygon(0 20%, 100% 20%, 100% 62%, 30% 62%, 0 92%);
}

.wordmark {
  font-size: 13px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--text-2);
  white-space: nowrap;
  overflow: hidden;
}

.top-actions {
  opacity: 0;
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

.actions {
  padding: 0 10px 6px;
}

.new-btn {
  width: 100%;
  height: 34px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  border-radius: 9px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  box-shadow: 0 1px 2px rgba(20, 20, 40, 0.04);
  transition: box-shadow 0.18s var(--ease), transform 0.18s var(--ease), border-color 0.18s;
}
.new-btn:hover {
  border-color: var(--border-strong);
  box-shadow: 0 4px 14px rgba(20, 20, 40, 0.08);
  transform: translateY(-0.5px);
}
.new-btn:active {
  transform: translateY(0);
}
.new-btn .hint {
  margin-left: auto;
  font-size: 10.5px;
}

.search {
  padding: 2px 10px 6px;
}
.search :deep(.ant-input-affix-wrapper) {
  background: transparent;
  padding-left: 6px;
  border-radius: 8px;
}
.search :deep(.ant-input-affix-wrapper:hover) {
  background: var(--hover);
}

.list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 2px 8px 8px;
}

.list-empty {
  padding: 18px 10px;
  font-size: 12.5px;
  text-align: center;
}

.convs {
  background: transparent !important;
}

.convs :deep(.antd-conversations-item) {
  border-radius: 8px;
  margin-bottom: 1px;
  padding: 7px 8px !important;
}
.convs :deep(.antd-conversations-item-active) {
  background: var(--surface) !important;
  box-shadow: 0 1px 2px rgba(20, 20, 40, 0.06), 0 0 0 1px var(--border);
}
.convs :deep(.antd-conversations-group-title) {
  font-size: 11px;
  font-weight: 500;
  color: var(--text-3);
  padding: 12px 8px 4px !important;
  letter-spacing: 0.01em;
}
.convs :deep(.antd-conversations-menu-icon) {
  opacity: 0;
  color: var(--text-3);
  transition: opacity 0.14s var(--ease);
}
.convs :deep(.antd-conversations-item:hover) .antd-conversations-menu-icon,
.convs :deep(.antd-conversations-item-active) .antd-conversations-menu-icon {
  opacity: 1;
}

.conv {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding-right: 2px;
}
.conv-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.conv-title {
  font-size: 13px;
  font-weight: 450;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 18px;
}
.conv-meta {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--text-3);
  line-height: 15px;
  white-space: nowrap;
  overflow: hidden;
}
.conv-agent {
  overflow: hidden;
  text-overflow: ellipsis;
}

.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex: none;
  background: var(--text-3);
}
.dot.running {
  background: var(--accent);
  animation: oc-pulse 1.4s ease-in-out infinite;
}
.dot.pending {
  background: var(--warn);
}
.dot.error {
  background: var(--err);
}

.foot {
  flex: none;
  padding: 6px 10px 10px;
  border-top: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.foot-row {
  display: flex;
  align-items: center;
  gap: 4px;
}

.foot-btn {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 30px;
  padding: 0 8px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--text-2);
  font-size: 12.5px;
  cursor: pointer;
}
.foot-btn:hover {
  background: var(--hover);
  color: var(--text);
}

.theme-dot {
  width: 13px;
  height: 13px;
  border-radius: 50%;
  border: 1px solid var(--border-strong);
  background: linear-gradient(90deg, #fff 0 50%, #2a2a2e 50% 100%);
}
.theme-dot.dark {
  background: linear-gradient(90deg, #2a2a2e 0 50%, #fff 50% 100%);
}

.warn {
  display: flex;
  align-items: center;
  gap: 8px;
  border: 1px solid color-mix(in srgb, var(--err) 30%, transparent);
  background: var(--err-soft);
  color: var(--err);
  border-radius: 8px;
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

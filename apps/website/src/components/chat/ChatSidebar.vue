<script setup lang="ts">
import type { ConversationItemType, ConversationsProps } from "@antdv-next/x";
import { Conversations } from "@antdv-next/x";
import {
  ArrowUpRight,
  CircleQuestionMark,
  Ellipsis,
  LogOut,
  MessageSquare,
  Moon,
  PanelLeftClose,
  Search,
  Settings2,
  Sparkles,
  SquarePen,
  Sun,
  Zap,
} from "@lucide/vue";
import { Button, Popover, Tooltip, message } from "antdv-next";
import { computed, h, onBeforeUnmount, onMounted, ref } from "vue";

interface Props {
  open: boolean;
  dark: boolean;
  conversationList: ConversationItemType[];
  currentKey: string;
}

interface Emits {
  (e: "home"): void;
  (e: "toggleSidebar"): void;
  (e: "toggleTheme"): void;
  (e: "newConversation"): void;
  (e: "activeChange", key: string): void;
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();
const search = ref("");
const accountOpen = ref(false);

const filteredConversations = computed(() => {
  const query = search.value.trim().toLocaleLowerCase();
  return props.conversationList
    .filter((item) =>
      query
        ? String(item.label ?? "")
            .toLocaleLowerCase()
            .includes(query)
        : true,
    )
    .map((item) => ({ ...item, icon: h(MessageSquare) }));
});

const handleActiveChange: ConversationsProps["onActiveChange"] = (key) => {
  emit("activeChange", key);
};

const handleShortcut = (event: KeyboardEvent) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "k") {
    event.preventDefault();
    emit("newConversation");
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "f") {
    event.preventDefault();
    if (!props.open) emit("toggleSidebar");
    window.setTimeout(
      () => document.querySelector<HTMLInputElement>("#conversation-search")?.focus(),
      100,
    );
  }
  if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLocaleLowerCase() === "l") {
    event.preventDefault();
    emit("toggleTheme");
  }
  if (event.key === "Escape") closeMenus();
};

const closeMenus = () => {
  accountOpen.value = false;
};

onMounted(() => window.addEventListener("keydown", handleShortcut));
onBeforeUnmount(() => window.removeEventListener("keydown", handleShortcut));
</script>

<template>
  <aside class="chat-sidebar" :class="{ 'is-collapsed': !open }" aria-label="会话导航">
    <header class="sidebar-head">
      <button
        class="sidebar-brand"
        type="button"
        aria-label="返回 Open Chat 首页"
        @click="emit('home')"
      >
        <span class="brand-mark" aria-hidden="true"><Sparkles /></span>
        <span class="brand-name">Open Chat</span>
      </button>
      <Tooltip :title="open ? '收起侧边栏' : '展开侧边栏'" placement="right">
        <Button
          type="text"
          shape="circle"
          class="sidebar-icon-button sidebar-collapse"
          :aria-label="open ? '收起侧边栏' : '展开侧边栏'"
          @click="emit('toggleSidebar')"
        >
          <PanelLeftClose />
        </Button>
      </Tooltip>
    </header>

    <div class="sidebar-primary-actions">
      <button class="new-chat-button" type="button" @click="emit('newConversation')">
        <SquarePen /><span>新对话</span><kbd>⌘ K</kbd>
      </button>
      <label class="conversation-search" for="conversation-search">
        <Search />
        <input
          id="conversation-search"
          v-model="search"
          type="search"
          placeholder="搜索对话"
          autocomplete="off"
        />
        <kbd>⌘ F</kbd>
      </label>
    </div>

    <div class="conversation-scroll">
      <Conversations
        :items="filteredConversations"
        :active-key="currentKey"
        :groupable="true"
        @active-change="handleActiveChange"
      />
      <div v-if="search && filteredConversations.length === 0" class="search-empty">
        <Search />
        <strong>没有匹配的对话</strong>
        <span>换个关键词试试</span>
      </div>
    </div>

    <footer class="sidebar-footer">
      <button class="upgrade-row" type="button" @click="message.info('Pro 版本即将开放')">
        <span class="upgrade-icon"><Zap /></span>
        <span><strong>升级 Open Chat Pro</strong><small>解锁更多模型与用量</small></span>
        <ArrowUpRight />
      </button>

      <Popover v-model:open="accountOpen" placement="topLeft" :arrow="false" trigger="click">
        <template #content>
          <div class="account-popover">
            <div class="account-popover-head">
              <span class="account-avatar">CC</span>
              <span><strong>Carl Chen</strong><small>carl@example.com</small></span>
            </div>
            <i></i>
            <button type="button" @click="message.info('设置即将开放')">
              <Settings2 /><span>设置</span>
            </button>
            <button type="button" @click="emit('toggleTheme')">
              <Sun v-if="dark" /><Moon v-else />
              <span>{{ dark ? "浅色模式" : "深色模式" }}</span>
              <kbd>⌘ ⇧ L</kbd>
            </button>
            <button type="button" @click="message.info('帮助中心即将开放')">
              <CircleQuestionMark /><span>帮助与反馈</span>
            </button>
            <i></i>
            <button
              type="button"
              @click="
                closeMenus();
                emit('home');
              "
            >
              <LogOut /><span>退出工作区</span>
            </button>
          </div>
        </template>
        <button
          class="account-button"
          type="button"
          aria-haspopup="menu"
          :aria-expanded="accountOpen"
        >
          <span class="account-avatar">CC</span>
          <span><strong>Carl Chen</strong><small>carl@example.com</small></span>
          <Ellipsis />
        </button>
      </Popover>
    </footer>
  </aside>
</template>

<style scoped>
.chat-sidebar {
  position: relative;
  z-index: 30;
  display: flex;
  width: 276px;
  min-width: 276px;
  height: 100dvh;
  flex-direction: column;
  padding: 10px;
  overflow: visible;
  border-right: 1px solid var(--brand-border);
  background: var(--brand-sidebar);
  transition:
    width 220ms ease,
    min-width 220ms ease,
    transform 220ms ease;
}
.sidebar-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  height: 42px;
  padding: 0 2px 4px 5px;
}
.sidebar-brand {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 9px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--brand-foreground);
  font-size: 14px;
  font-weight: 680;
  cursor: pointer;
}
.brand-mark {
  display: grid;
  width: 29px;
  height: 29px;
  flex: 0 0 29px;
  place-items: center;
  border-radius: 5px;
  background: var(--brand-primary);
  color: var(--brand-primary-foreground);
}
.brand-mark :deep(svg) {
  width: 15px;
  height: 15px;
}
.brand-name {
  overflow: hidden;
  white-space: nowrap;
}
.sidebar-icon-button {
  width: 36px !important;
  min-width: 36px !important;
  height: 36px !important;
  color: var(--brand-muted) !important;
}
.sidebar-icon-button:hover {
  background: var(--brand-surface-subtle) !important;
  color: var(--brand-foreground) !important;
}
.upgrade-row,
.account-button {
  display: grid;
  grid-template-columns: 30px minmax(0, 1fr) 16px;
  align-items: center;
  gap: 9px;
  width: 100%;
  min-height: 46px;
  padding: 5px 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--brand-foreground);
  text-align: left;
  cursor: pointer;
  transition: background 160ms ease;
}
.upgrade-row:hover,
.account-button:hover,
.account-button[aria-expanded="true"] {
  background: var(--brand-surface-subtle);
}
.account-avatar {
  display: grid;
  width: 30px;
  height: 30px;
  flex: 0 0 30px;
  place-items: center;
  border: 1px solid var(--brand-border);
  border-radius: 6px;
  background: var(--brand-surface);
  color: var(--brand-foreground);
  box-shadow: var(--brand-shadow-xs);
  font-size: 10px;
  font-weight: 700;
}
.upgrade-row > span:nth-child(2),
.account-button > span:nth-child(2) {
  display: flex;
  min-width: 0;
  flex-direction: column;
}
.account-button strong {
  overflow: hidden;
  font-size: 12px;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.account-button small {
  overflow: hidden;
  color: var(--brand-muted);
  font-size: 10px;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.upgrade-row > :deep(svg),
.account-button > :deep(svg) {
  width: 14px;
  height: 14px;
  color: var(--brand-muted);
}
.sidebar-primary-actions {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin: 14px 0 7px;
}
.new-chat-button,
.conversation-search {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr) auto;
  align-items: center;
  gap: 9px;
  width: 100%;
  min-height: 38px;
  padding: 0 10px;
  border: 1px solid transparent;
  border-radius: 6px;
  text-align: left;
}
.new-chat-button {
  background: var(--brand-primary);
  color: var(--brand-primary-foreground);
  box-shadow: var(--brand-shadow-xs);
  font-size: 12px;
  font-weight: 620;
  cursor: pointer;
}
.new-chat-button:hover {
  opacity: 0.88;
}
.new-chat-button :deep(svg),
.conversation-search :deep(svg) {
  width: 15px;
  height: 15px;
}
kbd {
  border: 0;
  background: transparent;
  color: var(--brand-muted);
  font-family: inherit;
  font-size: 9px;
}
.new-chat-button kbd {
  color: color-mix(in srgb, var(--brand-primary-foreground) 62%, transparent);
}
.conversation-search {
  color: var(--brand-muted);
}
.conversation-search:hover,
.conversation-search:focus-within {
  background: var(--brand-surface-subtle);
  color: var(--brand-foreground);
}
.conversation-search input {
  min-width: 0;
  width: 100%;
  padding: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--brand-foreground);
  font-size: 12px;
}
.conversation-scroll {
  position: relative;
  min-height: 0;
  flex: 1;
  overflow-x: hidden;
  overflow-y: auto;
}
.chat-sidebar :deep(.antd-conversations) {
  min-height: 100%;
  padding: 3px 0 10px;
}
.chat-sidebar :deep(.antd-conversations-group-title) {
  min-height: 20px;
  margin-top: 10px;
  padding: 0 9px 4px;
  color: var(--brand-muted);
  font-size: 10px;
  font-weight: 600;
}
.chat-sidebar :deep(.antd-conversations-item) {
  min-height: 36px;
  padding-inline: 9px;
  border-radius: 5px;
  color: var(--brand-muted);
  font-size: 11px;
}
.chat-sidebar :deep(.antd-conversations-item:hover),
.chat-sidebar :deep(.antd-conversations-item-active) {
  background: var(--brand-surface-subtle);
  color: var(--brand-foreground);
}

.chat-sidebar :deep(.antd-conversations-icon) {
  width: 17px;
  min-width: 17px;
  font-size: 14px;
}
.search-empty {
  display: flex;
  min-height: 180px;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  padding: 24px;
  color: var(--brand-muted);
  text-align: center;
}
.search-empty :deep(svg) {
  width: 22px;
  height: 22px;
  margin-bottom: 12px;
}
.search-empty strong {
  color: var(--brand-foreground);
  font-size: 11px;
}
.search-empty span {
  margin-top: 3px;
  font-size: 10px;
}
.sidebar-footer {
  padding-top: 8px;
  border-top: 1px solid var(--brand-border);
}
.upgrade-row,
.account-button {
  min-height: 48px;
  padding: 5px 7px;
}
.upgrade-icon {
  display: grid;
  width: 30px;
  height: 30px;
  place-items: center;
  border: 1px solid var(--brand-border);
  border-radius: 5px;
  background: var(--brand-surface);
  box-shadow: var(--brand-shadow-xs);
}
.upgrade-icon :deep(svg) {
  width: 14px;
  height: 14px;
}
.upgrade-row strong {
  font-size: 10px;
}
.upgrade-row small {
  color: var(--brand-muted);
  font-size: 9px;
}

.chat-sidebar.is-collapsed {
  width: 68px;
  min-width: 68px;
}
.chat-sidebar.is-collapsed .sidebar-head {
  justify-content: center;
  padding-left: 0;
}
.chat-sidebar.is-collapsed .sidebar-brand {
  display: none;
}
.chat-sidebar.is-collapsed .new-chat-button span,
.chat-sidebar.is-collapsed .new-chat-button kbd,
.chat-sidebar.is-collapsed .conversation-search input,
.chat-sidebar.is-collapsed .conversation-search kbd,
.chat-sidebar.is-collapsed .upgrade-row > span:nth-child(2),
.chat-sidebar.is-collapsed .upgrade-row > :deep(svg),
.chat-sidebar.is-collapsed .account-button > span:nth-child(2),
.chat-sidebar.is-collapsed .account-button > :deep(svg),
.chat-sidebar.is-collapsed :deep(.antd-conversations-group-title),
.chat-sidebar.is-collapsed :deep(.antd-conversations-label) {
  display: none;
}
.chat-sidebar.is-collapsed .new-chat-button,
.chat-sidebar.is-collapsed .conversation-search,
.chat-sidebar.is-collapsed .upgrade-row,
.chat-sidebar.is-collapsed .account-button {
  display: flex;
  justify-content: center;
  padding: 0;
}
.chat-sidebar.is-collapsed :deep(.antd-conversations-item) {
  display: flex;
  justify-content: center;
  padding: 0;
}
.chat-sidebar.is-collapsed .sidebar-collapse :deep(svg) {
  transform: rotate(180deg);
}

:global(.ant-popover-inner:has(.account-popover)) {
  padding: 5px !important;
  border: 1px solid var(--brand-border);
  border-radius: 7px !important;
  background: var(--brand-surface) !important;
  box-shadow: var(--shadow-xl) !important;
}
.account-popover {
  width: 256px;
}
.account-popover > button:hover {
  background: var(--brand-surface-subtle);
}
.account-popover-head > span:nth-child(2) {
  display: flex;
  min-width: 0;
  flex-direction: column;
}
.account-popover strong {
  font-size: 11px;
}
.account-popover small {
  color: var(--brand-muted);
  font-size: 9px;
}
.account-popover > i {
  display: block;
  height: 1px;
  margin: 5px -5px;
  background: var(--brand-border);
}
.account-popover-head {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr);
  align-items: center;
  gap: 9px;
  padding: 7px;
}
.account-popover > button {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr) auto;
  align-items: center;
  gap: 9px;
  width: 100%;
  min-height: 36px;
  padding: 4px 7px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--brand-foreground);
  text-align: left;
  font-size: 12px;
  cursor: pointer;
}
.account-popover > button :deep(svg) {
  width: 14px;
  height: 14px;
  color: var(--brand-muted);
}
.account-popover > button kbd {
  margin-left: auto;
}

@media (max-width: 820px) {
  .chat-sidebar,
  .chat-sidebar.is-collapsed {
    position: absolute;
    inset: 0 auto 0 0;
    width: min(276px, calc(100% - 56px));
    min-width: 0;
    padding-bottom: max(10px, env(safe-area-inset-bottom));
    box-shadow: 18px 0 46px rgba(9, 9, 11, 0.18);
    transform: translateX(0);
  }
  .chat-sidebar.is-collapsed {
    box-shadow: none;
    transform: translateX(-104%);
  }
  .chat-sidebar.is-collapsed .sidebar-head {
    justify-content: space-between;
    padding-left: 5px;
  }
  .chat-sidebar.is-collapsed .sidebar-brand {
    display: inline-flex;
  }
  .chat-sidebar.is-collapsed .new-chat-button span,
  .chat-sidebar.is-collapsed .new-chat-button kbd,
  .chat-sidebar.is-collapsed .conversation-search input,
  .chat-sidebar.is-collapsed .conversation-search kbd,
  .chat-sidebar.is-collapsed .upgrade-row > span:nth-child(2),
  .chat-sidebar.is-collapsed .upgrade-row > :deep(svg),
  .chat-sidebar.is-collapsed .account-button > span:nth-child(2),
  .chat-sidebar.is-collapsed .account-button > :deep(svg),
  .chat-sidebar.is-collapsed :deep(.antd-conversations-group-title),
  .chat-sidebar.is-collapsed :deep(.antd-conversations-label) {
    display: initial;
  }
  .chat-sidebar.is-collapsed .new-chat-button,
  .chat-sidebar.is-collapsed .conversation-search,
  .chat-sidebar.is-collapsed .upgrade-row,
  .chat-sidebar.is-collapsed .account-button {
    display: grid;
    justify-content: initial;
    padding: 5px 7px;
  }
  .chat-sidebar.is-collapsed .new-chat-button,
  .chat-sidebar.is-collapsed .conversation-search {
    padding: 0 10px;
  }
  .chat-sidebar.is-collapsed :deep(.antd-conversations-item) {
    display: flex;
    justify-content: initial;
    padding-inline: 9px;
  }
  .chat-sidebar.is-collapsed .sidebar-collapse :deep(svg) {
    transform: none;
  }
  .sidebar-icon-button {
    width: 44px !important;
    min-width: 44px !important;
    height: 44px !important;
  }
  .sidebar-brand,
  .new-chat-button,
  .conversation-search,
  .chat-sidebar :deep(.antd-conversations-item) {
    min-height: 44px !important;
  }
  .conversation-search input {
    font-size: 16px;
  }
  .account-popover > button {
    min-height: 44px;
  }
}
</style>

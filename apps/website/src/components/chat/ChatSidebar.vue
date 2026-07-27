<script setup lang="ts">
import type { ConversationItemType, ConversationsProps } from "@antdv-next/x";
import { Conversations } from "@antdv-next/x";
import {
  Archive,
  Ellipsis,
  MessageSquare,
  PanelLeftClose,
  Pencil,
  Pin,
  Search,
  Sparkles,
  SquarePen,
  Store,
  Bookmark,
  Trash2,
} from "@lucide/vue";
import { Button, Input, Modal, Tooltip, message } from "antdv-next";
import { computed, h, onBeforeUnmount, onMounted, ref } from "vue";
import SidebarFooter from "./SidebarFooter.vue";

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
  (e: "assistants"): void;
  (e: "installedAssistants"): void;
  (e: "activeChange", key: string): void;
  (e: "rename", key: string, title: string): void;
  (e: "pin", key: string): void;
  (e: "archive", key: string): void;
  (e: "delete", key: string): void;
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();
const search = ref("");
const accountOpen = ref(false);
const renameOpen = ref(false);
const renameKey = ref("");
const renameDraft = ref("");

const filteredConversations = computed(() => {
  const query = search.value.trim().toLocaleLowerCase();
  return props.conversationList.filter((item) =>
    query
      ? String(item.label ?? "")
          .toLocaleLowerCase()
          .includes(query)
      : true,
  );
});

// 主操作按钮（新对话 / 搜索）：展开为三列 grid，折叠为居中图标，移动端恢复 grid
const primaryActionClass = computed(() =>
  props.open
    ? "grid px-[10px] py-0"
    : "flex justify-center p-0 lt-md:grid lt-md:justify-normal lt-md:px-[10px] lt-md:py-0",
);

// 折叠时隐藏文字/快捷键，移动端（抽屉形态）恢复显示
const collapsibleTextClass = computed(() => (props.open ? "" : "hidden lt-md:[display:initial]"));

const handleActiveChange: ConversationsProps["onActiveChange"] = (key) => {
  emit("activeChange", key);
};

const openRename = (item: ConversationItemType) => {
  renameKey.value = item.key;
  renameDraft.value = String(item.label ?? "").trim();
  renameOpen.value = true;
};

const confirmRename = () => {
  const title = renameDraft.value.trim();
  if (!renameKey.value || !title) {
    message.warning("请输入对话名称");
    return;
  }
  emit("rename", renameKey.value, title);
  renameOpen.value = false;
};

const conversationMenu: ConversationsProps["menu"] = (item) => ({
  trigger: () =>
    h(
      "button",
      {
        type: "button",
        class: "conversation-menu-trigger",
        "aria-label": "打开对话操作菜单",
      },
      [h(Ellipsis)],
    ),
  items: [
    { key: "rename", label: "重命名", icon: h(Pencil) },
    { key: "pin", label: item.group === "置顶" ? "取消置顶" : "置顶对话", icon: h(Pin) },
    { key: "archive", label: "归档对话", icon: h(Archive) },
    { type: "divider" },
    { key: "delete", label: "删除对话", icon: h(Trash2), danger: true },
  ],
  onClick: ({ key }) => {
    if (key === "rename") openRename(item);
    if (key === "pin") emit("pin", item.key);
    if (key === "archive") emit("archive", item.key);
    if (key === "delete") emit("delete", item.key);
  },
});

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
  <aside
    class="chat-sidebar relative z-sidebar flex h-[100dvh] flex-col overflow-visible bg-brand-sidebar p-[10px] transition-[width,min-width,transform] duration-220 ease-[ease] lt-md:absolute lt-md:bottom-0 lt-md:left-0 lt-md:right-auto lt-md:top-0 lt-md:min-w-0 lt-md:w-[min(276px,calc(100%-56px))] lt-md:pb-[max(10px,env(safe-area-inset-bottom))]"
    :class="
      open
        ? 'w-[276px] min-w-[276px] lt-md:translate-x-0 lt-md:shadow-[18px_0_46px_rgba(9,9,11,0.18)]'
        : 'is-collapsed w-[68px] min-w-[68px] lt-md:translate-x-[-104%] lt-md:shadow-none'
    "
    aria-label="会话导航"
  >
    <header
      class="flex h-[42px] items-center gap-[10px] pb-[4px] pr-[2px] pt-0"
      :class="
        open
          ? 'justify-between pl-[5px]'
          : 'justify-center pl-0 lt-md:justify-between lt-md:pl-[5px]'
      "
    >
      <button
        class="min-w-0 cursor-pointer items-center gap-[9px] border-0 bg-transparent p-0 text-[14px] font-680 text-brand-foreground lt-md:min-h-[44px]"
        :class="open ? 'inline-flex' : 'hidden lt-md:inline-flex'"
        type="button"
        aria-label="返回 Open Chat 首页"
        @click="emit('home')"
      >
        <span
          class="grid h-[29px] w-[29px] flex-[0_0_29px] place-items-center rounded-[5px] bg-brand-primary text-brand-primary-foreground"
          aria-hidden="true"
        >
          <Sparkles class="!h-[15px] !w-[15px]" />
        </span>
        <span class="overflow-hidden whitespace-nowrap">Open Chat</span>
      </button>
      <Tooltip :title="open ? '收起侧边栏' : '展开侧边栏'" placement="right">
        <Button
          type="text"
          shape="circle"
          class="!h-[36px] !w-[36px] !min-w-[36px] !text-brand-muted hover:!bg-brand-surface-subtle hover:!text-brand-foreground lt-md:!h-[44px] lt-md:!w-[44px] lt-md:!min-w-[44px]"
          :aria-label="open ? '收起侧边栏' : '展开侧边栏'"
          @click="emit('toggleSidebar')"
        >
          <PanelLeftClose :class="open ? '' : 'rotate-180 lt-md:transform-none'" />
        </Button>
      </Tooltip>
    </header>

    <div class="mb-[7px] mt-[14px] flex flex-col gap-[12px]">
      <button
        class="min-h-[38px] w-full cursor-pointer grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-[9px] rounded-[6px] border border-solid border-transparent bg-brand-primary text-left text-[12px] font-620 text-brand-primary-foreground shadow-brand-xs hover:opacity-88 lt-md:min-h-[44px]"
        :class="primaryActionClass"
        type="button"
        @click="emit('newConversation')"
      >
        <SquarePen class="!h-[15px] !w-[15px]" /><span :class="collapsibleTextClass">新对话</span
        ><kbd
          class="border-0 bg-transparent text-[9px] [color:color-mix(in_srgb,var(--brand-primary-foreground)_62%,transparent)] [font-family:inherit]"
          :class="collapsibleTextClass"
          >⌘ K</kbd
        >
      </button>
      <label
        class="min-h-[38px] w-full grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-[9px] rounded-[6px] border border-solid border-transparent text-left text-brand-muted hover:bg-brand-surface-subtle hover:text-brand-foreground focus-within:bg-brand-surface-subtle focus-within:text-brand-foreground lt-md:min-h-[44px]"
        :class="primaryActionClass"
        for="conversation-search"
      >
        <Search class="!h-[15px] !w-[15px]" />
        <input
          id="conversation-search"
          v-model="search"
          class="w-full min-w-0 border-0 bg-transparent p-0 text-[12px] text-brand-foreground outline-0 lt-md:text-[16px]"
          :class="collapsibleTextClass"
          type="search"
          placeholder="搜索对话"
          autocomplete="off"
        />
        <kbd
          class="border-0 bg-transparent text-[9px] text-brand-muted [font-family:inherit]"
          :class="collapsibleTextClass"
          >⌘ F</kbd
        >
      </label>
    </div>

    <div class="mb-[12px] flex flex-col gap-[2px]">
      <Button
        type="text"
        class="assistant-shortcut-button min-h-[38px] w-full grid-cols-[18px_minmax(0,1fr)] items-center gap-[9px] rounded-[6px] border border-solid border-transparent bg-transparent px-[10px] text-left text-[12px] font-620 text-brand-muted hover:bg-brand-surface-subtle hover:text-brand-foreground lt-md:min-h-11"
        :class="primaryActionClass"
        @click="emit('assistants')"
      >
        <Store class="!h-[15px] !w-[15px]" /><span :class="collapsibleTextClass">助手市场</span>
      </Button>
      <Button
        type="text"
        class="assistant-shortcut-button min-h-[38px] w-full grid-cols-[18px_minmax(0,1fr)] items-center gap-[9px] rounded-[6px] border border-solid border-transparent bg-transparent px-[10px] text-left text-[12px] font-620 text-brand-muted hover:bg-brand-surface-subtle hover:text-brand-foreground lt-md:min-h-11"
        :class="primaryActionClass"
        @click="emit('installedAssistants')"
      >
        <Bookmark class="!h-[15px] !w-[15px]" /><span :class="collapsibleTextClass">我的助手</span>
      </Button>
    </div>

    <div class="conversation-scroll relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
      <div
        v-if="filteredConversations.length === 0"
        class="flex min-h-[180px] flex-col items-center justify-center p-[24px] text-center text-brand-muted"
      >
        <Search v-if="search" class="mb-[12px] !h-[22px] !w-[22px]" />
        <MessageSquare v-else class="mb-[12px] !h-[22px] !w-[22px]" />
        <strong class="text-[11px] text-brand-foreground">{{
          search ? "没有匹配的对话" : "还没有对话"
        }}</strong>
        <span class="mt-[3px] text-[10px]">{{
          search ? "换个关键词试试" : "开始一个新对话吧"
        }}</span>
      </div>
      <Conversations
        v-else
        :items="filteredConversations"
        :active-key="currentKey"
        :groupable="true"
        :menu="open ? conversationMenu : undefined"
        @active-change="handleActiveChange"
      >
        <template #iconRender><MessageSquare /></template>
      </Conversations>
    </div>

    <SidebarFooter
      v-model:account-open="accountOpen"
      :open="open"
      :dark="dark"
      @home="emit('home')"
      @toggle-theme="emit('toggleTheme')"
    />

    <Modal
      v-model:open="renameOpen"
      title="重命名对话"
      ok-text="保存"
      cancel-text="取消"
      :width="360"
      @ok="confirmRename"
    >
      <Input
        v-model:value="renameDraft"
        autofocus
        aria-label="对话名称"
        placeholder="输入对话名称"
        @press-enter="confirmRename"
      />
    </Modal>
  </aside>
</template>

<style scoped>
.chat-sidebar :deep(.assistant-shortcut-button) {
  border-color: transparent;
  transition:
    background-color 160ms ease,
    color 160ms ease;
}
.chat-sidebar :deep(.assistant-shortcut-button:hover),
.chat-sidebar :deep(.assistant-shortcut-button:focus-visible),
.chat-sidebar :deep(.assistant-shortcut-button:active) {
  border-color: transparent;
}

/* 保留原因：以下全部是 antd/x Conversations 内部类（.antd-*）与滚动条伪元素的
   :deep 覆盖（含 menu trigger 由 h() 渲染进组件内部、依赖父项 hover 态），
   无法迁移为模板工具类。折叠态通过根节点 is-collapsed 类联动。 */
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
  min-height: 40px;
  padding-inline: 9px;
  border: 1px solid transparent;
  border-radius: 6px;
  color: var(--brand-muted);
  font-size: 11px;
  transition:
    background 160ms ease,
    border-color 160ms ease,
    color 160ms ease;
}
.chat-sidebar :deep(.antd-conversations-item:hover) {
  background: var(--brand-surface-subtle);
  color: var(--brand-foreground);
}
.chat-sidebar :deep(.antd-conversations-item-active) {
  border-color: color-mix(in srgb, var(--brand-primary) 18%, transparent);
  background: color-mix(in srgb, var(--brand-primary) 9%, var(--brand-sidebar));
  color: var(--brand-foreground);
  font-weight: 600;
}
.chat-sidebar :deep(.antd-conversations-item:focus-visible) {
  outline: 2px solid var(--brand-ring);
  outline-offset: 1px;
}
.chat-sidebar :deep(.antd-conversations-icon) {
  width: 18px;
  min-width: 18px;
  color: var(--brand-muted);
  font-size: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.chat-sidebar :deep(.antd-conversations-item-active .antd-conversations-icon) {
  color: var(--brand-primary);
}
.chat-sidebar :deep(.conversation-menu-trigger) {
  display: inline-grid;
  width: 28px;
  height: 28px;
  place-items: center;
  padding: 5px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--brand-muted);
  cursor: pointer;
  opacity: 0;
  transition:
    background 160ms ease,
    color 160ms ease,
    opacity 160ms ease;
}
.chat-sidebar :deep(.conversation-menu-trigger svg) {
  width: 16px;
  height: 16px;
}
.chat-sidebar :deep(.antd-conversations-item:hover .conversation-menu-trigger),
.chat-sidebar :deep(.antd-conversations-item-active .conversation-menu-trigger),
.chat-sidebar :deep(.conversation-menu-trigger:focus-visible) {
  opacity: 1;
}
.chat-sidebar :deep(.conversation-menu-trigger:hover) {
  background: var(--brand-surface-subtle);
  color: var(--brand-foreground);
}
.chat-sidebar.is-collapsed :deep(.conversation-menu-trigger) {
  display: none;
}
.chat-sidebar.is-collapsed .conversation-scroll,
.chat-sidebar.is-collapsed :deep(.antd-conversations) {
  scrollbar-width: none;
  -ms-overflow-style: none;
}
.chat-sidebar.is-collapsed .conversation-scroll::-webkit-scrollbar,
.chat-sidebar.is-collapsed :deep(.antd-conversations::-webkit-scrollbar) {
  display: none;
  width: 0;
  height: 0;
}
.chat-sidebar.is-collapsed :deep(.antd-conversations-group-title),
.chat-sidebar.is-collapsed :deep(.antd-conversations-label) {
  display: none;
}
.chat-sidebar.is-collapsed :deep(.antd-conversations-item) {
  display: grid;
  width: 40px;
  height: 40px;
  margin-inline: auto;
  place-items: center;
  gap: 0;
  padding: 0;
}
.chat-sidebar.is-collapsed :deep(.antd-conversations-icon) {
  display: grid;
  width: 18px;
  height: 18px;
  place-items: center;
  margin: 0;
}
.chat-sidebar.is-collapsed :deep(.antd-conversations-icon svg) {
  display: block;
  margin: auto;
}

@media (max-width: 820px) {
  .chat-sidebar.is-collapsed :deep(.antd-conversations-group-title),
  .chat-sidebar.is-collapsed :deep(.antd-conversations-label) {
    display: initial;
  }
  .chat-sidebar.is-collapsed :deep(.antd-conversations-item) {
    display: flex;
    width: auto;
    height: auto;
    margin-inline: 0;
    justify-content: initial;
    gap: 8px;
    padding-inline: 9px;
  }
  .chat-sidebar.is-collapsed :deep(.antd-conversations-icon) {
    display: flex;
    width: 18px;
    height: auto;
    margin: 0;
  }
  .chat-sidebar :deep(.antd-conversations-item) {
    min-height: 44px !important;
  }
}
</style>

<script setup lang="ts">
import {
  Ellipsis as MoreOutlined,
  MessageSquare as MessageOutlined,
  PanelLeftClose as MenuFoldOutlined,
  Search as SearchOutlined,
  Sparkles as RobotOutlined,
  SquarePen as EditOutlined,
} from "@lucide/vue";
import { Button, Tooltip } from "antdv-next";

type Conversation = { key: string; label: string; updated: string };

defineProps<{
  conversations: Conversation[];
  activeKey: string;
}>();

defineEmits<{
  select: [key: string];
  newChat: [];
  close: [];
}>();
</script>

<template>
  <aside
    class="demo-sidebar flex min-w-0 flex-col overflow-hidden border-r border-border bg-subtle pt-3 px-2.5 pb-2.5"
  >
    <div
      class="sidebar-brand-row flex items-center justify-between min-w-[218px] h-[38px] px-1 pb-2"
    >
      <a class="flex items-center min-h-11 gap-2 text-[13px] font-650" href="#top"
        ><span
          class="grid place-items-center w-[26px] h-[26px] rounded-[5px] bg-foreground text-background"
          ><RobotOutlined class="w-3.5 h-3.5" /></span
        >Open Chat</a
      >
      <Tooltip title="收起侧栏">
        <Button type="text" shape="circle" aria-label="收起侧栏" @click="$emit('close')">
          <MenuFoldOutlined class="w-[var(--icon-sm)] h-[var(--icon-sm)]" />
        </Button>
      </Tooltip>
    </div>

    <Button
      class="new-chat !grid grid-cols-[18px_1fr_auto] min-w-[218px] !h-[38px] !text-left"
      block
      @click="$emit('newChat')"
    >
      <template #icon><EditOutlined class="w-[var(--icon-sm)] h-[var(--icon-sm)]" /></template>
      新对话
      <kbd class="text-muted-foreground text-[10px]">⌘ K</kbd>
    </Button>

    <label
      class="demo-search flex items-center gap-2 min-w-[210px] h-[42px] px-2 text-muted-foreground"
    >
      <SearchOutlined class="w-[var(--icon-sm)] h-[var(--icon-sm)]" />
      <input
        type="search"
        aria-label="搜索对话"
        placeholder="搜索对话"
        class="min-w-0 flex-1 border-0 outline-none bg-transparent text-foreground text-xs"
      />
    </label>

    <nav
      class="flex min-w-[218px] min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto"
      aria-label="历史对话"
    >
      <span class="mt-2.5 mx-2 mb-[3px] text-muted-foreground text-[10px] font-600">今天</span>
      <button
        v-for="item in conversations.slice(0, 3)"
        :key="item.key"
        type="button"
        class="conversation-item grid grid-cols-[16px_minmax(0,1fr)] items-center gap-2 w-full min-h-[34px] px-2 border-0 rounded text-left text-[11px] cursor-pointer transition-colors duration-150"
        :class="
          activeKey === item.key
            ? 'bg-muted text-foreground'
            : 'bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground'
        "
        @click="$emit('select', item.key)"
      >
        <MessageOutlined class="w-[var(--icon-sm)] h-[var(--icon-sm)]" />
        <span class="truncate">{{ item.label }}</span>
      </button>
      <span class="mt-2.5 mx-2 mb-[3px] text-muted-foreground text-[10px] font-600">过去 7 天</span>
      <button
        type="button"
        class="conversation-item grid grid-cols-[16px_minmax(0,1fr)] items-center gap-2 w-full min-h-[34px] px-2 border-0 rounded text-left text-[11px] cursor-pointer transition-colors duration-150"
        :class="
          activeKey === conversations[3].key
            ? 'bg-muted text-foreground'
            : 'bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground'
        "
        @click="$emit('select', conversations[3].key)"
      >
        <MessageOutlined class="w-[var(--icon-sm)] h-[var(--icon-sm)]" />
        <span class="truncate">{{ conversations[3].label }}</span>
      </button>
    </nav>

    <div
      class="grid grid-cols-[28px_minmax(0,1fr)_20px] items-center gap-2 min-w-[218px] pt-2.5 px-[5px] border-t border-border"
    >
      <span
        class="grid place-items-center w-7 h-7 rounded-[5px] bg-foreground text-background text-[9px] font-700"
        >CC</span
      >
      <div class="flex min-w-0 flex-col">
        <strong class="text-[10px]">Carl Chen</strong
        ><small class="text-muted-foreground text-[9px]">Starter workspace</small>
      </div>
      <MoreOutlined class="w-[var(--icon-sm)] h-[var(--icon-sm)]" />
    </div>
  </aside>
</template>

<style scoped>
/* :deep() 覆盖 antd Button 内部尺寸 */
.sidebar-brand-row :deep(.ant-btn) {
  width: 32px;
  min-width: 32px;
  height: 32px;
}

/* 非常规断点（760px），保留在 style 块 */
@media (max-width: 760px) {
  .sidebar-brand-row :deep(.ant-btn) {
    width: 44px;
    min-width: 44px;
    height: 44px;
  }
  .new-chat,
  .conversation-item {
    min-height: 44px;
  }
  .demo-search {
    height: 44px;
  }
  .demo-search input {
    font-size: 16px;
  }
}
</style>

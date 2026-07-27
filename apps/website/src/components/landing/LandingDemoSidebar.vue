<script setup lang="ts">
import {
  ArrowUpRight,
  Ellipsis,
  MessageSquare,
  PanelLeftClose,
  Search,
  Sparkles,
  SquarePen,
  Zap,
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

const rowBaseClass =
  "grid w-full min-h-[42px] cursor-pointer items-center gap-[9px] rounded-[6px] border-0 bg-transparent px-[6px] py-[5px] text-left text-brand-foreground transition-colors duration-150 hover:bg-brand-surface-subtle";
</script>

<template>
  <aside
    id="landing-demo-sidebar"
    class="demo-sidebar flex min-w-0 flex-col overflow-hidden border-r border-solid border-brand-border bg-brand-sidebar pt-[10px] px-[10px] pb-[10px]"
  >
    <header class="flex h-[42px] items-center justify-between gap-[10px] pl-[5px] pr-[2px]">
      <a
        class="inline-flex min-w-0 cursor-pointer items-center gap-[9px] border-0 bg-transparent p-0 text-[14px] font-680 text-brand-foreground no-underline"
        href="#top"
      >
        <span
          class="grid h-[29px] w-[29px] flex-[0_0_29px] place-items-center rounded-[5px] bg-brand-primary text-brand-primary-foreground"
          aria-hidden="true"
        >
          <Sparkles class="!h-[15px] !w-[15px]" />
        </span>
        <span class="overflow-hidden whitespace-nowrap">Open Chat</span>
      </a>
      <Tooltip title="收起侧栏">
        <Button
          type="text"
          shape="circle"
          class="!h-[36px] !w-[36px] !min-w-[36px] !text-brand-muted hover:!bg-brand-surface-subtle hover:!text-brand-foreground"
          aria-label="收起侧栏"
          aria-controls="landing-demo-sidebar"
          :aria-expanded="true"
          @click="$emit('close')"
        >
          <PanelLeftClose class="!h-[15px] !w-[15px]" />
        </Button>
      </Tooltip>
    </header>

    <div class="mb-[7px] mt-[14px] flex flex-col gap-[12px]">
      <button
        class="grid min-h-[38px] w-full cursor-pointer grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-[9px] rounded-[6px] border-0 bg-brand-primary px-[10px] text-left text-[12px] font-620 text-brand-primary-foreground shadow-brand-xs hover:opacity-88"
        type="button"
        @click="$emit('newChat')"
      >
        <SquarePen class="!h-[15px] !w-[15px]" />
        <span>新对话</span>
        <kbd
          class="border-0 bg-transparent text-[9px] [color:color-mix(in_srgb,var(--brand-primary-foreground)_62%,transparent)] [font-family:inherit]"
          >⌘ K</kbd
        >
      </button>
      <label
        class="grid min-h-[38px] w-full cursor-text grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-[9px] rounded-[6px] border-0 px-[10px] text-left text-brand-muted hover:bg-brand-surface-subtle hover:text-brand-foreground focus-within:bg-brand-surface-subtle focus-within:text-brand-foreground"
      >
        <Search class="!h-[15px] !w-[15px]" />
        <input
          type="search"
          aria-label="搜索对话"
          placeholder="搜索对话"
          class="w-full min-w-0 border-0 bg-transparent p-0 text-[12px] text-brand-foreground outline-0"
        />
        <kbd class="border-0 bg-transparent text-[9px] text-brand-muted [font-family:inherit]"
          >⌘ F</kbd
        >
      </label>
    </div>

    <nav class="flex min-h-0 flex-1 flex-col gap-[2px] overflow-y-auto" aria-label="历史对话">
      <span class="mt-[10px] mx-[8px] mb-[3px] text-[10px] font-600 text-brand-muted">今天</span>
      <button
        v-for="item in conversations.slice(0, 3)"
        :key="item.key"
        type="button"
        class="grid w-full min-h-[34px] cursor-pointer grid-cols-[16px_minmax(0,1fr)] items-center gap-[9px] rounded-[6px] border-0 px-[8px] text-left text-[12px] transition-colors duration-150"
        :class="
          activeKey === item.key
            ? 'bg-brand-sidebar-active text-brand-foreground'
            : 'bg-transparent text-brand-muted hover:bg-brand-sidebar-hover hover:text-brand-foreground'
        "
        :aria-current="activeKey === item.key ? 'page' : undefined"
        @click="$emit('select', item.key)"
      >
        <MessageSquare class="!h-[14px] !w-[14px]" />
        <span class="truncate">{{ item.label }}</span>
      </button>
      <span class="mt-[10px] mx-[8px] mb-[3px] text-[10px] font-600 text-brand-muted"
        >过去 7 天</span
      >
      <button
        type="button"
        class="grid w-full min-h-[34px] cursor-pointer grid-cols-[16px_minmax(0,1fr)] items-center gap-[9px] rounded-[6px] border-0 px-[8px] text-left text-[12px] transition-colors duration-150"
        :class="
          activeKey === conversations[3]?.key
            ? 'bg-brand-sidebar-active text-brand-foreground'
            : 'bg-transparent text-brand-muted hover:bg-brand-sidebar-hover hover:text-brand-foreground'
        "
        :aria-current="activeKey === conversations[3]?.key ? 'page' : undefined"
        @click="$emit('select', conversations[3].key)"
      >
        <MessageSquare class="!h-[14px] !w-[14px]" />
        <span class="truncate">{{ conversations[3].label }}</span>
      </button>
    </nav>

    <footer class="pt-[10px]">
      <button :class="[rowBaseClass, 'grid-cols-[30px_minmax(0,1fr)_14px]']" type="button">
        <span
          class="grid h-[30px] w-[30px] place-items-center rounded-[5px] bg-brand-surface-subtle"
        >
          <Zap class="!h-[14px] !w-[14px]" />
        </span>
        <span class="flex min-w-0 flex-col">
          <strong class="text-[10px]">升级 Open Chat Pro</strong>
          <small class="text-[9px] text-brand-muted">解锁更多模型与用量</small>
        </span>
        <ArrowUpRight class="!h-[14px] !w-[14px] text-brand-muted" />
      </button>
      <button :class="[rowBaseClass, 'grid-cols-[30px_minmax(0,1fr)_14px]']" type="button">
        <span
          class="grid h-[30px] w-[30px] place-items-center rounded-[5px] bg-brand-primary text-[10px] font-700 text-brand-primary-foreground"
          >CC</span
        >
        <span class="flex min-w-0 flex-col">
          <strong class="truncate text-[12px] leading-[1.35]">Carl Chen</strong>
          <small class="truncate text-[10px] leading-[1.35] text-brand-muted"
            >carl@example.com</small
          >
        </span>
        <Ellipsis class="!h-[14px] !w-[14px] text-brand-muted" />
      </button>
    </footer>
  </aside>
</template>

<style scoped>
@media (max-width: 760px) {
  .demo-sidebar :deep(.ant-btn) {
    width: 44px;
    min-width: 44px;
    height: 44px;
  }
  .demo-sidebar button,
  .demo-sidebar label {
    min-height: 44px;
  }
  .demo-sidebar input {
    font-size: 16px;
  }
}
</style>

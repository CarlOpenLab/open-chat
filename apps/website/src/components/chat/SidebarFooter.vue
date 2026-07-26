<script setup lang="ts">
import {
  ArrowUpRight,
  CircleQuestionMark,
  Ellipsis,
  LogOut,
  Moon,
  Settings2,
  Sun,
  Zap,
} from "@lucide/vue";
import { Popover, message } from "antdv-next";
import { computed } from "vue";

interface Props {
  open: boolean;
  dark: boolean;
  accountOpen: boolean;
}

interface Emits {
  (e: "update:accountOpen", value: boolean): void;
  (e: "home"): void;
  (e: "toggleTheme"): void;
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

const accountOpenModel = computed({
  get: () => props.accountOpen,
  set: (value: boolean) => emit("update:accountOpen", value),
});

const rowBaseClass =
  "min-h-[48px] w-full cursor-pointer grid-cols-[30px_minmax(0,1fr)_16px] items-center gap-[9px] rounded-[6px] border-0 bg-transparent text-left text-brand-foreground [transition:background_160ms_ease] hover:bg-brand-surface-subtle";

const rowLayoutClass = computed(() =>
  props.open
    ? "grid px-[7px] py-[5px]"
    : "flex justify-center p-0 lt-md:grid lt-md:justify-normal lt-md:px-[7px] lt-md:py-[5px]",
);

const rowTextClass = computed(() => (props.open ? "flex" : "hidden lt-md:[display:initial]"));

const rowTrailingClass = computed(() => (props.open ? "" : "hidden lt-md:[display:initial]"));

const avatarClass =
  "grid h-[30px] w-[30px] flex-[0_0_30px] place-items-center rounded-[6px] border border-solid border-brand-border bg-brand-surface text-[10px] font-700 text-brand-foreground shadow-brand-xs";

const popoverItemClass =
  "grid min-h-[36px] w-full cursor-pointer grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-[9px] rounded-[4px] border-0 bg-transparent px-[7px] py-[4px] text-left text-[12px] text-brand-foreground hover:bg-brand-surface-subtle lt-md:min-h-[44px]";

const popoverDividerClass = "mx-[-5px] my-[5px] block h-[1px] bg-brand-border";

const handleLogout = () => {
  emit("update:accountOpen", false);
  emit("home");
};
</script>

<template>
  <footer class="border-t border-solid border-brand-border pt-[8px]">
    <button
      :class="[rowBaseClass, rowLayoutClass]"
      type="button"
      @click="message.info('Pro 版本即将开放')"
    >
      <span
        class="grid h-[30px] w-[30px] place-items-center rounded-[5px] border border-solid border-brand-border bg-brand-surface shadow-brand-xs"
      >
        <Zap class="!h-[14px] !w-[14px]" />
      </span>
      <span class="min-w-0 flex-col" :class="rowTextClass">
        <strong class="text-[10px]">升级 Open Chat Pro</strong>
        <small class="text-[9px] text-brand-muted">解锁更多模型与用量</small>
      </span>
      <ArrowUpRight class="!h-[14px] !w-[14px] text-brand-muted" :class="rowTrailingClass" />
    </button>

    <Popover v-model:open="accountOpenModel" placement="topLeft" :arrow="false" trigger="click">
      <template #content>
        <div class="account-popover w-[256px]">
          <div class="grid grid-cols-[32px_minmax(0,1fr)] items-center gap-[9px] p-[7px]">
            <span :class="avatarClass">CC</span>
            <span class="flex min-w-0 flex-col">
              <strong class="text-[11px]">Carl Chen</strong>
              <small class="text-[9px] text-brand-muted">carl@example.com</small>
            </span>
          </div>
          <i :class="popoverDividerClass"></i>
          <button :class="popoverItemClass" type="button" @click="message.info('设置即将开放')">
            <Settings2 class="!h-[14px] !w-[14px] text-brand-muted" /><span>设置</span>
          </button>
          <button :class="popoverItemClass" type="button" @click="emit('toggleTheme')">
            <Sun v-if="dark" class="!h-[14px] !w-[14px] text-brand-muted" />
            <Moon v-else class="!h-[14px] !w-[14px] text-brand-muted" />
            <span>{{ dark ? "浅色模式" : "深色模式" }}</span>
            <kbd
              class="ml-auto border-0 bg-transparent text-[9px] text-brand-muted [font-family:inherit]"
              >⌘ ⇧ L</kbd
            >
          </button>
          <button :class="popoverItemClass" type="button" @click="message.info('帮助中心即将开放')">
            <CircleQuestionMark class="!h-[14px] !w-[14px] text-brand-muted" /><span
              >帮助与反馈</span
            >
          </button>
          <i :class="popoverDividerClass"></i>
          <button :class="popoverItemClass" type="button" @click="handleLogout">
            <LogOut class="!h-[14px] !w-[14px] text-brand-muted" /><span>退出工作区</span>
          </button>
        </div>
      </template>
      <button
        :class="[rowBaseClass, rowLayoutClass, accountOpen ? 'bg-brand-surface-subtle' : '']"
        type="button"
        aria-haspopup="menu"
        :aria-expanded="accountOpen"
      >
        <span :class="avatarClass">CC</span>
        <span class="min-w-0 flex-col" :class="rowTextClass">
          <strong class="truncate text-[12px] leading-[1.35]">Carl Chen</strong>
          <small class="truncate text-[10px] leading-[1.35] text-brand-muted"
            >carl@example.com</small
          >
        </span>
        <Ellipsis class="!h-[14px] !w-[14px] text-brand-muted" :class="rowTrailingClass" />
      </button>
    </Popover>
  </footer>
</template>

<style scoped>
/* 保留原因：:global + :has 选择器覆盖 antd Popover 容器内部样式，无法用工具类表达 */
:global(.ant-popover-inner:has(.account-popover)) {
  padding: 5px !important;
  border: 1px solid var(--brand-border);
  border-radius: 7px !important;
  background: var(--brand-surface) !important;
  box-shadow: var(--shadow-xl) !important;
}
</style>

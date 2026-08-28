<script setup lang="ts">
import {
  Archive,
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  Download,
  Link2,
  Pencil,
  Pin,
  PanelLeftOpen,
  PanelRight,
  Trash2,
  X,
} from "@lucide/vue";
import { Button, Dropdown, Tooltip, message, type MenuProps } from "antdv-next";
import { computed, h, nextTick, ref, watch } from "vue";

interface Props {
  title: string;
  sidebarOpen: boolean;
  rightPanelOpen: boolean;
  rightPanelAvailable?: boolean;
  syncing?: boolean;
  canGoBack?: boolean;
  canGoForward?: boolean;
  /** 工作区草稿相对 AI 版本的增删行数，两者皆为 0 时不展示 */
  diffAdded?: number;
  diffRemoved?: number;
  /** 是否显示右上角关闭抽屉按钮 */
  showClose?: boolean;
}
interface Emits {
  (e: "toggleSidebar"): void;
  (e: "navigateBack"): void;
  (e: "navigateForward"): void;
  (e: "toggleRightPanel"): void;
  (e: "export"): void;
  (e: "rename", title: string): void;
  (e: "pin"): void;
  (e: "archive"): void;
  (e: "delete"): void;
  (e: "close"): void;
}
const props = withDefaults(defineProps<Props>(), {
  rightPanelAvailable: true,
  syncing: false,
  canGoBack: false,
  canGoForward: false,
  diffAdded: 0,
  diffRemoved: 0,
  showClose: false,
});
const emit = defineEmits<Emits>();

const hasDiff = computed(() => props.diffAdded > 0 || props.diffRemoved > 0);

const handleCopyLink = async () => {
  try {
    await navigator.clipboard.writeText(window.location.href);
    message.success("会话链接已复制");
  } catch {
    message.error("复制失败，请手动复制地址栏链接");
  }
};

const editing = ref(false);
const draftTitle = ref(props.title);
const titleInput = ref<HTMLInputElement>();

const iconButtonClass =
  "grid h-[26px] w-[26px] flex-none place-items-center rounded-[6px] border-0 bg-transparent p-0 text-brand-muted-strong cursor-pointer hover:bg-brand-surface-subtle hover:text-brand-foreground active:opacity-80";

watch(
  () => props.title,
  (title) => {
    if (!editing.value) draftTitle.value = title;
  },
);

const beginRename = () => {
  draftTitle.value = props.title;
  editing.value = true;
  void nextTick(() => {
    titleInput.value?.focus();
    titleInput.value?.select();
  });
};

const finishRename = () => {
  if (!editing.value) return;
  editing.value = false;
  emit("rename", draftTitle.value.trim() || "未命名对话");
};

const cancelRename = () => {
  draftTitle.value = props.title;
  editing.value = false;
};

const titleMenu = computed<MenuProps>(() => ({
  items: [
    { key: "rename", label: "重命名", icon: h(Pencil) },
    { key: "pin", label: "置顶对话", icon: h(Pin) },
    { key: "archive", label: "归档对话", icon: h(Archive) },
    { key: "export", label: "导出聊天记录", icon: h(Download) },
    { type: "divider" },
    { key: "delete", label: "删除对话", icon: h(Trash2), danger: true },
  ],
  onClick: ({ key }) => {
    if (key === "rename") beginRename();
    if (key === "pin") emit("pin");
    if (key === "archive") emit("archive");
    if (key === "export") emit("export");
    if (key === "delete") emit("delete");
  },
}));
</script>

<template>
  <header
    class="relative z-20 flex h-[48px] min-w-0 flex-none items-center gap-2 bg-brand-workspace pr-[14px]"
    :class="sidebarOpen ? 'pl-[14px]' : 'pl-[10px]'"
  >
    <!-- 侧栏收起时：折叠按钮 + 历史导航 -->
    <template v-if="!sidebarOpen">
      <Tooltip title="展开侧边栏">
        <Button
          type="text"
          size="small"
          :icon="h(PanelLeftOpen)"
          class="!w-[26px] !h-[26px] !p-0 !text-brand-muted-strong hover:!text-brand-foreground hover:!bg-brand-surface-subtle"
          aria-label="展开侧边栏"
          @click="emit('toggleSidebar')"
        />
      </Tooltip>
      <Button
        type="text"
        size="small"
        :icon="h(ArrowLeft)"
        :class="canGoBack ? '' : 'opacity-35'"
        :disabled="!canGoBack"
        class="!w-[26px] !h-[26px] !p-0 !text-brand-muted-strong hover:!text-brand-foreground hover:!bg-brand-surface-subtle"
        aria-label="返回上一个会话"
        @click="emit('navigateBack')"
      />
      <Button
        type="text"
        size="small"
        :icon="h(ArrowRight)"
        :class="canGoForward ? '' : 'opacity-35'"
        :disabled="!canGoForward"
        class="!w-[26px] !h-[26px] !p-0 !text-brand-muted-strong hover:!text-brand-foreground hover:!bg-brand-surface-subtle"
        aria-label="前进到下一个会话"
        @click="emit('navigateForward')"
      />
    </template>

    <!-- 会话标题 -->
    <input
      v-if="editing"
      ref="titleInput"
      v-model="draftTitle"
      class="h-8 w-[min(38vw,460px)] min-w-0 border border-solid border-brand-border-strong rounded-[5px] bg-brand-surface px-[6px] py-0 text-[13px] font-medium text-brand-foreground outline-0 focus:border-brand-foreground focus:shadow-[0_0_0_2px_var(--brand-ring)]"
      aria-label="重命名对话"
      @blur="finishRename"
      @keydown.enter.prevent="finishRename"
      @keydown.esc.prevent="cancelRename"
    />
    <Dropdown v-else :menu="titleMenu" :trigger="['click']">
      <Button
        type="text"
        size="small"
        class="!flex !min-h-[26px] !min-w-0 !items-center !gap-[2px] !border-0 !rounded !py-0 !pl-1 !pr-1 !text-brand-foreground hover:!bg-brand-surface-subtle"
        aria-label="对话选项"
      >
        <span class="max-w-[min(38vw,460px)] truncate pl-[2px] text-[13px] font-medium">{{
          title
        }}</span>
        <ChevronDown class="!h-3.5 !w-3.5 text-brand-muted-strong" />
      </Button>
    </Dropdown>
    <div class="min-w-0 flex-1" />

    <!-- 右侧：diff 统计 + 保存状态 + 右侧面板开关 -->
    <span
      v-if="hasDiff"
      class="mr-[6px] flex flex-none items-center gap-[7px] text-[11px] font-medium tabular-nums"
      :aria-label="`工作区改动：新增 ${diffAdded} 行，删除 ${diffRemoved} 行`"
    >
      <span class="text-brand-success">+{{ diffAdded }}</span>
      <span class="text-brand-danger">-{{ diffRemoved }}</span>
    </span>

    <span
      v-if="syncing"
      class="mr-1 flex items-center gap-[6px] text-[10px] text-brand-muted-strong"
      ><span class="sync-dot" /><span>处理中</span></span
    >
    <Tooltip title="复制当前会话链接">
      <Button
        type="text"
        size="small"
        :icon="h(Link2)"
        class="!w-[26px] !h-[26px] !p-0 !text-brand-muted-strong hover:!text-brand-foreground hover:!bg-brand-surface-subtle"
        aria-label="复制当前会话链接"
        @click="handleCopyLink"
      />
    </Tooltip>
    <Tooltip v-if="rightPanelAvailable" :title="rightPanelOpen ? '收起右侧面板' : '展开右侧面板'">
      <Button
        type="text"
        size="small"
        :icon="h(PanelRight, { class: rightPanelOpen ? 'text-brand-foreground' : '' })"
        :class="rightPanelOpen ? '!bg-brand-surface-subtle' : ''"
        class="!w-[26px] !h-[26px] !p-0 !text-brand-muted-strong hover:!text-brand-foreground hover:!bg-brand-surface-subtle"
        :aria-label="rightPanelOpen ? '收起右侧面板' : '展开右侧面板'"
        :aria-pressed="rightPanelOpen"
        @click="emit('toggleRightPanel')"
      />
    </Tooltip>
    <Tooltip v-if="showClose" title="关闭抽屉">
      <Button
        type="text"
        size="small"
        :icon="h(X)"
        class="!w-[26px] !h-[26px] !p-0 !ml-1 !text-brand-muted-strong hover:!text-brand-foreground hover:!bg-brand-surface-subtle"
        aria-label="关闭抽屉"
        @click="emit('close')"
      />
    </Tooltip>
  </header>
</template>

<style scoped>
.sync-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--brand-accent);
  animation: sync-pulse 900ms ease-in-out infinite;
}
@keyframes sync-pulse {
  50% {
    opacity: 0.35;
  }
}
</style>

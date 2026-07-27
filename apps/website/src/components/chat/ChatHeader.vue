<script setup lang="ts">
import {
  Archive,
  ChevronDown,
  Cloud,
  Download,
  FolderOpen,
  PanelLeftOpen,
  Pencil,
  Pin,
  Sparkles,
  Trash2,
} from "@lucide/vue";
import { Dropdown, Tooltip, type MenuProps } from "antdv-next";
import { computed, h, nextTick, ref, watch } from "vue";

interface Props {
  title: string;
  sidebarOpen: boolean;
  workspaceAvailable?: boolean;
  workspaceOpen?: boolean;
  syncing?: boolean;
  assistantName?: string;
  assistantVersion?: string;
}

interface Emits {
  (e: "toggleSidebar"): void;
  (e: "toggleWorkspace"): void;
  (e: "export"): void;
  (e: "rename", title: string): void;
  (e: "pin"): void;
  (e: "archive"): void;
  (e: "delete"): void;
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();
const editing = ref(false);
const draftTitle = ref(props.title);
const titleInput = ref<HTMLInputElement>();

const iconButtonClass =
  "h-9 w-9 min-w-9 place-items-center border border-solid border-transparent rounded-md bg-transparent p-0 text-brand-muted cursor-pointer [transition:background_160ms_ease,color_160ms_ease,transform_160ms_ease] hover:bg-brand-surface-subtle hover:text-brand-foreground active:translate-y-[1px] lt-md:h-11 lt-md:min-h-11 lt-md:w-11 lt-md:min-w-11";

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
    class="relative z-20 flex min-h-[58px] min-w-0 items-center justify-between gap-4 border-b border-b-solid border-brand-border px-4 [background:color-mix(in_srgb,var(--brand-workspace)_90%,transparent)] backdrop-blur-[16px] lt-md:min-h-14 lt-md:px-[10px]"
  >
    <div class="flex min-w-0 items-center gap-[9px]">
      <Tooltip v-if="!sidebarOpen" title="展开侧边栏">
        <button
          class="hidden lt-md:inline-grid"
          :class="iconButtonClass"
          type="button"
          aria-label="展开侧边栏"
          @click="emit('toggleSidebar')"
        >
          <PanelLeftOpen />
        </button>
      </Tooltip>
      <span
        v-if="!sidebarOpen"
        class="hidden h-5 w-px bg-brand-border lt-md:block"
        aria-hidden="true"
      ></span>
      <input
        v-if="editing"
        ref="titleInput"
        v-model="draftTitle"
        class="h-8 w-[min(38vw,460px)] border border-solid border-brand-border-strong rounded-[5px] bg-brand-surface px-[6px] py-0 text-[13px] font-650 text-brand-foreground outline-0 focus:border-brand-foreground focus:shadow-[0_0_0_2px_var(--brand-ring)] lt-md:min-h-11"
        aria-label="重命名对话"
        @blur="finishRename"
        @keydown.enter.prevent="finishRename"
        @keydown.esc.prevent="cancelRename"
      />
      <Dropdown v-else :menu="titleMenu" :trigger="['click']">
        <button
          class="conversation-heading flex min-h-8 min-w-0 items-center gap-[2px] border-0 rounded bg-transparent py-0 pl-0 pr-1 text-brand-foreground cursor-pointer hover:bg-brand-surface-subtle lt-md:min-h-11"
          type="button"
          aria-label="对话选项"
        >
          <span
            class="max-w-[min(38vw,460px)] truncate pl-[6px] text-[13px] font-650 lt-md:max-w-[36vw] lt-sm:max-w-[42vw] lt-sm:text-[12px]"
            >{{ title }}</span
          ><ChevronDown class="!h-3.5 !w-3.5 text-brand-muted" />
        </button>
      </Dropdown>
      <span
        v-if="assistantName"
        class="ml-1 inline-flex min-h-8 max-w-[190px] items-center gap-[5px] rounded-[5px] border border-solid border-brand-border bg-brand-surface-subtle px-2 text-[10px] font-620 text-brand-muted lt-md:min-h-11"
        :aria-label="`当前助手：${assistantName}`"
      >
        <Sparkles class="!h-[12px] !w-[12px]" />
        <span class="truncate">{{ assistantName }}</span>
        <span v-if="assistantVersion" class="text-[9px] text-brand-muted"
          >v{{ assistantVersion }}</span
        >
      </span>
    </div>

    <div class="flex min-w-0 items-center gap-1" aria-label="对话工具">
      <span class="mr-[6px] flex items-center gap-[6px] text-[10px] text-brand-muted lt-md:hidden"
        ><Cloud class="!h-[13px] !w-[13px]" :class="{ 'sync-pulse': syncing }" /><span>{{
          syncing ? "保存中" : "已同步"
        }}</span></span
      >
      <Tooltip v-if="workspaceAvailable" title="文件工作区">
        <button
          class="inline-grid aria-pressed:bg-brand-surface-subtle aria-pressed:text-brand-foreground"
          :class="iconButtonClass"
          type="button"
          :aria-label="workspaceOpen ? '关闭文件工作区' : '打开文件工作区'"
          :aria-pressed="workspaceOpen"
          @click="emit('toggleWorkspace')"
        >
          <FolderOpen />
        </button>
      </Tooltip>
    </div>
  </header>
</template>

<style scoped>
/* 保留：@keyframes 动画 */
.sync-pulse {
  animation: soft-pulse 900ms ease-in-out infinite;
}
@keyframes soft-pulse {
  50% {
    opacity: 0.35;
  }
}
/* 保留：非常规断点 390px */
@media (max-width: 390px) {
  .conversation-heading span {
    max-width: 38vw;
  }
}
</style>

<script setup lang="ts">
import { Files, Gauge, X } from "@lucide/vue";
import { Progress, Tooltip } from "antdv-next";
import { ref, watch } from "vue";
import type { EditableWorkspaceFile } from "../../utils/fileWorkspace";
import FileWorkspace from "./FileWorkspace.vue";

type RightPanelTab = "files" | "usage";

interface Props {
  open: boolean;
  dark: boolean;
  files: EditableWorkspaceFile[];
  workspacePending?: boolean;
  selectedPath?: string[];
}

interface Emits {
  (e: "update:open", value: boolean): void;
  (e: "update:selectedPath", path: string[]): void;
  (e: "fileChange", payload: { path: string; content: string }): void;
  (e: "resetFile", path: string): void;
  (e: "acceptIncoming", path: string): void;
}

const props = withDefaults(defineProps<Props>(), {
  workspacePending: false,
  selectedPath: () => [],
});
const emit = defineEmits<Emits>();

const activeTab = ref<RightPanelTab>("files");

watch(
  () => props.open,
  (open) => {
    if (open && props.files.length === 0) activeTab.value = "usage";
  },
);

const usagePercent = 34;
</script>

<template>
  <Transition name="panel">
    <aside
      v-if="open"
      class="flex h-full min-w-0 flex-1 flex-col overflow-hidden border-l border-l-solid border-l-brand-border bg-brand-workspace"
      :aria-hidden="!open"
      aria-label="右侧面板"
    >
      <div
        class="flex h-[38px] flex-none items-center gap-1 border-b border-b-solid border-b-brand-border px-2"
      >
        <Tooltip title="文件工作区">
          <button
            type="button"
            class="grid h-[26px] w-[26px] place-items-center rounded-[6px] border-0 bg-transparent p-0 text-brand-muted hover:bg-brand-surface-subtle hover:text-brand-foreground"
            :class="activeTab === 'files' ? 'bg-brand-surface-subtle text-brand-foreground' : ''"
            :aria-pressed="activeTab === 'files'"
            aria-label="文件工作区"
            @click="activeTab = 'files'"
          >
            <Files class="!h-[14px] !w-[14px]" />
          </button>
        </Tooltip>
        <Tooltip title="用量">
          <button
            type="button"
            class="grid h-[26px] w-[26px] place-items-center rounded-[6px] border-0 bg-transparent p-0 text-brand-muted hover:bg-brand-surface-subtle hover:text-brand-foreground"
            :class="activeTab === 'usage' ? 'bg-brand-surface-subtle text-brand-foreground' : ''"
            :aria-pressed="activeTab === 'usage'"
            aria-label="用量"
            @click="activeTab = 'usage'"
          >
            <Gauge class="!h-[14px] !w-[14px]" />
          </button>
        </Tooltip>
        <div class="flex-1" />
        <Tooltip title="关闭面板">
          <button
            type="button"
            class="grid h-[26px] w-[26px] place-items-center rounded-[6px] border-0 bg-transparent p-0 text-brand-muted hover:bg-brand-surface-subtle hover:text-brand-foreground"
            aria-label="关闭右侧面板"
            @click="emit('update:open', false)"
          >
            <X class="!h-[14px] !w-[14px]" />
          </button>
        </Tooltip>
      </div>

      <div class="min-h-0 flex-1 overflow-hidden">
        <FileWorkspace
          v-if="activeTab === 'files'"
          :open="true"
          :embedded="true"
          :files="files"
          :pending="workspacePending"
          :dark="dark"
          :selected-path="selectedPath"
          @update:selected-path="emit('update:selectedPath', $event)"
          @file-change="emit('fileChange', $event)"
          @reset-file="emit('resetFile', $event)"
          @accept-incoming="emit('acceptIncoming', $event)"
        />

        <section v-else class="flex h-full flex-col overflow-y-auto p-5" aria-label="用量">
          <h2 class="mb-1 text-[13px] font-semibold text-brand-foreground">本月用量</h2>
          <p class="mb-5 text-[11px] text-brand-muted">模型调用与 token 消耗概览</p>
          <div class="rounded-[10px] border border-solid border-brand-border bg-brand-surface p-4">
            <div class="mb-2 flex items-center justify-between text-[11px]">
              <span class="text-brand-muted">配额使用</span>
              <span class="font-semibold text-brand-foreground">{{ usagePercent }}%</span>
            </div>
            <Progress
              :percent="usagePercent"
              :show-info="false"
              :stroke-color="'#3B82F6'"
              :trail-color="'var(--brand-surface-subtle)'"
              :size="4"
            />
            <p class="mt-3 mb-0 text-[10.5px] leading-[15px] text-brand-muted-strong">
              本地演示环境不产生真实计费，此面板仅展示用量 UI。
            </p>
          </div>
        </section>
      </div>
    </aside>
  </Transition>
</template>

<style scoped>
.panel-enter-active,
.panel-leave-active {
  transition:
    opacity 160ms ease,
    transform 160ms ease;
}
.panel-enter-from {
  opacity: 0;
  transform: translateX(12px);
}
.panel-leave-to {
  opacity: 0;
  transform: translateX(12px);
}
</style>

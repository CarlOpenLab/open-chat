<script setup lang="ts">
import { Download, FileText, LoaderCircle, RotateCcw, Sparkles, X } from "@lucide/vue";
import { Tooltip } from "antdv-next";
import type { EditableWorkspaceFile } from "../../utils/fileWorkspace";

interface Props {
  fileCount: number;
  dirtyCount: number;
  pending: boolean;
  selectedFile?: EditableWorkspaceFile;
}

interface Emits {
  (e: "close"): void;
  (e: "download"): void;
  (e: "accept", path: string): void;
  (e: "reset", path: string): void;
}

defineProps<Props>();
const emit = defineEmits<Emits>();

const actionButtonClass =
  "grid h-9 w-9 place-items-center border-0 rounded-md bg-transparent p-0 text-brand-muted cursor-pointer hover:enabled:bg-brand-surface-subtle hover:enabled:text-brand-foreground disabled:cursor-not-allowed disabled:opacity-40";
</script>

<template>
  <header
    class="workspace-header flex h-[58px] flex-[0_0_58px] items-center justify-between gap-4 border-b border-b-solid border-brand-border py-0 pl-4 pr-[11px]"
  >
    <div class="flex min-w-0 items-center gap-[9px]">
      <FileText class="text-brand-muted" />
      <span class="flex min-w-0 flex-col items-start">
        <strong class="text-[12px]">文件工作区</strong>
        <small class="text-[9px] text-brand-muted lt-sm:max-w-[112px] lt-sm:truncate">
          {{ fileCount }} 个文件<template v-if="dirtyCount"> · {{ dirtyCount }} 项已编辑</template>
        </small>
      </span>
      <LoaderCircle v-if="pending" class="workspace-spinner text-brand-muted" />
    </div>
    <div class="workspace-actions flex min-w-0 items-center gap-[2px]">
      <Tooltip v-if="selectedFile?.hasIncomingChange" title="采用 AI 新版本">
        <button
          :class="actionButtonClass"
          type="button"
          aria-label="采用 AI 新版本"
          @click="emit('accept', selectedFile.path)"
        >
          <Sparkles />
        </button>
      </Tooltip>
      <Tooltip v-if="selectedFile?.dirty" title="恢复 AI 版本">
        <button
          :class="actionButtonClass"
          type="button"
          aria-label="恢复 AI 版本"
          @click="emit('reset', selectedFile.path)"
        >
          <RotateCcw />
        </button>
      </Tooltip>
      <Tooltip title="下载文件">
        <button
          :class="actionButtonClass"
          type="button"
          aria-label="下载当前文件"
          :disabled="!selectedFile"
          @click="emit('download')"
        >
          <Download />
        </button>
      </Tooltip>
      <Tooltip title="关闭文件工作区">
        <button
          :class="actionButtonClass"
          type="button"
          aria-label="关闭文件工作区"
          @click="emit('close')"
        >
          <X />
        </button>
      </Tooltip>
    </div>
  </header>
</template>

<style scoped>
/* 保留：@keyframes 动画 */
.workspace-spinner {
  animation: workspace-spin 900ms linear infinite;
}
@keyframes workspace-spin {
  to {
    transform: rotate(360deg);
  }
}
/* 保留：非常规断点 767px */
@media (max-width: 767px) {
  .workspace-header {
    height: 56px;
    flex-basis: 56px;
  }
  .workspace-actions button {
    width: 44px;
    height: 44px;
  }
}
</style>

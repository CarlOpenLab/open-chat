<script setup lang="ts">
import { Copy } from "@lucide/vue";
import { Segmented, Tooltip } from "antdv-next";
import { computed } from "vue";
import type { EditableWorkspaceFile } from "../../utils/fileWorkspace";

interface Props {
  title: string;
  file?: EditableWorkspaceFile;
  markdown?: boolean;
  view: "edit" | "preview";
}

interface Emits {
  (e: "update:view", view: "edit" | "preview"): void;
  (e: "copy"): void;
}

const props = withDefaults(defineProps<Props>(), {
  file: undefined,
  markdown: false,
});
const emit = defineEmits<Emits>();

const statusLabel = computed(() => {
  if (props.file?.hasIncomingChange) return "AI 有新版本";
  if (props.file?.status === "streaming") return "生成中 · 只读";
  if (props.file?.dirty) return "已保存";
  return "AI 原始版本";
});

const statusClass = computed(() => {
  if (props.file?.hasIncomingChange) return "text-[color:var(--brand-warning,#b7791f)]";
  if (props.file?.dirty) return "text-brand-primary";
  return "text-brand-muted";
});
</script>

<template>
  <div class="flex w-full min-w-0 items-center justify-between gap-3">
    <div class="flex min-w-0 items-center gap-[7px] overflow-hidden">
      <strong class="truncate text-[11px]">{{ title }}</strong>
      <span class="flex-none text-[9px]" :class="statusClass">{{ statusLabel }}</span>
    </div>
    <div class="flex flex-none min-w-0 items-center gap-[5px]">
      <Segmented
        v-if="markdown"
        :value="view"
        size="small"
        :options="[
          { label: '编辑', value: 'edit' },
          { label: '预览', value: 'preview' },
        ]"
        @update:value="emit('update:view', $event as 'edit' | 'preview')"
      />
      <Tooltip title="复制文件内容">
        <button
          class="grid h-7 w-7 place-items-center border-0 rounded-[5px] bg-transparent p-0 text-brand-muted cursor-pointer hover:bg-brand-surface-subtle hover:text-brand-foreground"
          type="button"
          aria-label="复制文件内容"
          @click="emit('copy')"
        >
          <Copy class="!h-[13px] !w-[13px]" />
        </button>
      </Tooltip>
    </div>
  </div>
</template>

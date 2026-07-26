<script setup lang="ts">
import { BrainCircuit, FolderOpen, Globe2 } from "@lucide/vue";
import { Switch } from "antdv-next";

interface Props {
  searchAvailable: boolean;
  searchEnabled: boolean;
  thinkingEnabled: boolean;
  fileModeEnabled: boolean;
}

interface Emits {
  (e: "searchChange", value: boolean): void;
  (e: "thinkingChange", value: boolean): void;
  (e: "fileModeChange", value: boolean): void;
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();
</script>

<template>
  <!-- .tools-menu 类名保留，供 :global(.ant-popover-inner:has(.tools-menu)) hack 定位 -->
  <div class="tools-menu w-[302px] lt-sm:w-[min(302px,calc(100vw_-_20px))] p-[5px]">
    <p class="mt-[3px] mx-[7px] mb-[6px] text-brand-muted text-[10px] font-600">增强回答</p>
    <button
      v-if="props.searchAvailable"
      type="button"
      class="grid grid-cols-[34px_minmax(0,1fr)_30px] items-center gap-[10px] w-full min-h-[58px] py-[7px] px-2 border-0 rounded-[4px] bg-transparent text-brand-foreground text-left cursor-pointer hover:bg-brand-surface-subtle"
      @click="emit('searchChange', !props.searchEnabled)"
    >
      <span
        class="grid w-8 h-8 place-items-center border border-solid border-brand-border rounded-[5px] bg-brand-surface"
        ><Globe2 class="w-[15px] h-[15px]" /></span
      ><span class="flex min-w-0 flex-col"
        ><strong class="text-[11px]">联网搜索</strong
        ><small class="text-brand-muted text-[9px]">查找并引用最新信息</small></span
      ><Switch :checked="props.searchEnabled" size="small" />
    </button>
    <button
      type="button"
      class="grid grid-cols-[34px_minmax(0,1fr)_30px] items-center gap-[10px] w-full min-h-[58px] py-[7px] px-2 border-0 rounded-[4px] bg-transparent text-brand-foreground text-left cursor-pointer hover:bg-brand-surface-subtle"
      @click="emit('thinkingChange', !props.thinkingEnabled)"
    >
      <span
        class="grid w-8 h-8 place-items-center border border-solid border-brand-border rounded-[5px] bg-brand-surface"
        ><BrainCircuit class="w-[15px] h-[15px]" /></span
      ><span class="flex min-w-0 flex-col"
        ><strong class="text-[11px]">深度思考</strong
        ><small class="text-brand-muted text-[9px]">为复杂问题投入更多时间</small></span
      ><Switch :checked="props.thinkingEnabled" size="small" />
    </button>
    <button
      type="button"
      class="grid grid-cols-[34px_minmax(0,1fr)_30px] items-center gap-[10px] w-full min-h-[58px] py-[7px] px-2 border-0 rounded-[4px] bg-transparent text-brand-foreground text-left cursor-pointer hover:bg-brand-surface-subtle"
      @click="emit('fileModeChange', !props.fileModeEnabled)"
    >
      <span
        class="grid w-8 h-8 place-items-center border border-solid border-brand-border rounded-[5px] bg-brand-surface"
        ><FolderOpen class="w-[15px] h-[15px]" /></span
      ><span class="flex min-w-0 flex-col"
        ><strong class="text-[11px]">文件</strong
        ><small class="text-brand-muted text-[9px]">生成可预览和下载的文件</small></span
      ><Switch :checked="props.fileModeEnabled" size="small" />
    </button>
  </div>
</template>

<style scoped>
/* :global + :has() hack：去掉 antd Popover 容器内边距并统一外观，需保留 */
:global(.ant-popover-inner:has(.tools-menu)) {
  padding: 0 !important;
  border: 1px solid var(--brand-border);
  border-radius: 7px !important;
  background: var(--brand-surface) !important;
  box-shadow: var(--shadow-xl) !important;
}
</style>

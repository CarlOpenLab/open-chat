<script setup lang="ts">
/**
 * 顶部切换栏（展示层）：
 * - 页面顶端常驻一条 1px 横线（两端渐隐），作为视觉锚点；
 * - 鼠标悬停顶部热区时，居中淡入一枚 Segmented，用于切换 看板 / 对话 两种布局；
 * - 热区只占顶部几像素并透传其余点击，不影响页面内容。
 */
import { Segmented } from "antdv-next";
import type { WorkspaceViewMode } from "../../pages/workspace";

interface Props {
  modelValue: WorkspaceViewMode;
}

interface Emits {
  (e: "update:modelValue", value: WorkspaceViewMode): void;
}

defineProps<Props>();
const emit = defineEmits<Emits>();

const viewOptions: { label: string; value: WorkspaceViewMode }[] = [
  { label: "看板", value: "board" },
  { label: "对话", value: "chat" },
];
</script>

<template>
  <div
    class="top-tabbar pointer-events-none absolute inset-x-0 top-0 z-50 h-[44px]"
    data-testid="top-tabbar"
  >
    <!-- 顶部热区：悬停这里唤起 Segmented -->
    <div
      class="top-tabbar-hotzone pointer-events-auto absolute inset-x-0 top-0 h-[6px]"
      aria-hidden="true"
    ></div>

    <!-- 常驻横线：中间实、两端渐隐 -->
    <div
      class="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand-border to-transparent"
      aria-hidden="true"
    ></div>

    <!-- 居中 Segmented：默认隐藏，hover 热区或自身时淡入 -->
    <div class="top-tabbar-popover absolute top-[5px] left-1/2">
      <Segmented
        :value="modelValue"
        :options="viewOptions"
        size="small"
        class="top-tabbar-segmented"
        @change="emit('update:modelValue', $event as WorkspaceViewMode)"
      />
    </div>
  </div>
</template>

<style scoped>
.top-tabbar-popover {
  transform: translate(-50%, -8px);
  opacity: 0;
  pointer-events: none;
  transition:
    opacity 200ms ease,
    transform 200ms ease;
}

/* 悬停热区或浮出的 Segmented 本身时保持可见 */
.top-tabbar:hover .top-tabbar-popover,
.top-tabbar-popover:hover {
  transform: translate(-50%, 0);
  opacity: 1;
  pointer-events: auto;
}
</style>

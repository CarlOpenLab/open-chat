<script setup lang="ts">
/**
 * 顶部切换栏（展示层）：
 * - 页面顶端常驻一条 1px 横线（两端渐隐），作为视觉锚点；
 * - 横线中点常驻一枚居中的 Segmented 胶囊，随时可点击 / 键盘切换
 *   看板 / 对话 两种布局（不再依赖 hover 热区，触控与键盘可达）。
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
    <!-- 常驻横线：中间实、两端渐隐 -->
    <div
      class="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand-border to-transparent"
      aria-hidden="true"
    ></div>

    <!-- 居中常驻 Segmented 胶囊 -->
    <div class="absolute top-[5px] left-1/2 -translate-x-1/2 pointer-events-auto">
      <Segmented
        :value="modelValue"
        :options="viewOptions"
        size="small"
        class="top-tabbar-segmented"
        aria-label="切换布局视图"
        @change="emit('update:modelValue', $event as WorkspaceViewMode)"
      />
    </div>
  </div>
</template>

<style scoped>
/* 胶囊化：弱背景 + 细边框 + 浮起阴影，使其在两侧内容之上可读 */
.top-tabbar-segmented {
  background: var(--brand-composer);
  border: 1px solid var(--brand-border);
  border-radius: 999px;
  box-shadow: var(--brand-shadow-sm);
  padding: 2px;
}
</style>

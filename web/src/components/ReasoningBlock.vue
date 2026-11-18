<script setup lang="ts">
import { Think } from "@antdv-next/x";
import { computed } from "vue";

const props = defineProps<{ text: string; live: boolean; durationSec?: number }>();

const title = computed(() => {
  if (props.live) return "思考中";
  if (props.durationSec != null && props.durationSec >= 1) return `思考了 ${Math.round(props.durationSec)} 秒`;
  return "思考过程";
});

const expanded = computed(() => props.live);
</script>

<template>
  <Think class="think" :title="title" :loading="live ? undefined : undefined" :expanded="expanded" :blink="live">
    <div class="body selectable">{{ text }}</div>
  </Think>
</template>

<style scoped>
.think {
  margin: 0 0 8px;
  font-size: 13px;
}
.think :deep(.antd-think-status-text) {
  font-size: 12.5px;
  color: var(--text-2);
}
.body {
  font-size: 12.8px;
  line-height: 1.7;
  color: var(--text-2);
  white-space: pre-wrap;
  word-break: break-word;
  padding: 2px 0 4px 2px;
  max-height: 260px;
  overflow-y: auto;
}
</style>

<script setup lang="ts">
import { ChevronDown, ChevronRight } from "@lucide/vue";

interface Props {
  label: string;
  expanded: boolean;
}

interface Emits {
  (e: "toggle"): void;
}

defineProps<Props>();
const emit = defineEmits<Emits>();
</script>

<template>
  <div class="waku-turn-fold">
    <span class="waku-fold-line" aria-hidden="true"></span>
    <button type="button" class="waku-fold-label" @click="emit('toggle')">
      <span>{{ label }}</span>
      <ChevronRight v-if="!expanded" class="waku-fold-chevron" />
      <ChevronDown v-else class="waku-fold-chevron" />
    </button>
    <span class="waku-fold-line" aria-hidden="true"></span>
  </div>
</template>

<style scoped>
.waku-turn-fold {
  width: 100%;
  height: 24px;
  display: flex;
  align-items: center;
  gap: 10px;
}
.waku-fold-line {
  flex: 1;
  height: 1px;
  background: var(--brand-border);
}
.waku-fold-label {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 24px;
  padding: 0 2px;
  flex: none;
  border: none;
  background: transparent;
  cursor: pointer;
  font: inherit;
  font-size: 11.5px;
  line-height: 16px;
  font-weight: 500;
  color: var(--brand-muted-strong);
  white-space: nowrap;
  border-radius: 4px;
}
.waku-fold-label:hover {
  color: var(--brand-muted);
}
.waku-fold-chevron {
  width: 10px;
  height: 10px;
  color: var(--brand-muted-strong);
  flex: none;
}
</style>

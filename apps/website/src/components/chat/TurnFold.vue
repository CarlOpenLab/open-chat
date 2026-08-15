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
  <div class="flex h-6 w-full items-center gap-2.5">
    <span class="h-px flex-1 bg-brand-border" aria-hidden="true"></span>
    <button
      type="button"
      class="inline-flex h-6 flex-none items-center gap-1.25 rounded border-0 bg-transparent px-0.5 py-0 text-[11.5px] leading-4 font-medium whitespace-nowrap text-brand-muted-strong hover:text-brand-muted"
      @click="emit('toggle')"
    >
      <span>{{ label }}</span>
      <ChevronRight v-if="!expanded" class="h-2.5 w-2.5 flex-none text-brand-muted-strong" />
      <ChevronDown v-else class="h-2.5 w-2.5 flex-none text-brand-muted-strong" />
    </button>
    <span class="h-px flex-1 bg-brand-border" aria-hidden="true"></span>
  </div>
</template>

<script setup lang="ts">
import { Lightbulb, Sparkles } from "@lucide/vue";
import { Tooltip } from "antdv-next";
import { computed } from "vue";
interface StarterPrompt {
  id: string;
  label: string;
  description: string;
  prompt: string;
}

interface Props {
  items?: StarterPrompt[];
}
interface Emits {
  (e: "promptClick", info: { data: { key: string; description: string } }): void;
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

// ============ 推荐提示词（空状态标题下方的胶囊建议） ============

const defaultPromptItems: StarterPrompt[] = [];

const promptItems = computed<StarterPrompt[]>(() =>
  props.items?.length ? props.items : defaultPromptItems,
);

const iconFor = (id: string) => {
  if (id === "placeholder-idea") return Lightbulb;
  return Sparkles;
};

const handleClick = (item: StarterPrompt) => {
  emit("promptClick", { data: { key: item.id, description: item.prompt } });
};
</script>

<template>
  <div
    class="starter-prompts mt-[26px] flex w-full flex-wrap items-center justify-center gap-[8px]"
    aria-label="推荐提示词"
  >
    <Tooltip v-for="item in promptItems" :key="item.id" :title="item.description">
      <button
        type="button"
        class="starter-prompt-pill flex h-[32px] items-center gap-[7px] rounded-full border border-solid border-brand-border bg-transparent px-[13px] text-[12.5px] text-brand-muted cursor-pointer transition-colors duration-150 hover:border-brand-border-strong hover:bg-brand-surface-subtle hover:text-brand-foreground active:opacity-80"
        @click="handleClick(item)"
      >
        <component :is="iconFor(item.id)" class="!h-[13px] !w-[13px] flex-none text-brand-accent" />
        <span class="max-w-[240px] truncate">{{ item.label }}</span>
      </button>
    </Tooltip>
  </div>
</template>

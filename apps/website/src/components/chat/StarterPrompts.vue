<script setup lang="ts">
import { GitBranch, Lightbulb, Sparkles } from "@lucide/vue";
import { Tooltip } from "antdv-next";
import { computed } from "vue";
import type { AssistantStarterPrompt } from "../../features/assistant-market/types";

interface Props {
  items?: AssistantStarterPrompt[];
}
interface Emits {
  (e: "promptClick", info: { data: { key: string; description: string } }): void;
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

// ============ 推荐提示词（空状态标题下方的胶囊建议） ============

const defaultPromptItems: AssistantStarterPrompt[] = [
  {
    id: "ticket-branch",
    label: "生成工单分支",
    description: "填写工单 ID（或链接）和需求标题，生成 Git 分支",
    prompt: "请启动工单分支生成流程，先用表单收集工单 ID（或链接）和需求标题。",
  },
  {
    id: "placeholder-idea",
    label: "梳理一个想法",
    description: "快速整理目标、边界和下一步",
    prompt: "帮我把这个想法整理成目标、范围和下一步行动。",
  },
  {
    id: "placeholder-review",
    label: "检查一段内容",
    description: "发现问题并给出简洁建议",
    prompt: "帮我检查一段内容，指出最需要改进的三个地方。",
  },
];

const promptItems = computed<AssistantStarterPrompt[]>(() =>
  props.items?.length ? props.items : defaultPromptItems,
);

const iconFor = (id: string) => {
  if (id === "ticket-branch" || id === "start-ticket-flow") return GitBranch;
  if (id === "placeholder-idea") return Lightbulb;
  return Sparkles;
};

const handleClick = (item: AssistantStarterPrompt) => {
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

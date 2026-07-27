<script setup lang="ts">
import { Prompts, type PromptsItemType } from "@antdv-next/x";
import { GitBranch, Lightbulb, Sparkles } from "@lucide/vue";
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

// ============ 推荐提示词（深度思考位置） ============

const defaultPromptItems: AssistantStarterPrompt[] = [
  {
    id: "ticket-branch",
    label: "生成工单分支",
    description: "填写工单 ID 和项目名称，生成 Git 分支",
    prompt: "请启动工单分支生成流程，先用表单收集工单 ID 和项目名称。",
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
const starterPromptItems = computed<PromptsItemType[]>(() =>
  promptItems.value.map(({ id, label, description }) => ({ key: id, label, description })),
);

const handlePromptItemClick = (info: { data: { key: string | number } }) => {
  const key = String(info.data.key);
  const prompt = promptItems.value.find((item) => item.id === key)?.prompt;
  if (prompt) emit("promptClick", { data: { key, description: prompt } });
};
</script>

<template>
  <div class="starter-prompts w-full max-w-[780px] mt-0 mx-auto mb-[7px]">
    <Prompts
      :items="starterPromptItems"
      class="starter-prompts-inner"
      @item-click="handlePromptItemClick"
    >
      <template #iconRender="{ item }">
        <GitBranch
          v-if="item.key === 'ticket-branch' || item.key === 'start-ticket-flow'"
          class="w-3.5 h-3.5"
        />
        <Lightbulb v-else-if="item.key === 'placeholder-idea'" class="w-3.5 h-3.5" />
        <Sparkles v-else class="w-3.5 h-3.5" />
      </template>
    </Prompts>
  </div>
</template>

<style scoped>
/* 以下均为 :deep() 覆盖 antd-x Prompts 内部类，保留在 scoped CSS 中 */
.starter-prompts :deep(.antd-prompts) {
  width: 100%;
}
.starter-prompts :deep(.antd-prompts-list) {
  gap: 8px;
}
.starter-prompts :deep(.antd-prompts-item) {
  flex: 1 1 0;
  min-width: 0;
  min-height: 60px;
  padding: 10px 12px;
  border: 1px solid var(--brand-border);
  border-radius: 7px;
  background: var(--brand-surface);
  transition:
    background 160ms ease,
    border-color 160ms ease;
}
.starter-prompts :deep(.antd-prompts-item:hover) {
  background: var(--brand-surface-muted);
  border-color: var(--brand-border-strong);
}
.starter-prompts :deep(.antd-prompts-item:active) {
  background: var(--brand-surface-subtle);
}
.starter-prompts :deep(.antd-prompts-icon) {
  display: grid;
  flex: 0 0 auto;
  width: 28px;
  height: 28px;
  place-items: center;
  border: 1px solid var(--brand-border);
  border-radius: 5px;
  background: var(--brand-surface-subtle);
}
.starter-prompts :deep(.antd-prompts-content) {
  gap: 2px;
}
.starter-prompts :deep(.antd-prompts-label) {
  font-size: 11px;
  font-weight: 600;
  color: var(--brand-foreground);
}
.starter-prompts :deep(.antd-prompts-desc) {
  overflow: hidden;
  max-width: 100%;
  color: var(--brand-muted);
  font-size: 9px;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}
@media (max-width: 560px) {
  .starter-prompts :deep(.antd-prompts-item) {
    flex: 0 0 auto;
    width: 196px;
  }
  .starter-prompts :deep(.antd-prompts-desc) {
    white-space: normal;
  }
}
</style>

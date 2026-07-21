<script setup lang="ts">
import type { BubbleItemType, BubbleListProps } from "@antdv-next/x";
import { BubbleList } from "@antdv-next/x";
import { ArrowUpRight, ClipboardList, Code2, Mail, ScanText, Sparkles } from "@lucide/vue";

interface Props {
  showWelcome: boolean;
  bubbleItems: BubbleItemType[];
  roleConfig: BubbleListProps["role"];
}

interface Emits {
  (e: "promptClick", info: { data: { description: string } }): void;
}

defineProps<Props>();
const emit = defineEmits<Emits>();

const prompts = [
  {
    title: "整理工作计划",
    description: "把目标拆成清晰的执行步骤",
    prompt: "帮我为下周的产品评审整理一份议程，包含目标、风险和待决策事项。",
    icon: ClipboardList,
  },
  {
    title: "分析一份内容",
    description: "提炼重点、模式和下一步",
    prompt: "分析这份用户反馈，找出重复出现的问题，并按影响范围排序。",
    icon: ScanText,
  },
  {
    title: "一起写代码",
    description: "设计、解释或重构实现",
    prompt: "帮我设计一个 Vue 登录表单的状态结构，需要覆盖校验、加载和错误重试。",
    icon: Code2,
  },
  {
    title: "起草一份文本",
    description: "快速得到结构清晰的初稿",
    prompt: "帮我写一封项目延期说明邮件，语气坦诚、专业，并给出新的时间节点。",
    icon: Mail,
  },
];
</script>

<template>
  <main id="chat-content" class="messages-wrapper" tabindex="-1">
    <section v-if="showWelcome" class="empty-state" aria-labelledby="welcome-title">
      <span class="empty-mark" aria-hidden="true"><Sparkles /></span>
      <p>OPEN CHAT AI</p>
      <h2 id="welcome-title">今天想一起完成什么？</h2>
      <span class="empty-description">从一个问题开始，或者把正在处理的内容交给 Open Chat。</span>
      <div class="starter-prompts" aria-label="推荐提示词">
        <button
          v-for="prompt in prompts"
          :key="prompt.title"
          type="button"
          @click="emit('promptClick', { data: { description: prompt.prompt } })"
        >
          <span class="prompt-icon"><component :is="prompt.icon" /></span>
          <span
            ><strong>{{ prompt.title }}</strong
            ><small>{{ prompt.description }}</small></span
          >
          <ArrowUpRight />
        </button>
      </div>
    </section>

    <BubbleList
      v-else
      :style="{ height: '100%' }"
      :role="roleConfig"
      :items="bubbleItems"
      :auto-scroll="true"
      class="bubble-list"
    />
  </main>
</template>

<style scoped>
.messages-wrapper {
  min-height: 0;
  flex: 1;
  overflow: hidden;
  padding: 38px max(28px, calc((100% - 780px) / 2)) 24px;
  background: var(--brand-workspace);
}
.empty-state {
  width: min(100%, 700px);
  margin: auto;
  padding: 54px 0 24px;
  text-align: center;
  animation: empty-in 360ms ease-out both;
}
.empty-mark {
  display: grid;
  width: 42px;
  height: 42px;
  place-items: center;
  margin: 0 auto 20px;
  border-radius: 7px;
  background: var(--brand-primary);
  color: var(--brand-primary-foreground);
  box-shadow: var(--brand-shadow-sm);
}
.empty-mark :deep(svg) {
  width: 19px;
  height: 19px;
}
.empty-state > p {
  margin: 0 0 8px;
  color: var(--brand-muted);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 10px;
  font-weight: 600;
}
.empty-state h2 {
  margin: 0;
  color: var(--brand-foreground);
  font-size: 28px;
  line-height: 1.2;
  font-weight: 680;
}
.empty-description {
  display: block;
  margin: 10px 0 30px;
  color: var(--brand-muted);
  font-size: 13px;
}
.starter-prompts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  border-top: 1px solid var(--brand-border);
  border-left: 1px solid var(--brand-border);
  text-align: left;
}
.starter-prompts button {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr) 16px;
  align-items: center;
  gap: 10px;
  min-height: 82px;
  padding: 12px 14px;
  border: 0;
  border-right: 1px solid var(--brand-border);
  border-bottom: 1px solid var(--brand-border);
  background: var(--brand-workspace);
  color: var(--brand-foreground);
  text-align: left;
  cursor: pointer;
  transition: background 160ms ease;
}
.starter-prompts button:hover {
  background: var(--brand-surface-muted);
}
.starter-prompts button > :deep(svg) {
  width: 14px;
  height: 14px;
  color: var(--brand-muted);
  transition: transform 160ms ease;
}
.starter-prompts button:hover > :deep(svg) {
  transform: translate(2px, -2px);
}
.prompt-icon {
  display: grid;
  width: 30px;
  height: 30px;
  place-items: center;
  border: 1px solid var(--brand-border);
  border-radius: 5px;
  background: var(--brand-surface);
}
.prompt-icon :deep(svg) {
  width: 14px;
  height: 14px;
}
.starter-prompts button > span:nth-child(2) {
  display: flex;
  min-width: 0;
  flex-direction: column;
}
.starter-prompts strong {
  font-size: 11px;
}
.starter-prompts small {
  margin-top: 2px;
  overflow: hidden;
  color: var(--brand-muted);
  font-size: 9px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.messages-wrapper :deep(.antd-bubble-list) {
  width: min(100%, 780px);
  margin: 0 auto;
}
.messages-wrapper :deep(.antd-bubble-list-scroll-content) {
  padding-inline: 0;
}
.messages-wrapper :deep(.antd-bubble) {
  padding-block: 15px;
}
.messages-wrapper :deep(.antd-bubble-start) {
  padding-inline-end: 0 !important;
}
.messages-wrapper :deep(.antd-bubble-end) {
  padding-inline-start: 0 !important;
}
.messages-wrapper :deep(.antd-bubble-avatar) {
  min-width: 30px;
}
.messages-wrapper :deep(.antd-bubble-start .antd-bubble-body) {
  width: min(100%, 737px);
}
.messages-wrapper :deep(.antd-bubble-end .antd-bubble-body) {
  max-width: min(76%, 620px);
}
.messages-wrapper :deep(.antd-bubble-content) {
  font-size: 13px;
  line-height: 1.7;
}
.messages-wrapper :deep(.antd-bubble-start .antd-bubble-content) {
  background: transparent;
  color: var(--brand-foreground);
}
.messages-wrapper :deep(.antd-bubble-end .antd-bubble-content) {
  padding: 11px 14px;
  border-radius: 7px 7px 2px;
  background: var(--brand-surface-subtle);
  color: var(--brand-foreground);
}
.messages-wrapper :deep(.antd-bubble-footer) {
  margin-top: 8px;
}
.messages-wrapper :deep(.antd-bubble-footer .ant-btn) {
  width: 30px;
  min-width: 30px;
  height: 30px;
  padding: 0;
  border-radius: 4px;
  color: var(--brand-muted);
}
.messages-wrapper :deep(.x-markdown-light) {
  color: var(--brand-foreground);
  font-size: 13px;
  line-height: 1.82;
}
.messages-wrapper :deep(.x-markdown-light p) {
  margin: 0 0 13px;
}
.messages-wrapper :deep(.x-markdown-light p:last-child) {
  margin-bottom: 0;
}
.messages-wrapper :deep(.x-markdown-light pre) {
  margin: 16px 0;
}
@keyframes empty-in {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
@media (max-width: 820px) {
  .messages-wrapper {
    padding: 28px 24px 24px;
  }
  .messages-wrapper :deep(.antd-bubble) {
    padding-block: 12px;
  }
  .messages-wrapper :deep(.antd-bubble-end .antd-bubble-body) {
    max-width: 88%;
  }
}
@media (max-width: 560px) {
  .messages-wrapper {
    padding: 22px 15px 20px;
  }
  .empty-state {
    padding-top: 36px;
  }
  .empty-state h2 {
    font-size: 24px;
  }
  .empty-description {
    max-width: 300px;
    margin-inline: auto;
  }
  .starter-prompts {
    grid-template-columns: 1fr;
  }
  .starter-prompts button {
    min-height: 68px;
  }
  .starter-prompts button:nth-child(n + 4) {
    display: none;
  }
}
@media (max-width: 390px) {
  .starter-prompts button:nth-child(3) {
    display: none;
  }
}
</style>

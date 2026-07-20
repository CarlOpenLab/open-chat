<script setup lang="ts">
import type { BubbleItemType, BubbleListProps } from "@antdv-next/x";
import { BubbleList, Prompts } from "@antdv-next/x";

interface Props {
  showWelcome: boolean;
  bubbleItems: BubbleItemType[];
  roleConfig: BubbleListProps["role"];
}

interface Emits {
  (e: "promptClick", info: { data: { description?: string } }): void;
}

defineProps<Props>();
const emit = defineEmits<Emits>();

const handlePromptClick = (info: any) => {
  emit("promptClick", info);
};
</script>

<template>
  <main id="chat-content" class="messages-wrapper" tabindex="-1">
    <template v-if="showWelcome">
      <section class="welcome-container" aria-labelledby="welcome-title">
        <div class="welcome-copy">
          <h2 id="welcome-title">今天想完成什么？</h2>
        </div>
        <div class="prompts-wrapper" aria-label="快捷开始">
          <Prompts
            :items="[
              { key: '1', description: '帮我规划一个项目' },
              { key: '2', description: '解释一个复杂概念' },
              { key: '3', description: '审阅并改进一段代码' },
              { key: '4', description: '起草一份产品文案' },
            ]"
            @item-click="handlePromptClick"
          />
        </div>
      </section>
    </template>
    <template v-else>
      <BubbleList
        :style="{ height: '100%' }"
        :role="roleConfig"
        :items="bubbleItems"
        :auto-scroll="true"
        class="bubble-list"
      />
    </template>
  </main>
</template>

<style scoped>
.messages-wrapper {
  min-height: 0;
  flex: 1;
  overflow: hidden;
  padding: 24px var(--chat-gutter) 16px;
  background: var(--brand-workspace);
}

.welcome-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: min(100%, var(--chat-content-width));
  height: 100%;
  margin: 0 auto;
  padding-bottom: 10vh;
  text-align: center;
}

.welcome-copy {
  max-width: 560px;
  margin-bottom: 36px;
}

.welcome-copy h2 {
  margin: 0;
  color: var(--brand-foreground);
  font-size: 38px;
  font-weight: 650;
  line-height: 1.12;
  letter-spacing: 0;
  text-wrap: balance;
}

.prompts-wrapper {
  width: min(100%, 720px);
}

.prompts-wrapper :deep(.antd-prompts-list) {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.prompts-wrapper :deep(.antd-prompts-item) {
  min-height: 58px;
  margin: 0;
  border: 1px solid var(--brand-border);
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.72);
  box-shadow: none;
  transition:
    background 150ms ease,
    border-color 150ms ease,
    color 150ms ease;
}

.prompts-wrapper :deep(.antd-prompts-item:hover) {
  border-color: var(--brand-border-strong);
  background: var(--brand-surface);
}

.prompts-wrapper :deep(.antd-prompts-item:active) {
  background: var(--brand-surface-subtle);
  transform: scale(0.99);
}

.prompts-wrapper :deep(.antd-prompts-item-description) {
  color: var(--brand-foreground);
  font-size: 13px;
  font-weight: 500;
}

.messages-wrapper :deep(.antd-bubble-list) {
  width: min(100%, var(--chat-content-width));
  margin: 0 auto;
}

.messages-wrapper :deep(.antd-bubble) {
  max-width: min(100%, 760px);
}

.messages-wrapper :deep(.antd-bubble-content) {
  border-radius: 8px;
}

.messages-wrapper :deep(.antd-bubble[data-role="assistant"] .antd-bubble-content),
.messages-wrapper :deep(.antd-bubble-assistant .antd-bubble-content) {
  background: transparent;
  color: var(--brand-foreground);
}

.messages-wrapper :deep(.antd-bubble[data-role="user"] .antd-bubble-content),
.messages-wrapper :deep(.antd-bubble-user .antd-bubble-content) {
  background: var(--brand-primary);
  color: var(--brand-primary-foreground);
}

.messages-wrapper :deep(.x-markdown-light) {
  font-size: 14px;
  line-height: 1.7;
}

.messages-wrapper :deep(.x-markdown-light p) {
  margin: 8px 0;
}

.messages-wrapper :deep(.x-markdown-light pre) {
  margin: 16px 0;
  padding: 0;
  border-radius: 0;
  background: transparent;
}

.messages-wrapper :deep(.x-markdown-light pre code) {
  display: block;
  padding: 0;
  overflow: visible;
  border-radius: 0;
  background: transparent;
  color: inherit;
  font-family: inherit;
  font-size: inherit;
  line-height: inherit;
}

@media (max-width: 767px) {
  .messages-wrapper {
    padding: 20px 16px 10px;
  }

  .welcome-container {
    padding-bottom: 6vh;
  }

  .welcome-copy {
    margin-bottom: 28px;
  }

  .welcome-copy h2 {
    font-size: 28px;
  }

  .prompts-wrapper :deep(.antd-prompts-list) {
    grid-template-columns: 1fr;
  }

  .prompts-wrapper :deep(.antd-prompts-item) {
    min-height: 54px;
  }
}
</style>

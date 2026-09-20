<script setup lang="ts">
import type { BubbleItemType, ItemType } from "@antdv-next/x";
import { Actions } from "@antdv-next/x";
import { Copy, RotateCcw } from "@lucide/vue";
import { computed, h } from "vue";
import type { WebSearchSourceItem } from "../../services/ai";
import AssistantMessageContent from "./AssistantMessageContent.vue";

interface Props {
  /** 正文气泡项（携带 extraInfo：chatError/chatNotices 等）。 */
  item: BubbleItemType;
  /** 气泡正文（等于 item.content）。 */
  content: string;
  /** markdown 根类名（由外层按主题生成）。 */
  markdownClassName: string;
  /** 是否仍在流式接收（loading/updating）。 */
  streaming: boolean;
  /** 该消息的联网检索来源。 */
  searchResults?: WebSearchSourceItem[];
  /** 是否展示复制 / 重新生成操作栏（仅最后一条已完成的正文）。 */
  showActions?: boolean;
  /** 独立预览用主题；缺省时由 AssistantMessageContent 继承注入主题。 */
  theme?: "light" | "dark";
}

interface Emits {
  (e: "reload", messageId: string | number): void;
}

const props = withDefaults(defineProps<Props>(), {
  searchResults: () => [],
  showActions: false,
  theme: undefined,
});
const emit = defineEmits<Emits>();

/** 气泡下方操作栏：复制 + 重新生成（x Actions 原生样式）。 */
const messageActions = computed<ItemType[]>(() => {
  const content =
    typeof props.item.content === "string"
      ? props.item.content.replace(/<\/?think(?:\s+[^>]*)?\s*>/gi, "")
      : "";
  return [
    {
      key: "copy",
      label: "复制",
      icon: h(Copy, { class: "h-3.5 w-3.5" }),
      onItemClick: () => {
        if (!content) return;
        navigator.clipboard?.writeText(content).catch(() => {});
      },
    },
    {
      key: "reload",
      label: "重新生成",
      icon: h(RotateCcw, { class: "h-3.5 w-3.5" }),
      onItemClick: () => emit("reload", props.item.key),
    },
  ];
});
</script>

<template>
  <div class="flex w-full justify-start">
    <div class="assistant-bubble w-full min-w-0 max-w-full">
      <AssistantMessageContent
        :item="item"
        :content="content"
        :markdown-class-name="markdownClassName"
        :streaming="streaming"
        :search-results="searchResults"
        :theme="theme"
      />
      <div v-if="showActions" class="message-actions">
        <Actions :items="messageActions" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.assistant-bubble {
  animation: message-in 260ms cubic-bezier(0.2, 0, 0, 1) both;
}
.assistant-bubble :deep(.assistant-message) {
  width: 100%;
  max-width: 100%;
  min-width: 0;
}

.message-actions {
  display: flex;
  margin-top: 4px;
}
.message-actions :deep(.antd-actions) {
  justify-content: flex-end;
}

@keyframes message-in {
  from {
    opacity: 0;
    transform: translateY(7px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>

<script setup lang="ts">
import type { BubbleItemType, BubbleListProps, ItemType } from "@antdv-next/x";
import { Actions, BubbleList } from "@antdv-next/x";
import type { XCardCommand } from "@antdv-next/x-card";
import { Copy, RotateCcw } from "@lucide/vue";
import { computed, h, provide, ref, watch } from "vue";
import {
  getA2UISurfaceId,
  parseA2UIContent,
  type A2UIActionPayload,
  type A2UISubmission,
} from "../../utils/a2ui";
import type { WebSearchSourceItem } from "../../services/ai";
import { parseFileWorkspaceContent } from "../../utils/fileWorkspace";
import AssistantMessageContent from "./AssistantMessageContent.vue";
import EmptyState from "./EmptyState.vue";
import StarterPrompts from "./StarterPrompts.vue";
import { markdownThemeKey, type MarkdownTheme } from "./markdownTheme";
import type { AssistantStarterPrompt } from "../../features/assistant-market/types";

interface Props {
  showWelcome: boolean;
  bubbleItems: BubbleItemType[];
  dark: boolean;
  conversationKey: string;
  /** 空状态标题下方的推荐提示词 */
  starterPrompts?: AssistantStarterPrompt[];
  a2uiPendingSurfaceId?: string;
  a2uiSubmissions?: A2UISubmission[];
  searchResultsByMessageId?: Record<string, WebSearchSourceItem[]>;
}

interface Emits {
  (e: "a2uiAction", payload: A2UIActionPayload): void;
  (e: "reload", messageId: string | number): void;
  (e: "promptClick", info: { data: { key: string; description: string } }): void;
}

interface ParsedA2UIRenderContent {
  commands: XCardCommand[];
  errors: string[];
  hasPendingBlock: boolean;
}

interface ParsedThinkContent {
  thinkContent: string;
  answerContent: string;
  thinkDone: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  a2uiPendingSurfaceId: "",
  a2uiSubmissions: () => [],
  searchResultsByMessageId: () => ({}),
});
const emit = defineEmits<Emits>();
const markdownTheme = computed<MarkdownTheme>(() => (props.dark ? "dark" : "light"));
const markdownClassName = computed(() => `chat-markdown x-markdown-${markdownTheme.value}`);
provide(markdownThemeKey, markdownTheme);
const thinkExpandedMap = ref<Record<string, boolean>>({});
const thinkDoneMap = ref<Record<string, boolean>>({});

/** useXChat 中 "loading"（占位等待）和 "updating"（流式接收中）都表示消息仍在进行中 */
const isStreamingStatus = (status: unknown): boolean =>
  status === "loading" || status === "updating";

const roleConfig: BubbleListProps["role"] = {
  assistant: { placement: "start" },
  user: { placement: "end" },
};

const parseThinkContent = (value: string): ParsedThinkContent | null => {
  const openMatch = value.match(/<think(?:\s+status=["']?([^"'>\s]+)["']?)?>/i);
  if (!openMatch || openMatch.index === undefined) return null;

  const status = (openMatch[1] || "").toLowerCase();
  const thinkStart = openMatch.index + openMatch[0].length;
  const closeTag = "</think>";
  const closeIndex = value.indexOf(closeTag, thinkStart);
  const prefix = value.slice(0, openMatch.index).trim();
  const thinkRaw =
    closeIndex === -1 ? value.slice(thinkStart) : value.slice(thinkStart, closeIndex);
  const suffix = closeIndex === -1 ? "" : value.slice(closeIndex + closeTag.length).trim();

  return {
    thinkContent: thinkRaw.replace(/^\n+/, "").trim(),
    answerContent: [prefix, suffix].filter(Boolean).join("\n\n").trim(),
    thinkDone: closeIndex !== -1 || status === "done",
  };
};

const displayItems = computed<BubbleItemType[]>(() => {
  const preparedItems = props.bubbleItems.map((item) => {
    const parsedWorkspace =
      item.role === "assistant" && typeof item.content === "string"
        ? parseFileWorkspaceContent(item.content)
        : null;
    const workspaceMarkdown = parsedWorkspace?.markdown ?? item.content;
    const parsedA2UI =
      item.role === "assistant" && typeof workspaceMarkdown === "string"
        ? parseA2UIContent(workspaceMarkdown)
        : null;
    const displayContent = parsedA2UI?.markdown ?? workspaceMarkdown;

    return {
      ...item,
      content: displayContent,
      extraInfo: {
        ...item.extraInfo,
        parsedWorkspace,
        parsedA2UI,
        parsedThink:
          item.role === "assistant" && typeof displayContent === "string"
            ? parseThinkContent(displayContent)
            : null,
      },
    };
  });

  const surfaceOwner = new Map<string, string>();
  const commandsByOwner = new Map<string, XCardCommand[]>();

  preparedItems.forEach((item) => {
    const parsed = item.extraInfo?.parsedA2UI;
    if (!parsed || isStreamingStatus(item.status)) return;

    parsed.commands.forEach((command) => {
      const surfaceId = getA2UISurfaceId(command);
      const itemKey = String(item.key);

      if ("createSurface" in command) {
        if (surfaceOwner.has(surfaceId)) {
          parsed.errors.push(`A2UI Surface ${surfaceId} 被重复创建`);
          return;
        }
        surfaceOwner.set(surfaceId, itemKey);
      }

      const ownerKey = surfaceOwner.get(surfaceId);
      if (!ownerKey) {
        parsed.errors.push(`A2UI Surface ${surfaceId} 尚未创建`);
        return;
      }

      commandsByOwner.set(ownerKey, [...(commandsByOwner.get(ownerKey) ?? []), command]);
      if ("deleteSurface" in command) surfaceOwner.delete(surfaceId);
    });
  });

  return preparedItems.flatMap((item) => {
    const parsed = item.extraInfo?.parsedA2UI;
    if (!parsed) return [item];

    const isFinal = !isStreamingStatus(item.status);
    const errors = isFinal ? [...parsed.errors] : [];
    if (isFinal && parsed.hasPendingBlock) {
      errors.push("A2UI 响应未完整闭合");
    }

    const parsedA2UI: ParsedA2UIRenderContent = {
      commands: isFinal ? (commandsByOwner.get(String(item.key)) ?? []) : [],
      errors,
      hasPendingBlock: !isFinal && (parsed.hasPendingBlock || parsed.commands.length > 0),
    };
    const hasVisibleText = typeof item.content !== "string" || item.content.trim().length > 0;
    const hasVisibleA2UI =
      parsedA2UI.commands.length > 0 || parsedA2UI.errors.length > 0 || parsedA2UI.hasPendingBlock;
    const hasVisibleWorkspace = Boolean(item.extraInfo?.parsedWorkspace?.hasWorkspaceBlock);
    const hasVisibleToolCalls =
      Array.isArray(item.extraInfo?.toolCalls) && item.extraInfo.toolCalls.length > 0;
    const hasVisibleChatMeta =
      Boolean(item.extraInfo?.chatError) ||
      (Array.isArray(item.extraInfo?.chatNotices) && item.extraInfo.chatNotices.length > 0);

    if (
      item.role === "assistant" &&
      !hasVisibleText &&
      !hasVisibleA2UI &&
      !hasVisibleWorkspace &&
      !hasVisibleToolCalls &&
      !hasVisibleChatMeta
    )
      return [];

    return [
      {
        ...item,
        extraInfo: {
          ...item.extraInfo,
          parsedA2UI,
        },
      },
    ];
  });
});

const isA2UIActionPending = (commands: XCardCommand[]) =>
  Boolean(props.a2uiPendingSurfaceId) &&
  commands.some((command) => getA2UISurfaceId(command) === props.a2uiPendingSurfaceId);

const lastAssistantMessageKey = computed(
  () => [...displayItems.value].reverse().find((item) => item.role === "assistant")?.key,
);

const submissionsForMessage = (messageId: string | number) =>
  props.a2uiSubmissions.filter((submission) => submission.ownerMessageId === String(messageId));

const getThinkKey = (messageId: string | number) =>
  `${props.conversationKey || "__draft__"}::${String(messageId)}`;

const isThinkExpanded = (messageId: string | number, thinkDone: boolean) =>
  thinkExpandedMap.value[getThinkKey(messageId)] ?? !thinkDone;

const setThinkExpanded = (messageId: string | number, expanded: boolean) => {
  thinkExpandedMap.value = {
    ...thinkExpandedMap.value,
    [getThinkKey(messageId)]: expanded,
  };
};

/** 气泡下方操作栏：复制 + 重新生成（x Actions 原生样式）。 */
const buildMessageActions = (item: BubbleItemType): ItemType[] => {
  const content = typeof item.content === "string" ? item.content : "";
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
      onItemClick: () => emit("reload", item.key),
    },
  ];
};

watch(
  displayItems,
  (items) => {
    const nextExpandedMap = { ...thinkExpandedMap.value };
    const nextDoneMap = { ...thinkDoneMap.value };

    items.forEach((item) => {
      const parsed = item.extraInfo?.parsedThink as ParsedThinkContent | null;
      if (!parsed) return;

      const key = getThinkKey(item.key);
      const previousDone = thinkDoneMap.value[key];
      const previousExpanded = thinkExpandedMap.value[key];
      nextDoneMap[key] = parsed.thinkDone;

      if (previousExpanded === undefined) {
        nextExpandedMap[key] = !parsed.thinkDone;
      } else if (previousDone === false && parsed.thinkDone) {
        nextExpandedMap[key] = false;
      }
    });

    thinkExpandedMap.value = nextExpandedMap;
    thinkDoneMap.value = nextDoneMap;
  },
  { immediate: true },
);
</script>

<template>
  <main
    id="chat-content"
    class="messages-wrapper h-full min-h-0 flex-1 overflow-hidden bg-brand-workspace py-6 px-4 lt-md:py-6 lt-md:px-4 lt-sm:py-5 lt-sm:px-3"
    :class="showWelcome ? 'flex flex-col justify-center' : ''"
    tabindex="-1"
  >
    <section v-if="showWelcome" class="empty-state m-auto w-[min(100%,760px)] p-0 text-center">
      <EmptyState>
        <StarterPrompts :items="starterPrompts" @prompt-click="emit('promptClick', $event)" />
      </EmptyState>
    </section>

    <!-- 转录无头像列，消息贴左/右缘渲染 -->
    <BubbleList v-else class="h-full" :role="roleConfig" :items="displayItems" :auto-scroll="true">
      <template #contentRender="{ content, item }">
        <AssistantMessageContent
          v-if="item.role === 'assistant'"
          :item="item"
          :content="String(content)"
          :markdown-class-name="markdownClassName"
          :streaming="isStreamingStatus(item.status)"
          :think-expanded="
            item.extraInfo?.parsedThink
              ? isThinkExpanded(item.key, item.extraInfo.parsedThink.thinkDone)
              : false
          "
          :a2ui-action-pending="
            item.extraInfo?.parsedA2UI
              ? isA2UIActionPending(item.extraInfo.parsedA2UI.commands)
              : false
          "
          :submissions="submissionsForMessage(item.key)"
          :search-results="searchResultsByMessageId?.[String(item.key)] ?? []"
          @a2ui-action="emit('a2uiAction', $event)"
          @update:think-expanded="setThinkExpanded(item.key, $event)"
        />
        <span v-else class="whitespace-pre-wrap break-words">{{ content }}</span>
      </template>

      <template #footer="{ item }">
        <Actions
          v-if="
            item.role === 'assistant' &&
            item.status === 'success' &&
            item.key === lastAssistantMessageKey
          "
          class="message-actions"
          :items="buildMessageActions(item)"
        />
      </template>
    </BubbleList>
  </main>
</template>

<style scoped>
/* 保留：@keyframes 及引用它的 animation 声明（scoped 会重写 keyframes 名，二者需同处） */
.empty-state {
  animation: empty-in 360ms ease-out both;
}

/*
 * 消息列表：气泡保持 @antdv-next/x 原生样式（filled 浅灰 + 圆角），
 * 内容列限宽居中（主流 AI 聊天 760px 量级），气泡在列内按组件默认
 * start/end 各留 15% 侧边距。
 */
.messages-wrapper :deep(.antd-bubble-list) {
  width: 100%;
  max-width: 760px;
  min-width: 0;
  margin: 0 auto;
}
.messages-wrapper :deep(.antd-bubble-list-scroll-box) {
  overflow-x: hidden;
  overscroll-behavior-x: none;
}
.messages-wrapper :deep(.antd-bubble-list-scroll-content) {
  padding-inline: 0;
}
/* 气泡下方操作栏：与气泡左缘对齐，hover 才有底色（组件库原生交互） */
.message-actions {
  margin-top: 2px;
}
.message-actions :deep(.antd-actions-item) {
  color: var(--brand-muted);
}
.messages-wrapper :deep(.chat-markdown) {
  min-width: 0;
  max-width: 100%;
  color: var(--brand-foreground);
  overflow-wrap: anywhere;
}
.messages-wrapper :deep(.chat-markdown pre),
.messages-wrapper :deep(.chat-markdown table),
.messages-wrapper :deep(.antd-code-highlighter) {
  min-width: 0;
  max-width: 100%;
  overflow-x: auto;
  overscroll-behavior-x: contain;
}
.messages-wrapper :deep(.chat-markdown p) {
  margin: 0 0 13px;
}
.messages-wrapper :deep(.chat-markdown p:last-child) {
  margin-bottom: 0;
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
</style>

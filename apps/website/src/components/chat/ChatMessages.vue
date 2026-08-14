<script setup lang="ts">
import type { BubbleItemType, BubbleListProps, ItemType } from "@antdv-next/x";
import { Actions, BubbleList } from "@antdv-next/x";
import type { XCardCommand } from "@antdv-next/x-card";
import { ArrowDown, Copy, RotateCcw } from "@lucide/vue";
import { computed, h, nextTick, onBeforeUnmount, onMounted, provide, ref, watch } from "vue";
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

interface Props {
  showWelcome: boolean;
  bubbleItems: BubbleItemType[];
  dark: boolean;
  conversationKey: string;
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
const messagesRoot = ref<HTMLElement | null>(null);
const showScrollToBottom = ref(false);
let scrollBox: HTMLElement | null = null;

const updateScrollState = () => {
  if (!scrollBox) {
    showScrollToBottom.value = false;
    return;
  }
  const distance = scrollBox.scrollHeight - scrollBox.clientHeight - scrollBox.scrollTop;
  showScrollToBottom.value = distance > 120;
};

const bindScrollBox = async () => {
  await nextTick();
  if (scrollBox) scrollBox.removeEventListener("scroll", updateScrollState);
  scrollBox =
    messagesRoot.value?.querySelector<HTMLElement>(".antd-bubble-list-scroll-box") ?? null;
  scrollBox?.addEventListener("scroll", updateScrollState, { passive: true });
  updateScrollState();
};

const scrollToBottom = () => {
  if (!scrollBox) return;
  scrollBox.scrollTo({ top: scrollBox.scrollHeight, behavior: "smooth" });
  showScrollToBottom.value = false;
};
const markdownTheme = computed<MarkdownTheme>(() => (props.dark ? "dark" : "light"));
const markdownClassName = computed(() => `chat-markdown x-markdown-${markdownTheme.value}`);
provide(markdownThemeKey, markdownTheme);
const thinkExpandedMap = ref<Record<string, boolean>>({});
const thinkDoneMap = ref<Record<string, boolean>>({});

/** useXChat 中 "loading"（占位等待）和 "updating"（流式接收中）都表示消息仍在进行中 */
const isStreamingStatus = (status: unknown): boolean =>
  status === "loading" || status === "updating";

const roleConfig: BubbleListProps["role"] = {
  // Assistant content is already structured (markdown, thinking, tools). Removing
  // the extra filled container gives those blocks room to breathe and keeps the
  // user's message visually distinct.
  assistant: {
    placement: "start",
    variant: "borderless",
    class: "assistant-bubble",
  },
  user: {
    placement: "end",
    variant: "filled",
    shape: "round",
    class: "user-bubble",
  },
};

const parseThinkContent = (value: string): ParsedThinkContent | null => {
  const openMatch = value.match(/<think(?:\s+status\s*=\s*["']?([^"'>\s]+)["']?)?\s*>/i);
  if (!openMatch || openMatch.index === undefined) {
    const partialOpenMatch = value.match(/<think\b[^>]*$/i);
    if (partialOpenMatch?.index !== undefined) {
      return {
        thinkContent: "",
        answerContent: value.slice(0, partialOpenMatch.index).trim(),
        thinkDone: false,
      };
    }
    const withoutThinkTags = value.replace(/<\/?think(?:\s+[^>]*)?\s*>/gi, "").trim();
    return withoutThinkTags === value.trim()
      ? null
      : { thinkContent: "", answerContent: withoutThinkTags, thinkDone: true };
  }

  const status = (openMatch[1] || "").toLowerCase();
  const thinkStart = openMatch.index + openMatch[0].length;
  const closeMatch = value.slice(thinkStart).match(/<\/think\s*>/i);
  const closeIndex = closeMatch ? thinkStart + (closeMatch.index ?? 0) : -1;
  const closeLength = closeMatch?.[0].length ?? 0;
  const prefix = value.slice(0, openMatch.index).trim();
  const thinkRaw =
    closeIndex === -1 ? value.slice(thinkStart) : value.slice(thinkStart, closeIndex);
  const suffix = closeIndex === -1 ? "" : value.slice(closeIndex + closeLength).trim();

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
            ? typeof item.extraInfo?.reasoningContent === "string" &&
              item.extraInfo.reasoningContent.trim()
              ? {
                  thinkContent: item.extraInfo.reasoningContent,
                  answerContent: displayContent,
                  thinkDone: !isStreamingStatus(item.status),
                }
              : parseThinkContent(displayContent)
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
    const hasVisibleReasoning =
      typeof item.extraInfo?.reasoningContent === "string" &&
      item.extraInfo.reasoningContent.trim().length > 0;
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
      !hasVisibleReasoning &&
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

const hasReasoning = (item: BubbleItemType) => {
  const reasoning = item.extraInfo?.reasoningContent;
  if (typeof reasoning === "string" && reasoning.trim().length > 0) return true;
  const legacy = item.extraInfo?.parsedThink as ParsedThinkContent | null | undefined;
  return Boolean(legacy?.thinkContent?.trim());
};

/** 气泡下方操作栏：复制 + 重新生成（x Actions 原生样式）。 */
const buildMessageActions = (item: BubbleItemType): ItemType[] => {
  const parsedThink = item.extraInfo?.parsedThink as ParsedThinkContent | null | undefined;
  const content = parsedThink
    ? parsedThink.answerContent
    : typeof item.content === "string"
      ? item.content.replace(/<\/?think(?:\s+[^>]*)?\s*>/gi, "")
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
      if (!hasReasoning(item)) return;

      const key = getThinkKey(item.key);
      const previousDone = thinkDoneMap.value[key];
      const previousExpanded = thinkExpandedMap.value[key];
      const done = !isStreamingStatus(item.status);
      nextDoneMap[key] = done;

      if (previousExpanded === undefined) {
        nextExpandedMap[key] = !done;
      } else if (previousDone === false && done) {
        nextExpandedMap[key] = false;
      }
    });

    thinkExpandedMap.value = nextExpandedMap;
    thinkDoneMap.value = nextDoneMap;
    void bindScrollBox();
  },
  { immediate: true },
);

watch(
  () => props.showWelcome,
  () => {
    void bindScrollBox();
  },
);

onMounted(() => {
  void bindScrollBox();
});

onBeforeUnmount(() => {
  scrollBox?.removeEventListener("scroll", updateScrollState);
});
</script>

<template>
  <main
    id="chat-content"
    ref="messagesRoot"
    class="messages-wrapper relative h-full min-h-0 flex-1 overflow-hidden bg-brand-workspace py-6 px-4 lt-md:py-6 lt-md:px-4 lt-sm:py-5 lt-sm:px-3"
    :class="showWelcome ? 'flex flex-col justify-center' : ''"
    tabindex="-1"
  >
    <section v-if="showWelcome" class="empty-state m-auto w-[min(100%,760px)] p-0 text-center">
      <EmptyState>
        <StarterPrompts @prompt-click="emit('promptClick', $event)" />
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
            hasReasoning(item) ? isThinkExpanded(item.key, !isStreamingStatus(item.status)) : false
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
        <template v-if="item.role === 'assistant'">
          <Actions
            v-if="item.status === 'success' && item.key === lastAssistantMessageKey"
            class="message-actions"
            :items="buildMessageActions(item)"
          />
        </template>
      </template>
    </BubbleList>

    <button
      v-if="!showWelcome && showScrollToBottom"
      type="button"
      class="scroll-to-bottom"
      aria-label="回到底部"
      title="回到底部"
      @click="scrollToBottom"
    >
      <ArrowDown class="h-4 w-4" />
    </button>
  </main>
</template>

<style scoped>
.empty-state {
  animation: empty-in 360ms ease-out both;
}

.messages-wrapper :deep(.antd-bubble-list) {
  width: 100%;
  max-width: min(100%, 820px);
  min-width: 0;
  margin: 0 auto;
}
.messages-wrapper :deep(.antd-bubble-list-scroll-box) {
  overflow-x: hidden;
  overscroll-behavior-x: none;
}
.messages-wrapper :deep(.antd-bubble-list-scroll-content) {
  padding-inline: clamp(4px, 1.5vw, 16px);
}
.messages-wrapper :deep(.antd-bubble) {
  animation: message-in 260ms cubic-bezier(0.2, 0, 0, 1) both;
}
.messages-wrapper :deep(.antd-thought-chain) {
  animation: activity-in 220ms ease-out both;
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

.scroll-to-bottom {
  position: absolute;
  right: max(20px, calc((100% - 820px) / 2));
  bottom: 20px;
  z-index: 2;
  display: grid;
  width: 34px;
  height: 34px;
  place-items: center;
  border: 1px solid var(--brand-border-strong);
  border-radius: 999px;
  background: var(--brand-composer);
  color: var(--brand-foreground);
  box-shadow: var(--brand-shadow-float);
  animation: scroll-button-in 180ms ease-out both;
  transition:
    background 150ms ease,
    transform 150ms ease;
}

.scroll-to-bottom:hover {
  background: var(--brand-surface-subtle);
  transform: translateY(-1px);
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

@keyframes activity-in {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes scroll-button-in {
  from {
    opacity: 0;
    transform: translateY(6px) scale(0.92);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}
</style>

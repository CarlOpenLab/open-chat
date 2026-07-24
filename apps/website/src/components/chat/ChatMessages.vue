<script setup lang="ts">
import type { BubbleItemType, BubbleListProps } from "@antdv-next/x";
import { BubbleList, Think, Welcome } from "@antdv-next/x";
import type { XCardCommand } from "@antdv-next/x-card";
import { XMarkdown } from "@antdv-next/x-markdown";
import { RotateCcw, Sparkles } from "@lucide/vue";
import { Button, Tooltip } from "antdv-next";
import { computed, provide, ref, watch, type Component } from "vue";
import {
  getA2UISurfaceId,
  parseA2UIContent,
  type A2UIActionPayload,
  type A2UISubmission,
} from "../../utils/a2ui";
import A2UIRenderer from "./A2UIRenderer.vue";
import MarkdownCodeRenderer from "./MarkdownCodeRenderer.vue";
import { markdownThemeKey, type MarkdownTheme } from "./markdownTheme";

interface Props {
  showWelcome: boolean;
  bubbleItems: BubbleItemType[];
  dark: boolean;
  conversationKey: string;
  a2uiPendingSurfaceId?: string;
  a2uiSubmissions?: A2UISubmission[];
}

interface Emits {
  (e: "a2uiAction", payload: A2UIActionPayload): void;
  (e: "reload", messageId: string | number): void;
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

const markdownComponents: Record<string, Component> = {
  code: MarkdownCodeRenderer,
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
    const parsedA2UI =
      item.role === "assistant" && typeof item.content === "string"
        ? parseA2UIContent(item.content)
        : null;
    const displayContent = parsedA2UI?.markdown ?? item.content;

    return {
      ...item,
      content: displayContent,
      extraInfo: {
        ...item.extraInfo,
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

    if (item.role === "assistant" && !hasVisibleText && !hasVisibleA2UI) return [];

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

const getMarkdownStreaming = (item: BubbleItemType) => ({
  hasNextChunk: isStreamingStatus(item.status),
  enableAnimation: false,
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
    class="messages-wrapper"
    :class="{ 'is-empty': showWelcome }"
    tabindex="-1"
  >
    <section v-if="showWelcome" class="empty-state">
      <Welcome
        class="welcome-hero"
        variant="borderless"
        title="今天想一起完成什么？"
        description="从一个问题开始，或者把正在处理的内容交给 Open Chat。"
      >
        <template #icon><Sparkles /></template>
      </Welcome>
    </section>

    <BubbleList
      v-else
      :style="{ height: '100%' }"
      :role="roleConfig"
      :items="displayItems"
      :auto-scroll="true"
      class="bubble-list"
    >
      <template #avatar="{ role }">
        <span
          class="message-avatar"
          :class="`message-avatar-${role}`"
          :title="role === 'assistant' ? 'Open Chat' : 'Carl Chen'"
        >
          <Sparkles v-if="role === 'assistant'" />
          <span v-else>CC</span>
        </span>
      </template>

      <template #contentRender="{ content, item }">
        <div v-if="item.role === 'assistant'" class="assistant-content-stack">
          <template v-if="item.extraInfo?.parsedThink">
            <Think
              v-if="item.extraInfo.parsedThink.thinkContent"
              :title="item.extraInfo.parsedThink.thinkDone ? '思考过程' : '思考中...'"
              :loading="!item.extraInfo.parsedThink.thinkDone"
              :expanded="isThinkExpanded(item.key, item.extraInfo.parsedThink.thinkDone)"
              :blink="!item.extraInfo.parsedThink.thinkDone"
              @update:expanded="setThinkExpanded(item.key, $event)"
            >
              <XMarkdown
                :content="item.extraInfo.parsedThink.thinkContent"
                :components="markdownComponents"
                :streaming="getMarkdownStreaming(item)"
                :class-name="markdownClassName"
              />
            </Think>
            <XMarkdown
              v-if="item.extraInfo.parsedThink.answerContent"
              :content="item.extraInfo.parsedThink.answerContent"
              :components="markdownComponents"
              :streaming="getMarkdownStreaming(item)"
              :class-name="markdownClassName"
            />
          </template>
          <XMarkdown
            v-else
            :content="String(content)"
            :components="markdownComponents"
            :streaming="getMarkdownStreaming(item)"
            :class-name="markdownClassName"
          />
          <A2UIRenderer
            v-if="
              item.extraInfo?.parsedA2UI &&
              (item.extraInfo.parsedA2UI.commands.length ||
                item.extraInfo.parsedA2UI.errors.length ||
                item.extraInfo.parsedA2UI.hasPendingBlock)
            "
            :commands="item.extraInfo.parsedA2UI.commands"
            :errors="item.extraInfo.parsedA2UI.errors"
            :pending="item.extraInfo.parsedA2UI.hasPendingBlock"
            :action-pending="isA2UIActionPending(item.extraInfo.parsedA2UI.commands)"
            :owner-message-id="String(item.key)"
            :submissions="submissionsForMessage(item.key)"
            @action="emit('a2uiAction', $event)"
          />
        </div>
        <span v-else>{{ content }}</span>
      </template>

      <template #footer="{ item }">
        <Tooltip
          v-if="
            item.role === 'assistant' &&
            item.status === 'success' &&
            item.key === lastAssistantMessageKey
          "
          title="重新生成"
        >
          <Button
            size="small"
            type="text"
            aria-label="重新生成回答"
            @click="emit('reload', item.key)"
          >
            <RotateCcw />
          </Button>
        </Tooltip>
      </template>
    </BubbleList>
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
.messages-wrapper.is-empty {
  display: flex;
  flex-direction: column;
  justify-content: center;
}
.empty-state {
  width: min(100%, 700px);
  margin: auto;
  padding: 0;
  text-align: center;
  animation: empty-in 360ms ease-out both;
}
/* Welcome 组件：覆盖为居中纵向布局，匹配空态 hero */
.welcome-hero {
  flex-direction: column;
  align-items: center;
  text-align: center;
}
.welcome-hero :deep(.antd-welcome-content-wrapper) {
  align-items: center;
}
.welcome-hero :deep(.antd-welcome-icon) {
  display: grid;
  flex: 0 0 auto;
  width: 42px;
  height: 42px;
  place-items: center;
  margin: 0;
  border-radius: 7px;
  background: var(--brand-primary);
  color: var(--brand-primary-foreground);
  box-shadow: var(--brand-shadow-sm);
}
.welcome-hero :deep(.antd-welcome-icon svg) {
  width: 19px;
  height: 19px;
}
.welcome-hero :deep(.antd-welcome-title) {
  margin: 0;
  color: var(--brand-foreground);
  font-size: 28px;
  line-height: 1.2;
  font-weight: 680;
  text-align: center;
}
.welcome-hero :deep(.antd-welcome-description) {
  display: block;
  max-width: 460px;
  margin: 0;
  color: var(--brand-muted);
  font-size: 13px;
  text-align: center;
}
.messages-wrapper :deep(.antd-bubble-list) {
  width: min(100%, 780px);
  min-width: 0;
  max-width: 100%;
  margin: 0 auto;
}
.messages-wrapper :deep(.antd-bubble-list-scroll-box) {
  min-width: 0;
  overflow-x: hidden;
  overscroll-behavior-x: none;
}
.messages-wrapper :deep(.antd-bubble-list-scroll-content) {
  width: 100%;
  min-width: 0;
  max-width: 100%;
  padding-inline: 0;
}
.messages-wrapper :deep(.antd-bubble) {
  min-width: 0;
  max-width: 100%;
  padding-block: 15px;
}
.messages-wrapper :deep(.antd-bubble-start) {
  padding-inline-end: 0 !important;
}
.messages-wrapper :deep(.antd-bubble-end) {
  padding-inline-start: 0 !important;
}
.messages-wrapper :deep(.antd-bubble-avatar) {
  min-width: 32px;
}
.message-avatar {
  display: grid;
  width: 30px;
  height: 30px;
  place-items: center;
  border: 1px solid var(--brand-border);
  border-radius: 6px;
  box-shadow: var(--brand-shadow-xs);
  font-size: 10px;
  font-weight: 700;
}
.message-avatar-assistant {
  border-color: var(--brand-primary);
  background: var(--brand-primary);
  color: var(--brand-primary-foreground);
}
.message-avatar-user {
  background: var(--brand-surface);
  color: var(--brand-foreground);
}
.message-avatar :deep(svg) {
  width: 15px;
  height: 15px;
}
.assistant-content-stack {
  display: flex;
  width: 100%;
  min-width: 0;
  max-width: 100%;
  flex-direction: column;
  gap: 12px;
}
.messages-wrapper :deep(.antd-bubble-body),
.messages-wrapper :deep(.antd-bubble-content) {
  min-width: 0;
  max-width: 100%;
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
.messages-wrapper :deep(.antd-bubble-footer .ant-btn svg) {
  width: 14px;
  height: 14px;
}
.messages-wrapper :deep(.chat-markdown) {
  width: 100%;
  min-width: 0;
  max-width: 100%;
  color: var(--brand-foreground);
  font-size: 13px;
  line-height: 1.82;
  overflow-wrap: anywhere;
}
.messages-wrapper :deep(.chat-markdown pre),
.messages-wrapper :deep(.chat-markdown table),
.messages-wrapper :deep(.antd-code-highlighter) {
  width: 100%;
  min-width: 0;
  max-width: 100%;
}
.messages-wrapper :deep(.chat-markdown pre),
.messages-wrapper :deep(.chat-markdown table) {
  overflow-x: auto;
  overscroll-behavior-x: contain;
}
.messages-wrapper :deep(.antd-code-highlighter-content),
.messages-wrapper :deep(.antd-code-highlighter-code) {
  min-width: 0;
  max-width: 100%;
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
  .welcome-hero :deep(.antd-welcome-title) {
    font-size: 24px;
  }
  .welcome-hero :deep(.antd-welcome-description) {
    max-width: 300px;
    margin-inline: auto;
  }
}
</style>

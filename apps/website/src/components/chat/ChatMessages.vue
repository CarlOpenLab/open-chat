<script setup lang="ts">
import type { BubbleItemType } from "@antdv-next/x";
import { computed, provide } from "vue";
import type { WebSearchSourceItem, UploadedAttachment } from "../../services/ai";
import { attachmentUrl } from "../../services/ai";
import type { TranscriptMessage } from "@cc-heart/open-chat-types";
import AssistantBubble from "./AssistantBubble.vue";
import ActivityList from "./ActivityList.vue";
import EmptyState from "./EmptyState.vue";
import UserMessageBubble from "./UserMessageBubble.vue";
import WorkingIndicator from "./WorkingIndicator.vue";
import {
  activityMessages,
  isStreamingStatus,
  useMessageActivityState,
} from "../../composables/useMessageActivityState";
import { markdownThemeKey, type MarkdownTheme } from "./markdownTheme";

interface Props {
  showWelcome: boolean;
  bubbleItems: BubbleItemType[];
  dark: boolean;
  conversationKey: string;
  searchResultsByMessageId?: Record<string, WebSearchSourceItem[]>;
  /** 会话运行中（与侧栏 busy 状态同源），控制列尾"工作中"指示。 */
  working?: boolean;
  /** 当前会话服务端运行起点，刷新恢复时与侧栏计时保持一致。 */
  workingStartedAtMs?: number;
  /** 空状态标题中的项目目录（由外层 Chat 传入） */
  projectPath?: string;
  projectPathOptions?: string[];
}

interface Emits {
  (e: "reload", messageId: string | number): void;
  (e: "promptClick", info: { data: { key: string; description: string } }): void;
  (e: "projectPathChange", value: string): void;
  (e: "projectPathRemove", value: string): void;
}

const props = withDefaults(defineProps<Props>(), {
  searchResultsByMessageId: () => ({}),
  workingStartedAtMs: undefined,
  working: false,
});
const emit = defineEmits<Emits>();

/** 从消息里取出图片附件（仅 user 消息携带，经 modelMessagesToBubbleItems 放入 extraInfo）。 */
function userMessageAttachments(item: {
  extraInfo?: { attachments?: unknown };
}): UploadedAttachment[] {
  const list = item.extraInfo?.attachments;
  if (!Array.isArray(list)) return [];
  const imageNamePattern = /\.(?:png|jpe?g|gif|webp|bmp|svg|tiff?|ico|pn[mg]|pbm|pgm|ppm)$/i;
  return list.filter((entry): entry is UploadedAttachment => {
    if (typeof entry !== "object" || entry === null) return false;
    const candidate = entry as UploadedAttachment;
    return (
      typeof candidate.reference === "string" &&
      typeof candidate.name === "string" &&
      (candidate.isImage === true || imageNamePattern.test(candidate.name))
    );
  });
}
const markdownTheme = computed<MarkdownTheme>(() => (props.dark ? "dark" : "light"));
const markdownClassName = computed(() => `chat-markdown x-markdown-${markdownTheme.value}`);
provide(markdownThemeKey, markdownTheme);

/** 气泡对应的扁平消息片段（assistant）。 */
const messageFragment = (item: BubbleItemType): TranscriptMessage | undefined =>
  item.extraInfo?.message as TranscriptMessage | undefined;

/** 活动气泡（思考/工具/计划/文件修改/工作区），不含正文。 */
const isActivityItem = (item: BubbleItemType): boolean =>
  item.role === "assistant" && item.extraInfo?.messageRole !== "content";

/**
 * 把相邻的活动气泡合并为一组：正文之间的思考/文件修改/工具… 只渲染一个
 * ActivityList，摘要合并为「已执行：N 次文件修改，M 次思考」。
 * 组 key 复用首条成员 key，流式追加成员时展开/计时状态保持连续。
 */
function buildActivityGroup(members: BubbleItemType[]): BubbleItemType {
  const first = members[0];
  const streaming = members.some((member) => isStreamingStatus(member.status));
  const flags = members
    .map((member) => member.extraInfo?.reasoningDone)
    .filter((value): value is boolean => typeof value === "boolean");
  return {
    key: first.key,
    role: "assistant",
    status: streaming ? "updating" : "success",
    loading: false,
    content: "",
    extraInfo: {
      ...first.extraInfo,
      messageRole: "activities",
      messages: members.flatMap(activityMessages),
      ...(flags.length ? { reasoningDone: flags.every(Boolean) } : {}),
    },
  };
}

/**
 * 丢弃完全空白的 assistant 气泡（无正文、无活动、无错误/提示）。
 * 内容清洗（think/workspace 剥离）已上移到数据层，这里不再做字符串解析。
 * 相邻的活动气泡在此合并为一组，正文（content）气泡保持独立。
 */
const displayItems = computed<BubbleItemType[]>(() => {
  const items = props.bubbleItems.filter((item) => {
    if (item.role !== "assistant" || isStreamingStatus(item.status)) return true;
    const hasContent = typeof item.content === "string" && item.content.trim().length > 0;
    const hasFragment = Boolean(messageFragment(item));
    const hasMeta =
      Boolean(item.extraInfo?.chatError) ||
      (Array.isArray(item.extraInfo?.chatNotices) && item.extraInfo.chatNotices.length > 0);
    return hasContent || hasFragment || hasMeta;
  });

  const grouped: BubbleItemType[] = [];
  let pending: BubbleItemType[] = [];
  const flush = () => {
    if (pending.length) grouped.push(buildActivityGroup(pending));
    pending = [];
  };
  for (const item of items) {
    if (isActivityItem(item)) {
      pending.push(item);
    } else {
      flush();
      grouped.push(item);
    }
  }
  flush();
  return grouped;
});

const lastAssistantMessageKey = computed(
  () =>
    [...displayItems.value]
      .reverse()
      .find((item) => item.role === "assistant" && item.extraInfo?.messageRole === "content")?.key,
);

/** 用户气泡的图片附件缩略图：过滤图片附件并解析渲染 URL（气泡组件只收成品 src）。 */
const userAttachmentsByItemKey = computed<
  Record<string, Array<{ reference: string; name: string; src: string }>>
>(() => {
  const byKey: Record<string, Array<{ reference: string; name: string; src: string }>> = {};
  displayItems.value.forEach((item) => {
    if (item.role !== "user") return;
    byKey[String(item.key)] = userMessageAttachments(item).map((att) => ({
      reference: att.reference,
      name: att.name,
      src: attachmentUrl(att.reference, att.name),
    }));
  });
  return byKey;
});

/** 活动摘要展开态、条目展开态、回合/思考耗时统计（详见 useMessageActivityState）。 */
const {
  isSummaryExpanded,
  isItemExpandedIds,
  setSummaryExpanded,
  setItemExpandedIds,
  getReasoningDurationMs,
} = useMessageActivityState({
  displayItems,
  conversationKey: () => props.conversationKey,
  workingStartedAtMs: () => props.workingStartedAtMs,
});
</script>

<template>
  <main
    id="chat-content"
    class="messages-wrapper relative h-full min-h-0 flex-1 overflow-hidden bg-brand-workspace py-6 px-4 lt-md:py-6 lt-md:px-4 lt-sm:py-5 lt-sm:px-3"
    :class="showWelcome ? 'flex flex-col justify-center' : ''"
    tabindex="-1"
  >
    <section v-if="showWelcome" class="empty-state m-auto w-[min(100%,760px)] p-0 text-center">
      <EmptyState
        :project-path="projectPath"
        :project-path-options="projectPathOptions"
        @project-path-change="emit('projectPathChange', $event)"
        @project-path-remove="emit('projectPathRemove', $event)"
      />
    </section>

    <div v-else class="chat-scroll-box h-full min-h-0 overflow-y-auto overscroll-contain">
      <div
        class="chat-list mx-auto flex w-full min-w-0 max-w-[min(100%,820px)] flex-col gap-2 px-[clamp(4px,1.5vw,16px)] py-6"
      >
        <template v-for="item in displayItems" :key="item.key">
          <!-- 用户消息气泡（Bubble 组件） -->
          <UserMessageBubble
            v-if="item.role === 'user'"
            :content="String(item.content ?? '')"
            :attachments="userAttachmentsByItemKey[String(item.key)]"
          />

          <!-- 正文气泡（assistant content → markdown） -->
          <AssistantBubble
            v-else-if="item.extraInfo?.messageRole === 'content'"
            :item="item"
            :content="String(item.content ?? '')"
            :markdown-class-name="markdownClassName"
            :streaming="isStreamingStatus(item.status)"
            :search-results="searchResultsByMessageId?.[String(item.key)] ?? []"
            :show-actions="item.status === 'success' && item.key === lastAssistantMessageKey"
            @reload="emit('reload', $event)"
          />

          <!-- 活动行（思考/工具/计划/文件/工作区）：非气泡，平铺展示 -->
          <div v-else class="activity-row w-full min-w-0 max-w-full">
            <ActivityList
              :messages="activityMessages(item)"
              :streaming="isStreamingStatus(item.status)"
              :reasoning-done="item.extraInfo?.reasoningDone !== false"
              :summary-expanded="isSummaryExpanded(item.key, isStreamingStatus(item.status))"
              :item-expanded-ids="isItemExpandedIds(item)"
              :reasoning-duration-ms="getReasoningDurationMs(item.key)"
              @update:summary-expanded="setSummaryExpanded(item.key, $event)"
              @update:item-expanded-ids="setItemExpandedIds(item.key, $event)"
            />
          </div>
        </template>

        <!-- 进行中指示：会话运行中（与侧栏 busy 状态同源），列尾常驻显示 -->
        <WorkingIndicator :working="working" :working-started-at-ms="workingStartedAtMs" />
      </div>
    </div>
  </main>
</template>

<style scoped>
.empty-state {
  animation: empty-in 360ms ease-out both;
}

.chat-scroll-box {
  scrollbar-width: thin;
  overscroll-behavior-y: contain;
}

.chat-list {
  min-width: 0;
}

.activity-row {
  animation: activity-in 220ms ease-out both;
}

.messages-wrapper :deep(.chat-markdown) {
  min-width: 0;
  max-width: 100%;
  color: var(--brand-foreground);
  white-space: normal;
}
.messages-wrapper :deep(.chat-markdown p),
.messages-wrapper :deep(.chat-markdown li) {
  white-space: normal;
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
</style>

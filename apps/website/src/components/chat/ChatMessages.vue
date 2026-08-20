<script setup lang="ts">
import type { BubbleItemType, ItemType } from "@antdv-next/x";
import { Actions, Bubble } from "@antdv-next/x";
import { ArrowDown, Copy, RotateCcw } from "@lucide/vue";
import { computed, h, nextTick, onBeforeUnmount, onMounted, provide, ref, watch } from "vue";
import type { WebSearchSourceItem, UploadedAttachment } from "../../services/ai";
import { attachmentUrl } from "../../services/ai";
import { formatWorkingElapsed } from "../../utils/chatDuration";
import type { TranscriptMessage } from "@cc-heart/open-chat-types";
import AssistantMessageContent from "./AssistantMessageContent.vue";
import ActivityList from "./ActivityList.vue";
import EmptyState from "./EmptyState.vue";
import { markdownThemeKey, type MarkdownTheme } from "./markdownTheme";
import { Image } from "antdv-next";

export type AutoScrollMode = "follow" | "always" | "never";

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
  /** 流式输出时的自动滚动策略，默认智能跟随 */
  autoScrollMode?: AutoScrollMode;
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
  autoScrollMode: "follow",
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
const messagesRoot = ref<HTMLElement | null>(null);
const showScrollToBottom = ref(false);
let scrollBox: HTMLElement | null = null;
let scrollRestoreFrame: number | null = null;

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
  scrollBox = messagesRoot.value?.querySelector<HTMLElement>(".chat-scroll-box") ?? null;
  scrollBox?.addEventListener("scroll", updateScrollState, { passive: true });
  updateScrollState();
};

/** 展开/收起活动详情会改变气泡高度，动画期间保持当前滚动锚点。 */
const updateWithScrollAnchor = (update: () => void) => {
  const box = scrollBox;
  if (!box) {
    update();
    return;
  }

  if (scrollRestoreFrame !== null) cancelAnimationFrame(scrollRestoreFrame);
  const top = box.scrollTop;
  const maxTop = Math.max(0, box.scrollHeight - box.clientHeight);
  const stickToBottom = maxTop - top <= 24;
  update();

  const startedAt = performance.now();
  const restore = () => {
    if (!scrollBox) {
      scrollRestoreFrame = null;
      return;
    }
    const nextMaxTop = Math.max(0, scrollBox.scrollHeight - scrollBox.clientHeight);
    scrollBox.scrollTop = stickToBottom ? nextMaxTop : Math.min(top, nextMaxTop);
    updateScrollState();
    if (performance.now() - startedAt < 260) {
      scrollRestoreFrame = requestAnimationFrame(restore);
    } else {
      scrollRestoreFrame = null;
    }
  };

  void nextTick(restore);
};
const markdownTheme = computed<MarkdownTheme>(() => (props.dark ? "dark" : "light"));
const markdownClassName = computed(() => `chat-markdown x-markdown-${markdownTheme.value}`);
provide(markdownThemeKey, markdownTheme);
/** 活动摘要、条目展开、耗时统计。 */
const summaryExpandedMap = ref<Record<string, boolean>>({});
const itemExpandedMap = ref<Record<string, string[]>>({});
/** 用户在流式中手动折叠过思考条目（显式点击优先于自动展开）。 */
const reasoningCollapsedMap = ref<Record<string, boolean>>({});
const messageStartMap = ref<Record<string, number>>({});
const turnDurationMap = ref<Record<string, number>>({});
const reasoningStartMap = ref<Record<string, number>>({});
const reasoningDurationMap = ref<Record<string, number>>({});
const lastStreamingMap = ref<Record<string, boolean>>({});

/** useXChat 中 "loading"（占位等待）和 "updating"（流式接收中）都表示消息仍在进行中 */
const isStreamingStatus = (status: unknown): boolean =>
  status === "loading" || status === "updating";

/** 气泡对应的扁平消息片段（assistant）。 */
const messageFragment = (item: BubbleItemType): TranscriptMessage | undefined =>
  item.extraInfo?.message as TranscriptMessage | undefined;

/** 取气泡携带的活动消息：合并组携带多条，普通气泡携带单条。 */
const activityMessages = (item: BubbleItemType): TranscriptMessage[] => {
  const extra = item.extraInfo as { messages?: unknown; message?: unknown } | undefined;
  if (Array.isArray(extra?.messages)) return extra.messages as TranscriptMessage[];
  return extra?.message ? [extra.message as TranscriptMessage] : [];
};

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

/** 流式中保持吸底：有消息仍在进行时，随内容增长滚动到底部。 */
const scrollToBottom = () => {
  if (!scrollBox) return;
  scrollBox.scrollTo({ top: scrollBox.scrollHeight, behavior: "smooth" });
  showScrollToBottom.value = false;
};
const shouldAutoScroll = (): boolean => {
  if (props.autoScrollMode === "never") return false;
  if (props.autoScrollMode === "always") return true;
  // follow: 仅当用户已在底部附近时才跟随，避免打断上方阅读
  if (!scrollBox) return false;
  const distance = scrollBox.scrollHeight - scrollBox.clientHeight - scrollBox.scrollTop;
  return distance <= 160;
};
const autoScrollOnStream = () => {
  if (!scrollBox) return;
  if (!displayItems.value.some((item) => isStreamingStatus(item.status))) return;
  if (!shouldAutoScroll()) return;
  scrollBox.scrollTo({ top: scrollBox.scrollHeight, behavior: "auto" });
};

const getThinkKey = (messageId: string | number) =>
  `${props.conversationKey || "__draft__"}::${String(messageId)}`;

const persistedTurnDuration = (item: BubbleItemType): number | undefined => {
  const value = (item.extraInfo as { turnDurationMs?: unknown } | undefined)?.turnDurationMs;
  return typeof value === "number" && value > 0 ? value : undefined;
};

/** 历史消息（本次会话未观测到耗时）默认展开活动列表；本次会话中结束的回合默认折叠为分割线。 */
const isSummaryExpanded = (messageId: string | number, streaming: boolean): boolean => {
  const key = getThinkKey(messageId);
  const saved = summaryExpandedMap.value[key];
  return saved !== undefined ? saved : streaming;
};

/** 流式中思考自动展开；其余条目跟随用户手动展开状态。用户手动折叠思考后不再自动展开。 */
const isItemExpandedIds = (item: BubbleItemType): string[] => {
  const key = getThinkKey(item.key);
  const saved = itemExpandedMap.value[key] ?? [];
  const hasReasoning = activityMessages(item).some((message) => message.role === "reasoning");
  const reasoningLive =
    isStreamingStatus(item.status) &&
    hasReasoning &&
    item.extraInfo?.reasoningDone !== true &&
    !reasoningCollapsedMap.value[key];
  if (!reasoningLive) return saved;
  return saved.includes("reasoning") ? saved : [...saved, "reasoning"];
};

const setSummaryExpanded = (messageId: string | number, expanded: boolean) => {
  summaryExpandedMap.value = { ...summaryExpandedMap.value, [getThinkKey(messageId)]: expanded };
};
const setItemExpandedIds = (messageId: string | number, ids: string[]) => {
  const key = getThinkKey(messageId);
  updateWithScrollAnchor(() => {
    itemExpandedMap.value = { ...itemExpandedMap.value, [key]: ids };
    const collapsed = !ids.includes("reasoning");
    reasoningCollapsedMap.value = collapsed
      ? { ...reasoningCollapsedMap.value, [key]: true }
      : (() => {
          const next = { ...reasoningCollapsedMap.value };
          delete next[key];
          return next;
        })();
  });
};

/** 气泡下方操作栏：复制 + 重新生成（x Actions 原生样式）。 */
const buildMessageActions = (item: BubbleItemType): ItemType[] => {
  const content =
    typeof item.content === "string"
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

/** 列尾"工作中 · Xs"跳动计时：跟随 busy 状态，会话运行中每秒刷新。 */
const nowMs = ref(Date.now());
let workingTickTimer: ReturnType<typeof setInterval> | undefined;
watch(
  () => props.working,
  (working) => {
    if (working && !workingTickTimer) {
      nowMs.value = Date.now();
      workingTickTimer = setInterval(() => {
        nowMs.value = Date.now();
      }, 1000);
    } else if (!working && workingTickTimer) {
      clearInterval(workingTickTimer);
      workingTickTimer = undefined;
    }
  },
  { immediate: true },
);
const workingElapsed = computed(() =>
  props.workingStartedAtMs
    ? formatWorkingElapsed(Math.max(0, nowMs.value - props.workingStartedAtMs))
    : "",
);

watch(
  [displayItems, () => props.workingStartedAtMs],
  ([items]) => {
    const now = Date.now();
    const nextSummary = { ...summaryExpandedMap.value };

    items.forEach((item) => {
      if (item.role !== "assistant") return;

      const key = getThinkKey(item.key);
      const streaming = isStreamingStatus(item.status);
      const prevStreaming = lastStreamingMap.value[key] ?? false;
      const storedDuration = persistedTurnDuration(item);
      if (storedDuration && !turnDurationMap.value[key]) {
        turnDurationMap.value[key] = storedDuration;
      }

      // 回合计时：首次出现 / 重新生成时记录起点；结束时记录耗时。
      if (streaming) {
        if (!prevStreaming) {
          messageStartMap.value[key] = props.workingStartedAtMs ?? now;
        } else if (props.workingStartedAtMs) {
          // 运行态可能在消息快照之后才从服务端返回，及时纠正刷新时的临时起点。
          messageStartMap.value[key] = props.workingStartedAtMs;
        }
        if (turnDurationMap.value[key]) {
          delete turnDurationMap.value[key];
          delete reasoningDurationMap.value[key];
          delete reasoningStartMap.value[key];
        }
      } else if (messageStartMap.value[key] && !turnDurationMap.value[key]) {
        turnDurationMap.value[key] = Math.max(1, now - messageStartMap.value[key]);
      }

      // 思考计时（合并组内任一成员是思考，即按组计时）。
      const hasReasoning = activityMessages(item).some((message) => message.role === "reasoning");
      if (hasReasoning) {
        if (!reasoningStartMap.value[key]) reasoningStartMap.value[key] = now;
        if (item.extraInfo?.reasoningDone === true && !reasoningDurationMap.value[key]) {
          reasoningDurationMap.value[key] = Math.max(1, now - reasoningStartMap.value[key]);
        }
      }

      // 活动摘要：流式中默认展开（实时看进度），回合结束默认折叠为"已执行：…"。
      // 流式中的默认展开由 isSummaryExpanded 的 fallback (saved ?? streaming) 提供，
      // 此处不再在 streaming 时写入 true，以允许用户在流式中手动折叠后保持折叠态。
      if (prevStreaming && !streaming) {
        // 回合结束自动收敛为折叠，用户之后可手动再展开
        nextSummary[key] = false;
      }

      lastStreamingMap.value[key] = streaming;
    });

    summaryExpandedMap.value = nextSummary;
    void bindScrollBox();
    autoScrollOnStream();
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
  if (scrollRestoreFrame !== null) cancelAnimationFrame(scrollRestoreFrame);
  if (workingTickTimer) clearInterval(workingTickTimer);
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
          <div v-if="item.role === 'user'" class="flex w-full justify-end">
            <Bubble
              class="user-bubble"
              placement="end"
              variant="filled"
              shape="round"
              :content="String(item.content ?? '')"
            >
              <template #contentRender="{ content }">
                <div v-if="userMessageAttachments(item).length" class="user-attachments">
                  <div
                    v-for="att in userMessageAttachments(item)"
                    :key="att.reference"
                    class="user-attachment-link"
                  >
                    <Image
                      :src="attachmentUrl(att.reference, att.name)"
                      :alt="att.name"
                      class="user-attachment-image"
                    />
                  </div>
                </div>
                <span class="whitespace-pre-wrap break-words">{{ content }}</span>
              </template>
            </Bubble>
          </div>

          <!-- 正文气泡（assistant content → markdown） -->
          <div
            v-else-if="item.extraInfo?.messageRole === 'content'"
            class="flex w-full justify-start"
          >
            <div class="assistant-bubble w-full min-w-0 max-w-full">
              <AssistantMessageContent
                :item="item"
                :content="String(item.content ?? '')"
                :markdown-class-name="markdownClassName"
                :streaming="isStreamingStatus(item.status)"
                :search-results="searchResultsByMessageId?.[String(item.key)] ?? []"
              />
              <div
                v-if="item.status === 'success' && item.key === lastAssistantMessageKey"
                class="message-actions"
              >
                <Actions :items="buildMessageActions(item)" />
              </div>
            </div>
          </div>

          <!-- 活动行（思考/工具/计划/文件/工作区）：非气泡，平铺展示 -->
          <div v-else class="activity-row w-full min-w-0 max-w-full">
            <ActivityList
              :messages="activityMessages(item)"
              :streaming="isStreamingStatus(item.status)"
              :reasoning-done="item.extraInfo?.reasoningDone !== false"
              :summary-expanded="isSummaryExpanded(item.key, isStreamingStatus(item.status))"
              :item-expanded-ids="isItemExpandedIds(item)"
              :reasoning-duration-ms="reasoningDurationMap[getThinkKey(item.key)]"
              @update:summary-expanded="setSummaryExpanded(item.key, $event)"
              @update:item-expanded-ids="setItemExpandedIds(item.key, $event)"
            />
          </div>
        </template>

        <!-- 进行中指示：会话运行中（与侧栏 busy 状态同源），列尾常驻显示 -->
        <div v-if="working" class="flex w-full justify-start" role="status" aria-live="polite">
          <div
            class="inline-flex min-h-[22px] items-center gap-2 text-[11.5px] leading-4 font-medium text-brand-muted-strong animate-[working-status-in_220ms_ease-out_both]"
          >
            <span class="inline-flex items-center gap-[3.5px]" aria-hidden="true">
              <i
                class="h-[4.5px] w-[4.5px] rounded-full bg-current animate-[working-wave_1.4s_linear_infinite]"
              />
              <i
                class="h-[4.5px] w-[4.5px] rounded-full bg-current animate-[working-wave_1.4s_linear_infinite] [animation-delay:0.12s]"
              />
              <i
                class="h-[4.5px] w-[4.5px] rounded-full bg-current animate-[working-wave_1.4s_linear_infinite] [animation-delay:0.24s]"
              />
            </span>
            <span>工作中{{ workingElapsed ? ` · ${workingElapsed}` : "" }}</span>
          </div>
        </div>
      </div>
    </div>

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

.chat-scroll-box {
  scrollbar-width: thin;
  overscroll-behavior-y: contain;
}

.chat-list {
  min-width: 0;
}

.user-bubble {
  max-width: 50%;
  word-break: break-all;
  animation: message-in 260ms cubic-bezier(0.2, 0, 0, 1) both;
}

.assistant-bubble {
  animation: message-in 260ms cubic-bezier(0.2, 0, 0, 1) both;
}
.assistant-bubble :deep(.assistant-message) {
  width: 100%;
  max-width: 100%;
  min-width: 0;
}

.activity-row {
  animation: activity-in 220ms ease-out both;
}

.message-actions {
  display: flex;
  margin-top: 4px;
}
.message-actions :deep(.antd-actions) {
  justify-content: flex-end;
}

.user-attachments {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 6px;
}
.user-attachment-link {
  display: block;
  width: 160px;
  max-width: 100%;
  overflow: hidden;
  border: 1px solid var(--brand-border);
  border-radius: 10px;
}
.user-attachment-image {
  display: block;
  width: 100%;
  height: 112px;
  object-fit: cover;
  transition: transform 160ms ease;
}
.user-attachment-link:hover .user-attachment-image {
  transform: scale(1.02);
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

@keyframes working-wave {
  0%,
  100% {
    opacity: 0.25;
  }
  50% {
    opacity: 1;
  }
}

@keyframes working-status-in {
  from {
    opacity: 0;
    transform: translateY(3px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>

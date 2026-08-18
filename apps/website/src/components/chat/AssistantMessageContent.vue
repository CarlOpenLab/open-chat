<script setup lang="ts">
import type { BubbleItemType } from "@antdv-next/x";
import { Sources } from "@antdv-next/x";
import { XMarkdown } from "@antdv-next/x-markdown";
import { Globe2, TriangleAlert } from "@lucide/vue";
import { computed, onBeforeUnmount, ref, watch } from "vue";
import type { Component } from "vue";
import type { WebSearchSourceItem } from "../../services/ai";
import type { TranscriptSegment } from "@cc-heart/open-chat-types";
import { formatWorkingElapsed } from "../../utils/chatDuration";
import MarkdownCodeRenderer from "./MarkdownCodeRenderer.vue";
import ActivityList from "./ActivityList.vue";

interface Props {
  item: BubbleItemType;
  content: string;
  markdownClassName: string;
  streaming: boolean;
  /** 活动列表摘要行是否展开。 */
  summaryExpanded: boolean;
  /** 已展开的条目 id（思考 / 工具 / 计划 / 文件）。 */
  itemExpandedIds: string[];
  /** 整个回合的耗时（用于分割线"用时 Xs"）。 */
  turnDurationMs?: number;
  /** 思考阶段的耗时（用于"思考用时 Xs"）。 */
  reasoningDurationMs?: number;
  /** 回合开始时间戳（用于底部"工作中 · Xs"跳动）。 */
  startedAtMs?: number;
  searchResults: WebSearchSourceItem[];
}

const props = defineProps<Props>();
const emit = defineEmits<{
  (e: "update:summaryExpanded", expanded: boolean): void;
  (e: "update:itemExpandedIds", ids: string[]): void;
}>();

const markdownComponents: Record<string, Component> = {
  code: MarkdownCodeRenderer,
};

const markdownStreaming = computed(() => ({
  hasNextChunk: props.streaming,
  enableAnimation: props.streaming,
  tail: false,
}));

const segments = computed<TranscriptSegment[]>(() => {
  const value = props.item.extraInfo?.segments;
  return Array.isArray(value) ? (value as TranscriptSegment[]) : [];
});
const reasoningDone = computed(() => props.item.extraInfo?.reasoningDone === true);
/** 活动列表只承载思考/工具/计划/文件等"活动"，正文由下方 XMarkdown 单独渲染。 */
const activitySegments = computed(() =>
  segments.value.filter((segment) => segment.kind !== "content"),
);

const hasActivities = computed(() => activitySegments.value.length > 0);

/** 底部"工作中 · Xs"跳动计时。 */
const nowMs = ref(Date.now());
let tickTimer: ReturnType<typeof setInterval> | undefined;
watch(
  () => props.streaming,
  (streaming) => {
    if (streaming && !tickTimer) {
      nowMs.value = Date.now();
      tickTimer = setInterval(() => {
        nowMs.value = Date.now();
      }, 1000);
    } else if (!streaming && tickTimer) {
      clearInterval(tickTimer);
      tickTimer = undefined;
    }
  },
  { immediate: true },
);
const workingElapsed = computed(() =>
  props.startedAtMs ? formatWorkingElapsed(Math.max(0, nowMs.value - props.startedAtMs)) : "",
);
onBeforeUnmount(() => {
  if (tickTimer) clearInterval(tickTimer);
});

const chatNotices = computed(() => {
  const notices = props.item.extraInfo?.chatNotices;
  return Array.isArray(notices) ? (notices as string[]) : [];
});
const chatError = computed(() =>
  typeof props.item.extraInfo?.chatError === "string" ? props.item.extraInfo.chatError : "",
);

const getFaviconUrl = (url: string): string => {
  try {
    const { hostname } = new URL(url);
    return `https://t1.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://${hostname}&size=32`;
  } catch {
    return "";
  }
};
const failedFavicons = ref<Set<string>>(new Set());
const onFaviconError = (url: string) => {
  const next = new Set(failedFavicons.value);
  next.add(url);
  failedFavicons.value = next;
};
</script>

<template>
  <div class="assistant-message flex w-full min-w-0 max-w-full flex-col gap-3">
    <div v-if="chatNotices.length" class="flex flex-col gap-1 text-xs text-brand-muted">
      <span v-for="notice in chatNotices" :key="notice" class="inline-flex items-start gap-1.5">
        <TriangleAlert class="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>{{ notice }}</span>
      </span>
    </div>

    <!-- 活动摘要行 + 可展开列表：默认折叠为"已执行：N 次命令，M 次思考"，点击展开 -->
    <ActivityList
      v-if="hasActivities"
      :segments="activitySegments"
      :streaming="streaming"
      :reasoning-done="reasoningDone"
      :summary-expanded="summaryExpanded"
      :item-expanded-ids="itemExpandedIds"
      :reasoning-duration-ms="reasoningDurationMs"
      @update:summary-expanded="emit('update:summaryExpanded', $event)"
      @update:item-expanded-ids="emit('update:itemExpandedIds', $event)"
    />

    <!-- 正文始终单独渲染 -->
    <XMarkdown
      v-if="content.trim()"
      :content="content"
      :components="markdownComponents"
      :streaming="markdownStreaming"
      :class-name="markdownClassName"
      :config="{ breaks: true }"
      open-links-in-new-tab
    />

    <div v-if="chatError" class="inline-flex items-start gap-1.5 text-xs text-red-500">
      <TriangleAlert class="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>请求失败：{{ chatError }}</span>
    </div>

    <Sources
      v-if="searchResults.length"
      :items="searchResults"
      title="来源"
      :on-click="(source) => source.url && window.open(source.url, '_blank', 'noopener,noreferrer')"
    >
      <template #title="{ originNode }">
        <span class="inline-flex items-center gap-1.5"
          ><Globe2 class="h-3.5 w-3.5" />{{ originNode }}</span
        >
      </template>
      <template #iconRender="{ item: sourceItem }">
        <img
          v-if="sourceItem.url && !failedFavicons.has(sourceItem.url)"
          class="h-4 w-4 object-contain"
          :src="getFaviconUrl(sourceItem.url)"
          :alt="String(sourceItem.title)"
          loading="lazy"
          @error="onFaviconError(sourceItem.url)"
        />
        <Globe2 v-else class="h-4 w-4" />
      </template>
    </Sources>

    <!-- 进行中指示：底部"工作中 · Xs"，随内容流式跳动 -->
    <div
      v-if="streaming"
      class="inline-flex min-h-[22px] items-center gap-2 text-[11.5px] leading-4 font-medium text-brand-muted-strong animate-[working-status-in_220ms_ease-out_both]"
      role="status"
      aria-live="polite"
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
</template>

<style>
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

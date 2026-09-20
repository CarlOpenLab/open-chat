<script setup lang="ts">
import { computed, inject, onBeforeUnmount, ref } from "vue";
import { ChevronDown, ChevronRight } from "@lucide/vue";
import { formatActivitySummary, summarizeMessages } from "@cc-heart/open-chat-types";
import type { TranscriptMessage } from "@cc-heart/open-chat-types";
import { useMarkdownStreaming } from "../../composables/useMarkdownStreaming";
import { markdownThemeKey, type MarkdownTheme } from "./markdownTheme";
import ActivityEntryRow from "./ActivityEntryRow.vue";
import { buildActivityEntries, hasActivityDetail, type ActivityEntry } from "./activityEntry";

interface Props {
  messages: TranscriptMessage[];
  streaming: boolean;
  /** 思考是否已完成（streaming 中 false 时显示"正在思考"）。 */
  reasoningDone?: boolean;
  summaryExpanded: boolean;
  itemExpandedIds: string[];
  /** 思考阶段的耗时（用于"思考用时 Xs"）。 */
  reasoningDurationMs?: number;
}

interface Emits {
  (e: "update:summaryExpanded", expanded: boolean): void;
  (e: "update:itemExpandedIds", ids: string[]): void;
}

const props = withDefaults(defineProps<Props>(), {
  reasoningDone: true,
  summaryExpanded: false,
  itemExpandedIds: () => [],
  reasoningDurationMs: undefined,
});
const emit = defineEmits<Emits>();

const theme = inject(
  markdownThemeKey,
  computed<MarkdownTheme>(() => "dark"),
);

/** 活动条目：由消息派生（见 activityEntry.buildActivityEntries）。 */
const entries = computed<ActivityEntry[]>(() =>
  buildActivityEntries(props.messages, {
    streaming: props.streaming,
    reasoningDone: props.reasoningDone,
    reasoningDurationMs: props.reasoningDurationMs,
  }),
);

/** 最后一条思考条目的内容（流式中只有它会持续增长）。 */
const lastReasoningId = computed(() => {
  const reasoning = entries.value.filter((entry) => entry.kind === "reasoning");
  return reasoning.at(-1)?.id ?? "";
});
const streamingReasoningContent = computed(() => {
  const reasoning = entries.value.filter((entry) => entry.kind === "reasoning");
  return reasoning.at(-1)?.content ?? "";
});
const reasoningRunning = computed(() => props.streaming && props.reasoningDone !== true);
// 长思考内容流式渲染节流：x-markdown 每次 content 更新都会对累计全文做完整
// 重解析/重建（marked → DOMPurify → DOM → VNode），超长文本会平方级放大
// CPU 与内存（实测 400KB≈52s、1MB 直接 OOM），这里限制为步进渲染。
const { content: reasoningDisplayContent, streaming: reasoningStreaming } = useMarkdownStreaming(
  streamingReasoningContent,
  reasoningRunning,
);

/** 活动摘要："正在执行：N 次命令，M 次思考" / "已执行：…"。 */
const summary = computed(() => summarizeMessages(props.messages));
const anyRunning = computed(() => entries.value.some((entry) => entry.status === "running"));
const summaryLabel = computed(() =>
  formatActivitySummary(summary.value, { running: anyRunning.value }),
);

const isItemExpanded = (id: string) => props.itemExpandedIds.includes(id);

/** 本条思考要渲染的文本：最后一条为节流后的流式文本，其余为原文。 */
const reasoningContentOf = (entry: ActivityEntry): string =>
  entry.id === lastReasoningId.value ? reasoningDisplayContent.value : (entry.content ?? "");

/** 本条思考的流式标志：仅最后一条（流式中唯一增长的那条）走原生流式。 */
const reasoningStreamingOf = (entry: ActivityEntry) =>
  entry.id === lastReasoningId.value
    ? reasoningStreaming.value
    : { hasNextChunk: false, enableAnimation: false, tail: false };

const toggleSummary = () => emit("update:summaryExpanded", !props.summaryExpanded);

const toggleItem = (entry: ActivityEntry) => {
  if (!hasActivityDetail(entry)) return;
  const expanded = isItemExpanded(entry.id);
  const next = expanded
    ? props.itemExpandedIds.filter((id) => id !== entry.id)
    : [...props.itemExpandedIds, entry.id];
  emit("update:itemExpandedIds", next);
};

const copiedSection = ref("");
let copyTimer: ReturnType<typeof setTimeout> | undefined;
const copyEntry = (entry: ActivityEntry) => {
  const content =
    entry.sections?.map((section) => `${section.label}\n${section.content}`).join("\n\n") ?? "";
  if (!content) return;

  navigator.clipboard?.writeText(content).catch(() => {});
  copiedSection.value = entry.id;
  if (copyTimer) clearTimeout(copyTimer);
  copyTimer = setTimeout(() => {
    copiedSection.value = "";
  }, 2000);
};
onBeforeUnmount(() => {
  if (copyTimer) clearTimeout(copyTimer);
});
</script>

<template>
  <div v-if="entries.length" class="flex w-full min-w-0 flex-col gap-0.5">
    <!-- 摘要行：活动折叠开关 -->
    <button
      type="button"
      class="inline-flex h-[22px] w-fit items-center gap-1.5 rounded border-0 bg-transparent px-0.5 py-0 text-left text-[11px] leading-[14px] font-medium text-brand-muted-strong hover:text-brand-muted"
      @click="toggleSummary"
    >
      <span
        v-if="anyRunning"
        class="h-1.25 w-1.25 flex-none rounded-full bg-brand-accent animate-[activity-pulse_1.6s_ease-in-out_infinite]"
        aria-hidden="true"
      ></span>
      <span class="whitespace-nowrap">{{ summaryLabel }}</span>
      <ChevronRight v-if="!summaryExpanded" class="h-2.5 w-2.5 flex-none text-brand-ghost" />
      <ChevronDown v-else class="h-2.5 w-2.5 flex-none text-brand-ghost" />
    </button>

    <div v-if="summaryExpanded" class="flex w-full min-w-0 flex-col pl-[15px]">
      <ActivityEntryRow
        v-for="entry in entries"
        :key="entry.id"
        :entry="entry"
        :expanded="isItemExpanded(entry.id)"
        :streaming="streaming"
        :reasoning-content="reasoningContentOf(entry)"
        :reasoning-live="entry.id === lastReasoningId"
        :reasoning-streaming="reasoningStreamingOf(entry)"
        :theme="theme"
        :copied-section="copiedSection"
        @toggle="toggleItem(entry)"
        @copy="copyEntry(entry)"
      />
    </div>
  </div>
</template>

<style scoped>
@keyframes activity-pulse {
  0%,
  100% {
    opacity: 0.3;
  }
  50% {
    opacity: 1;
  }
}
</style>

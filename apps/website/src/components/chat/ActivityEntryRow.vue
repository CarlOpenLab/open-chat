<script setup lang="ts">
import type { Component } from "vue";
import { computed } from "vue";
import { Check, Copy, Pencil, X } from "@lucide/vue";
import { XMarkdown } from "@antdv-next/x-markdown";
import { isMarkdownPlainText } from "../../composables/markdownRenderLimits";
import MarkdownCodeRenderer from "./MarkdownCodeRenderer.vue";
import UnifiedDiff from "./UnifiedDiff.vue";
import type { MarkdownTheme } from "./markdownTheme";
import { hasActivityDetail, type ActivityEntry } from "./activityEntry";

interface Props {
  /** 本行渲染的条目（由活动消息派生）。 */
  entry: ActivityEntry;
  /** 是否展开详情。 */
  expanded: boolean;
  /** 会话是否仍在流式输出（用于思考纯文本降级判定）。 */
  streaming: boolean;
  /** 本条要渲染的思考文本：最后一条为节流后的流式文本，其余为原文。 */
  reasoningContent: string;
  /** 本条是否为当前仍在增长的思考条目（决定原生流式与纯文本降级）。 */
  reasoningLive: boolean;
  /** 交给 XMarkdown 的流式标志（仅 reasoningLive 时由父层下传真实值）。 */
  reasoningStreaming: { hasNextChunk: boolean; enableAnimation: boolean; tail?: boolean };
  /** markdown 渲染主题（同时传给 diff 高亮）。 */
  theme: MarkdownTheme;
  /** 当前已触发复制反馈的条目 id（与本条目相同则显示「已复制」）。 */
  copiedSection: string;
}

interface Emits {
  (e: "toggle"): void;
  (e: "copy"): void;
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

const markdownComponents: Record<string, Component> = { code: MarkdownCodeRenderer };
const markdownClassName = computed(() => `chat-markdown x-markdown-${props.theme}`);

/** 有详情才可点击展开（无详情行保持默认光标且点击无响应）。 */
const hasDetail = computed(() => hasActivityDetail(props.entry));
const detailVisible = computed(
  () =>
    props.expanded &&
    Boolean(
      (props.entry.kind === "reasoning" && props.entry.content) ||
      props.entry.fileChanges?.length ||
      props.entry.sections?.length,
    ),
);

/**
 * 思考内容是否走纯文本：规则同 markdownRenderLimits.isMarkdownPlainText，
 * 只对「最后一条思考」（流式中唯一持续增长的那条）套用流式降级，
 * 历史思考按最终长度判定。
 */
const isReasoningPlainText = computed(() =>
  isMarkdownPlainText(props.reasoningContent, props.reasoningLive && props.streaming),
);
</script>

<template>
  <div class="flex min-w-0 flex-col" @click="emit('toggle')">
    <!-- 标题行：与展开内容上下布局，互不居中 -->
    <div
      class="my-4px group flex min-h-6 items-center rounded-[6px] px-1.5 py-[3px] text-[11.5px] leading-[14px] w-full"
      :class="
        hasDetail
          ? 'cursor-pointer hover:bg-[color-mix(in_srgb,var(--brand-foreground)_6%,transparent)] active:bg-[color-mix(in_srgb,var(--brand-foreground)_9%,transparent)]'
          : 'cursor-default'
      "
    >
      <div class="flex flex-1 min-w-0 items-center gap-2">
        <component
          v-if="entry.icon"
          :is="entry.icon"
          class="h-[11px] w-[11px] flex-none text-brand-muted-strong"
        />
        <span
          class="min-w-0 max-w-[300px] flex-[0_1_auto] overflow-hidden truncate text-brand-muted"
          >{{ entry.title }}</span
        >
        <span
          v-if="entry.fileStats?.additions"
          class="flex-none font-mono text-[10.5px] text-brand-success"
          >+{{ entry.fileStats.additions }}</span
        >
        <span
          v-if="entry.fileStats?.deletions"
          class="flex-none font-mono text-[10.5px] text-brand-danger"
          >-{{ entry.fileStats.deletions }}</span
        >
      </div>
      <span class="inline-flex flex-none items-center" aria-hidden="true">
        <X v-if="entry.status === 'error'" class="h-2.5 w-2.5 text-brand-danger" />
        <Check v-else-if="entry.status === 'success'" class="h-2.5 w-2.5 text-brand-success" />
        <span
          v-else-if="entry.status === 'running'"
          class="h-1.25 w-1.25 rounded-full bg-brand-accent animate-[activity-pulse_1.6s_ease-in-out_infinite]"
        ></span>
        <span v-else class="h-1.25 w-1.25 rounded-full bg-brand-ghost opacity-45"></span>
      </span>
    </div>

    <Transition name="activity-collapse">
      <div v-if="detailVisible" class="activity-collapse-shell" @click.stop>
        <div class="activity-collapse-content">
          <!-- 思考展开：弱化 markdown（位于行下方）；超长思考用纯文本 -->
          <div
            v-if="entry.kind === 'reasoning' && entry.content"
            class="box-border w-full min-w-0 max-w-full overflow-hidden px-1"
          >
            <pre
              v-if="isReasoningPlainText"
              class="m-0 w-full max-w-full whitespace-pre-wrap break-words text-[12px] leading-[1.6] text-brand-muted-strong"
              >{{ reasoningContent }}</pre>
            <XMarkdown
              v-else
              :content="reasoningContent"
              :components="markdownComponents"
              :streaming="reasoningStreaming"
              :class-name="[markdownClassName, 'activity-reasoning-markdown'].join(' ')"
              :config="{ breaks: true }"
              open-links-in-new-tab
            />
          </div>

          <!-- 工具展开：inset 详情卡片（位于行下方） -->
          <div
            v-else
            class="my-0.5 mb-1 flex w-full min-w-0 flex-col gap-2 overflow-hidden rounded-[7px] border border-solid border-brand-border bg-brand-surface p-2 font-mono text-[10.5px] leading-4 text-brand-muted"
          >
            <div v-if="entry.fileChanges?.length" class="flex flex-col gap-1">
              <div class="flex min-h-5 items-center text-[10.5px] font-medium text-brand-muted">
                变更文件
              </div>
              <div
                v-for="change in entry.fileChanges"
                :key="change.path"
                class="file-change block min-w-0 rounded-[4px] bg-transparent"
              >
                <div class="flex min-w-0 items-center gap-2 px-1 py-0.5">
                  <Pencil class="h-3 w-3 flex-none text-brand-muted-strong" />
                  <span
                    class="min-w-0 flex-1 truncate font-sans text-[11px] text-brand-muted-strong"
                  >
                    {{ change.path }}
                  </span>
                  <span v-if="change.additions" class="flex-none text-brand-success"
                    >+{{ change.additions }}</span
                  >
                  <span v-if="change.deletions" class="flex-none text-brand-danger"
                    >-{{ change.deletions }}</span
                  >
                </div>
                <!-- 路径下方：统一 diff（由 X CodeHighlighter 以 diff 语言高亮） -->
                <div
                  v-if="change.patch"
                  class="file-change-diff mt-1 min-w-0 overflow-hidden rounded-[6px]"
                >
                  <UnifiedDiff :patch="change.patch" :path="change.path" :theme="theme" />
                </div>
              </div>
            </div>
            <div
              v-for="(section, index) in entry.sections"
              :key="index"
              class="relative flex w-full min-w-0 flex-col gap-0.75"
            >
              <div class="flex min-h-5 items-start pr-6">
                <span class="text-[10.5px] font-medium text-brand-muted">
                  {{ section.label }}
                </span>
                <button
                  v-if="section.copyable"
                  type="button"
                  class="absolute -top-0.5 -right-0.5 grid h-[22px] w-[22px] place-items-center rounded-[5px] border-0 bg-transparent p-0 hover:bg-[color-mix(in_srgb,var(--brand-foreground)_9%,transparent)]"
                  :title="copiedSection === entry.id ? '已复制' : '复制全部内容'"
                  @click="emit('copy')"
                >
                  <Check
                    v-if="copiedSection === entry.id"
                    class="h-[11px] w-[11px] text-brand-ghost"
                  />
                  <Copy v-else class="h-[11px] w-[11px] text-brand-ghost" />
                </button>
              </div>
              <pre
                class="m-0 w-full min-w-0 whitespace-pre-wrap break-words font-inherit text-brand-muted"
                >{{ section.content }}</pre>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
/* 与 ActivityList 摘要点的脉冲动画同名：scoped 编译会按文件加哈希后缀，故此处独立定义。 */
@keyframes activity-pulse {
  0%,
  100% {
    opacity: 0.3;
  }
  50% {
    opacity: 1;
  }
}

:deep(.chat-markdown a) {
  color: var(--brand-accent);
}

:deep(.activity-reasoning-markdown) {
  width: 100%;
  max-width: 100%;
  --text-color: var(--brand-muted-strong);
  --heading-color: var(--brand-muted-strong);
  --line-color: color-mix(in srgb, var(--brand-muted-strong) 30%, transparent);
  color: var(--brand-muted-strong);
  font-size: 12px;
  white-space: normal;
  padding: 4px 0 16px 8px;
}
:deep(.activity-reasoning-markdown p),
:deep(.activity-reasoning-markdown li) {
  color: var(--brand-muted-strong);
  white-space: normal;
}
:deep(.activity-reasoning-markdown h1),
:deep(.activity-reasoning-markdown h2),
:deep(.activity-reasoning-markdown h3),
:deep(.activity-reasoning-markdown h4) {
  color: var(--brand-muted-strong);
  font-size: 14px;
  line-height: 20px;
}
:deep(.activity-reasoning-markdown a),
:deep(.activity-reasoning-markdown code:not(pre code)) {
  color: var(--brand-muted);
}

.activity-collapse-shell {
  display: grid;
  grid-template-rows: 1fr;
  min-height: 0;
  opacity: 1;
  transition:
    grid-template-rows 180ms cubic-bezier(0.2, 0, 0, 1),
    opacity 140ms ease;
}
.activity-collapse-content {
  min-height: 0;
  overflow: hidden;
}
.activity-collapse-enter-from,
.activity-collapse-leave-to {
  grid-template-rows: 0fr;
  opacity: 0;
}
.activity-collapse-enter-to,
.activity-collapse-leave-from {
  grid-template-rows: 1fr;
  opacity: 1;
}
</style>

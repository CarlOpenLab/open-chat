<script setup lang="ts">
import type { BubbleItemType, ThoughtChainItemType } from "@antdv-next/x";
import { Sources, Think, ThoughtChain } from "@antdv-next/x";
import { XMarkdown } from "@antdv-next/x-markdown";
import { Globe2, TriangleAlert } from "@lucide/vue";
import { computed, ref, type Component } from "vue";
import type { WebSearchSourceItem } from "../../services/ai";
import type { A2UIActionPayload, A2UISubmission } from "../../utils/a2ui";
import A2UIRenderer from "./A2UIRenderer.vue";
import MarkdownCodeRenderer from "./MarkdownCodeRenderer.vue";

interface Props {
  item: BubbleItemType;
  content: string;
  markdownClassName: string;
  streaming: boolean;
  thinkExpanded: boolean;
  a2uiActionPending: boolean;
  submissions: A2UISubmission[];
  searchResults: WebSearchSourceItem[];
}

interface Emits {
  (e: "a2uiAction", payload: A2UIActionPayload): void;
  (e: "update:thinkExpanded", expanded: boolean): void;
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

const markdownComponents: Record<string, Component> = {
  code: MarkdownCodeRenderer,
};

const markdownStreaming = computed(() => ({
  hasNextChunk: props.streaming,
  enableAnimation: false,
}));

const workspaceThoughtItems = computed<ThoughtChainItemType[]>(() => {
  const parsed = props.item.extraInfo?.parsedWorkspace;
  if (!parsed?.hasWorkspaceBlock) return [];

  const streaming = props.streaming;
  const fileItems = parsed.files.map((file: { path: string; status: string }) => ({
    key: `file-${file.path}`,
    title: file.status === "streaming" && streaming ? `正在生成 ${file.path}` : file.path,
    description: file.status === "streaming" && streaming ? "写入中" : "已生成",
    status: file.status === "streaming" && streaming ? ("loading" as const) : ("success" as const),
    collapsible: false,
  }));
  const errorItems = streaming
    ? []
    : parsed.errors.map((error: string, index: number) => ({
        key: `workspace-error-${index}`,
        title: "文件生成异常",
        description: error,
        status: "error" as const,
        collapsible: false,
      }));

  if (fileItems.length || errorItems.length) return [...fileItems, ...errorItems];
  return [
    {
      key: "workspace-preparing",
      title: streaming ? "正在准备文件" : "文件生成未完成",
      status: streaming ? "loading" : "error",
      collapsible: false,
    },
  ];
});

const handleSourceClick = (item: WebSearchSourceItem) => {
  if (item.url) window.open(item.url, "_blank", "noopener,noreferrer");
};

const agentPlanItems = computed<ThoughtChainItemType[]>(() => {
  const plan = props.item.extraInfo?.agentPlan as
    | { entries?: Array<{ content?: string; status?: string }> }
    | undefined;
  if (!Array.isArray(plan?.entries)) return [];
  return plan.entries.map((entry, index) => ({
    key: `agent-plan-${index}`,
    title: entry.content || `步骤 ${index + 1}`,
    status:
      entry.status === "completed"
        ? ("success" as const)
        : entry.status === "in_progress"
          ? ("loading" as const)
          : ("pending" as const),
    description:
      entry.status === "completed"
        ? "已完成"
        : entry.status === "in_progress"
          ? "进行中"
          : "等待中",
    collapsible: false,
  }));
});

const chatNoticesList = computed<string[]>(() => {
  const notices = props.item.extraInfo?.chatNotices;
  return Array.isArray(notices) ? (notices as string[]) : [];
});

const chatErrorMessage = computed<string>(() => {
  const error = props.item.extraInfo?.chatError;
  return typeof error === "string" ? error : "";
});

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
  if (failedFavicons.value.has(url)) return;
  const next = new Set(failedFavicons.value);
  next.add(url);
  failedFavicons.value = next;
};
</script>

<template>
  <div class="flex w-full min-w-0 max-w-full flex-col gap-3">
    <div
      v-if="chatNoticesList.length"
      class="flex flex-col gap-1 rounded-lg border border-amber-300/50 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-700 dark:border-amber-500/30 dark:bg-amber-950/40 dark:text-amber-300"
    >
      <span v-for="notice in chatNoticesList" :key="notice" class="inline-flex items-start gap-1.5">
        <TriangleAlert class="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>{{ notice }}</span>
      </span>
    </div>
    <template v-if="item.extraInfo?.parsedThink">
      <Think
        v-if="item.extraInfo.parsedThink.thinkContent"
        :title="item.extraInfo.parsedThink.thinkDone ? '思考过程' : '思考中...'"
        :loading="!item.extraInfo.parsedThink.thinkDone"
        :expanded="thinkExpanded"
        :blink="!item.extraInfo.parsedThink.thinkDone"
        @update:expanded="emit('update:thinkExpanded', $event)"
      >
        <XMarkdown
          :content="item.extraInfo.parsedThink.thinkContent"
          :components="markdownComponents"
          :streaming="markdownStreaming"
          :class-name="markdownClassName"
          escape-raw-html
          open-links-in-new-tab
        />
      </Think>
    </template>
    <ThoughtChain
      v-if="agentPlanItems.length"
      class="agent-plan-thought-chain"
      :items="agentPlanItems"
      line="solid"
    />
    <XMarkdown
      v-if="item.extraInfo?.parsedThink"
      :content="item.extraInfo.parsedThink.answerContent"
      :components="markdownComponents"
      :streaming="markdownStreaming"
      :class-name="markdownClassName"
      escape-raw-html
      open-links-in-new-tab
    />
    <XMarkdown
      v-else-if="content.trim()"
      :content="content"
      :components="markdownComponents"
      :streaming="markdownStreaming"
      :class-name="markdownClassName"
      escape-raw-html
      open-links-in-new-tab
    />
    <div
      v-if="chatErrorMessage"
      class="rounded-lg border border-red-300/60 bg-red-50 px-3 py-2 text-xs leading-relaxed text-red-700 dark:border-red-500/30 dark:bg-red-950/40 dark:text-red-300"
    >
      <span class="inline-flex items-start gap-1.5">
        <TriangleAlert class="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>请求失败：{{ chatErrorMessage }}</span>
      </span>
    </div>
    <ThoughtChain
      v-if="item.extraInfo?.parsedWorkspace?.hasWorkspaceBlock"
      class="workspace-thought-chain"
      :items="workspaceThoughtItems"
      line="solid"
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
      :action-pending="a2uiActionPending"
      :owner-message-id="String(item.key)"
      :submissions="submissions"
      @action="emit('a2uiAction', $event)"
    />
    <Sources
      v-if="searchResults.length"
      class="assistant-sources w-full"
      :items="searchResults"
      title="来源"
      :on-click="handleSourceClick"
    >
      <template #title="{ originNode }">
        <span class="inline-flex items-center gap-1.5">
          <Globe2 class="!h-3.5 !w-3.5 shrink-0 text-brand-primary" />{{ originNode }}
        </span>
      </template>
      <template #iconRender="{ item: sourceItem }">
        <img
          v-if="sourceItem.url && !failedFavicons.has(sourceItem.url)"
          class="block h-4 w-4 shrink-0 rounded-[3px] object-contain"
          :src="getFaviconUrl(sourceItem.url)"
          :alt="String(sourceItem.title)"
          loading="lazy"
          @error="onFaviconError(sourceItem.url)"
        />
        <Globe2 v-else class="!h-4 !w-4 shrink-0 text-brand-muted" />
      </template>
    </Sources>
  </div>
</template>

<style scoped>
/* 保留：:deep() 覆盖 antdx Sources 组件内部类（含 -webkit-line-clamp hack），无法用工具类表达 */
.assistant-sources :deep(.antdx-sources-title) {
  font-size: 12px;
}
.assistant-sources :deep(.antdx-sources-list-item) {
  padding-block: 4px;
}
.assistant-sources :deep(.antdx-sources-link) {
  gap: 8px;
}
.assistant-sources :deep(.antdx-sources-link-title) {
  font-size: 12px;
  min-width: 0;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.assistant-sources :deep(.antdx-sources-link-description) {
  display: none;
}
</style>

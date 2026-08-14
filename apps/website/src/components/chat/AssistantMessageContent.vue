<script setup lang="ts">
import type { BubbleItemType, ThoughtChainItemType } from "@antdv-next/x";
import { Sources, Think, ThoughtChain } from "@antdv-next/x";
import { XMarkdown } from "@antdv-next/x-markdown";
import { Globe2, TriangleAlert } from "@lucide/vue";
import { computed, ref, type Component } from "vue";
import type { WebSearchSourceItem } from "../../services/ai";
import { WEB_SEARCHING_MARKER, type ToolCallItem } from "../../services/OpenChatProvider";
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
  enableAnimation: true,
  tail: false,
}));

const parsedThink = computed(() => props.item.extraInfo?.parsedThink);
const answerContent = computed(() => parsedThink.value?.answerContent || props.content);
const reasoningContent = computed(
  () =>
    (typeof props.item.extraInfo?.reasoningContent === "string"
      ? props.item.extraInfo.reasoningContent
      : "") ||
    parsedThink.value?.thinkContent ||
    "",
);
const reasoningDone = computed(() => {
  if (typeof props.item.extraInfo?.reasoningDone === "boolean") {
    return props.item.extraInfo.reasoningDone;
  }
  return parsedThink.value ? parsedThink.value.thinkDone : !props.streaming;
});
const reasoningStreaming = computed(() => props.streaming && !reasoningDone.value);
const reasoningMarkdownStreaming = computed(() => ({
  hasNextChunk: reasoningStreaming.value,
  enableAnimation: true,
  tail: false,
}));

const toolCalls = computed<ToolCallItem[]>(() => {
  const value = props.item.extraInfo?.toolCalls;
  return Array.isArray(value) ? (value as ToolCallItem[]) : [];
});

const formatDetail = (value: unknown, maxLength = 2400): string => {
  const text =
    typeof value === "string"
      ? value
      : typeof value === "object" && value !== null
        ? JSON.stringify(value, null, 2)
        : String(value ?? "");
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
};

const toolStatus = (tool: ToolCallItem): ThoughtChainItemType["status"] => {
  if (tool.status === "completed") return "success";
  if (tool.status === "error") return "error";
  return "loading";
};

const toolItems = computed<ThoughtChainItemType[]>(() =>
  toolCalls.value.map((tool) => {
    const details = [
      tool.input === undefined ? "" : `输入\n\n${formatDetail(tool.input)}`,
      tool.output ? `输出\n\n${formatDetail(tool.output)}` : "",
      tool.error ? `错误\n\n${tool.error}` : "",
    ].filter(Boolean);
    const status = toolStatus(tool);
    return {
      key: `tool-${tool.id || tool.name}`,
      title: tool.name || "工具调用",
      description:
        tool.status === "completed"
          ? tool.durationMs
            ? `已完成 · ${(tool.durationMs / 1000).toFixed(1)}s`
            : "已完成"
          : tool.status === "error"
            ? "失败"
            : tool.status === "running"
              ? "执行中"
              : "等待执行",
      status,
      blink: status === "loading",
      collapsible: details.length > 0,
      content: details.join("\n\n"),
    };
  }),
);

const planItems = computed<ThoughtChainItemType[]>(() => {
  const plan = props.item.extraInfo?.agentPlan as
    | { entries?: Array<{ content?: string; status?: string }> }
    | undefined;
  if (!Array.isArray(plan?.entries)) return [];
  return plan.entries.map((entry, index) => ({
    key: `plan-${index}`,
    title: entry.content || `步骤 ${index + 1}`,
    description:
      entry.status === "completed"
        ? "已完成"
        : entry.status === "in_progress"
          ? "进行中"
          : "等待中",
    status:
      entry.status === "completed"
        ? "success"
        : entry.status === "in_progress"
          ? "loading"
          : undefined,
    blink: entry.status === "in_progress",
  }));
});

const workspaceItems = computed<ThoughtChainItemType[]>(() => {
  const parsed = props.item.extraInfo?.parsedWorkspace;
  if (!parsed?.hasWorkspaceBlock) return [];
  const files = parsed.files.map((file: { path: string; status: string }) => ({
    key: `file-${file.path}`,
    title: file.path,
    description: file.status === "streaming" && props.streaming ? "写入中" : "已生成",
    status: file.status === "streaming" && props.streaming ? "loading" : "success",
    blink: file.status === "streaming" && props.streaming,
  }));
  const errors = parsed.errors.map((error: string, index: number) => ({
    key: `workspace-error-${index}`,
    title: "文件生成异常",
    description: error,
    status: "error" as const,
  }));
  return [...files, ...errors];
});

const operationItems = computed<ThoughtChainItemType[]>(() => [
  ...planItems.value,
  ...toolItems.value,
  ...workspaceItems.value,
]);
const streamingLabel = computed(() => {
  if (!props.streaming) return "";
  if (props.content === WEB_SEARCHING_MARKER) return "正在联网搜索";
  const running = operationItems.value.find((item) => item.status === "loading");
  if (running) return running.description || "正在执行任务";
  if (reasoningStreaming.value) return "正在思考";
  if (!answerContent.value.trim()) return "正在准备回答";
  return "";
});
const expandedOperationKeys = computed(() =>
  operationItems.value.filter((item) => item.status === "loading").map((item) => String(item.key)),
);

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

    <Think
      v-if="reasoningContent"
      :title="reasoningStreaming ? '正在思考' : '思考过程'"
      :loading="reasoningStreaming"
      :expanded="thinkExpanded || reasoningStreaming"
      :blink="reasoningStreaming"
      @update:expanded="emit('update:thinkExpanded', $event)"
    >
      <XMarkdown
        :content="reasoningContent"
        :components="markdownComponents"
        :streaming="reasoningMarkdownStreaming"
        :class-name="markdownClassName"
        escape-raw-html
        open-links-in-new-tab
      />
    </Think>

    <div
      v-if="streamingLabel"
      class="streaming-status inline-flex items-center gap-2 text-xs text-brand-muted"
      role="status"
      aria-live="polite"
    >
      <span class="working-wave" aria-hidden="true"><i></i><i></i><i></i></span>
      <span>{{ streamingLabel }}</span>
    </div>

    <XMarkdown
      v-if="answerContent.trim()"
      :content="answerContent"
      :components="markdownComponents"
      :streaming="markdownStreaming"
      :class-name="markdownClassName"
      escape-raw-html
      open-links-in-new-tab
    />

    <ThoughtChain
      v-if="operationItems.length"
      :items="operationItems"
      line="solid"
      :default-expanded-keys="expandedOperationKeys"
    />

    <div v-if="chatError" class="inline-flex items-start gap-1.5 text-xs text-red-500">
      <TriangleAlert class="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>请求失败：{{ chatError }}</span>
    </div>

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
  </div>
</template>

<style scoped>
.streaming-status {
  min-height: 20px;
  animation: status-in 220ms ease-out both;
}

.working-wave {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  min-width: 18px;
}

.working-wave i {
  width: 4px;
  height: 4px;
  border-radius: 999px;
  background: currentColor;
  opacity: 0.3;
  animation: working-wave 1.2s ease-in-out infinite;
}

.working-wave i:nth-child(2) {
  animation-delay: 140ms;
}

.working-wave i:nth-child(3) {
  animation-delay: 280ms;
}

@keyframes working-wave {
  0%,
  60%,
  100% {
    opacity: 0.3;
    transform: translateY(0);
  }
  30% {
    opacity: 1;
    transform: translateY(-2px);
  }
}

@keyframes status-in {
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

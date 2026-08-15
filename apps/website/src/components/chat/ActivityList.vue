<script setup lang="ts">
import type { Component } from "vue";
import { computed, inject, onBeforeUnmount, ref } from "vue";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  ListTodo,
  Pencil,
  Sparkles,
  Wrench,
  X,
} from "@lucide/vue";
import { XMarkdown } from "@antdv-next/x-markdown";
import type { ToolCallItem } from "../../services/OpenChatProvider";
import { markdownThemeKey, type MarkdownTheme } from "./markdownTheme";
import MarkdownCodeRenderer from "./MarkdownCodeRenderer.vue";
import { formatWorkedDuration } from "../../utils/chatDuration";

interface ReasoningInfo {
  content: string;
  done: boolean;
  durationMs?: number;
}

interface PlanInfo {
  entries?: Array<{ content?: string; status?: string }>;
}

interface WorkspaceInfo {
  files: Array<{ path: string; status: string }>;
  errors: string[];
}

interface Props {
  reasoning?: ReasoningInfo | null;
  tools?: ToolCallItem[];
  plan?: PlanInfo | null;
  workspace?: WorkspaceInfo | null;
  streaming: boolean;
  summaryExpanded: boolean;
  itemExpandedIds: string[];
}

interface Emits {
  (e: "update:summaryExpanded", expanded: boolean): void;
  (e: "update:itemExpandedIds", ids: string[]): void;
}

const props = withDefaults(defineProps<Props>(), {
  reasoning: null,
  tools: () => [],
  plan: null,
  workspace: null,
  summaryExpanded: false,
  itemExpandedIds: () => [],
});
const emit = defineEmits<Emits>();

const theme = inject(
  markdownThemeKey,
  computed<MarkdownTheme>(() => "dark"),
);
const markdownComponents: Record<string, Component> = { code: MarkdownCodeRenderer };
const markdownClassName = computed(
  () => `activity-reasoning-markdown chat-markdown x-markdown-${theme.value}`,
);

const formatToolDetail = (value: unknown, maxLength = 4000): string => {
  let text = "";
  if (typeof value === "string") {
    text = value;
  } else if (typeof value === "object" && value !== null) {
    try {
      text = JSON.stringify(value, null, 2);
    } catch {
      text = String(value);
    }
  } else {
    text = String(value ?? "");
  }
  return text.length > maxLength ? `${text.slice(0, maxLength)}…（内容过长已截断）` : text;
};

interface ActivityEntry {
  id: string;
  kind: "reasoning" | "tool" | "plan" | "workspace";
  icon: Component;
  title: string;
  preview: string;
  status: "running" | "success" | "error" | "pending";
  content?: string;
  sections?: Array<{ label: string; content: string; copyable?: boolean }>;
}

const reasoningLive = computed(
  () => props.streaming && Boolean(props.reasoning) && !props.reasoning!.done,
);

const entries = computed<ActivityEntry[]>(() => {
  const list: ActivityEntry[] = [];

  if (props.reasoning?.content.trim()) {
    list.push({
      id: "reasoning",
      kind: "reasoning",
      icon: Sparkles,
      title: reasoningLive.value
        ? "正在思考"
        : props.reasoning.durationMs
          ? `思考用时 ${formatWorkedDuration(props.reasoning.durationMs)}`
          : "思考过程",
      preview: "",
      status: reasoningLive.value ? "running" : "success",
      content: props.reasoning.content,
    });
  }

  for (const tool of props.tools) {
    const sections: Array<{ label: string; content: string; copyable?: boolean }> = [];
    if (tool.input !== undefined) {
      // 复制入口挂在第一段参数标题上，但复制内容包含整个工具详情。
      sections.push({ label: "参数", content: formatToolDetail(tool.input, 2000), copyable: true });
    }
    const output = [tool.output, tool.error]
      .filter((value): value is string => Boolean(value))
      .map((value) => formatToolDetail(value))
      .join("\n\n");
    if (output) {
      sections.push({ label: "输出", content: output, copyable: tool.input === undefined });
    }
    const status: ActivityEntry["status"] =
      tool.status === "completed"
        ? "success"
        : tool.status === "error"
          ? "error"
          : tool.status === "running"
            ? "running"
            : "pending";
    const title =
      tool.status === "running"
        ? `正在运行 ${tool.name}`
        : tool.status === "completed"
          ? `已运行 ${tool.name}`
          : tool.status === "error"
            ? `${tool.name} 失败`
            : `等待运行 ${tool.name}`;
    const preview =
      tool.status === "error"
        ? firstPreviewLine(tool.error)
        : tool.status === "completed"
          ? firstPreviewLine(tool.output) ||
            (tool.durationMs ? `已完成 · ${(tool.durationMs / 1000).toFixed(1)}s` : "已完成")
          : "";
    list.push({
      id: `tool-${tool.id || tool.name}`,
      kind: "tool",
      icon: Wrench,
      title,
      preview,
      status,
      sections: sections.length ? sections : undefined,
    });
  }

  for (const [index, entry] of (props.plan?.entries ?? []).entries()) {
    const status: ActivityEntry["status"] =
      entry.status === "completed"
        ? "success"
        : entry.status === "in_progress"
          ? "running"
          : "pending";
    list.push({
      id: `plan-${index}`,
      kind: "plan",
      icon: ListTodo,
      title: entry.content || `步骤 ${index + 1}`,
      preview:
        entry.status === "completed"
          ? "已完成"
          : entry.status === "in_progress"
            ? "进行中"
            : "等待中",
      status,
    });
  }

  if (props.workspace) {
    for (const file of props.workspace.files) {
      const writing = file.status === "streaming" && props.streaming;
      list.push({
        id: `file-${file.path}`,
        kind: "workspace",
        icon: Pencil,
        title: writing ? `正在写入 ${file.path}` : `已生成 ${file.path}`,
        preview: writing ? "写入中" : "已生成",
        status: writing ? "running" : "success",
      });
    }
    for (const [index, error] of props.workspace.errors.entries()) {
      list.push({
        id: `workspace-error-${index}`,
        kind: "workspace",
        icon: Pencil,
        title: "文件生成异常",
        preview: error,
        status: "error",
      });
    }
  }

  return list;
});

/** 活动摘要："正在执行：1 次思考 · 2 次工具调用" / "已执行：…"。 */
const summaryLabel = computed(() => {
  if (!entries.value.length) return "";
  const nouns: Record<ActivityEntry["kind"], string> = {
    reasoning: "思考",
    tool: "工具调用",
    plan: "计划步骤",
    workspace: "文件修改",
  };
  const counts = new Map<ActivityEntry["kind"], number>();
  for (const entry of entries.value) {
    counts.set(entry.kind, (counts.get(entry.kind) ?? 0) + 1);
  }
  const parts = [...counts.entries()].map(([kind, count]) => `${count} 次${nouns[kind]}`);
  const running = entries.value.some((entry) => entry.status === "running");
  return running ? `正在执行：${parts.join(" · ")}` : `已执行：${parts.join(" · ")}`;
});
const anyRunning = computed(() => entries.value.some((entry) => entry.status === "running"));

const hasDetail = (entry: ActivityEntry): boolean =>
  Boolean(entry.content) || Boolean(entry.sections?.length);
const isItemExpanded = (id: string) => props.itemExpandedIds.includes(id);

const toggleSummary = () => emit("update:summaryExpanded", !props.summaryExpanded);

const toggleItem = (entry: ActivityEntry) => {
  if (!hasDetail(entry)) return;
  const expanded = isItemExpanded(entry.id);
  const next = expanded
    ? props.itemExpandedIds.filter((id) => id !== entry.id)
    : [...props.itemExpandedIds, entry.id];
  emit("update:itemExpandedIds", next);
};

/**
 * 工具输出/错误预览：
 * - JSON 对象（如 bash 的 { stdout, stderr, exitCode }）取第一个有内容的字符串首行，避免预览显示裸 `{`；
 * - 普通文本取第一个非空且非纯 JSON 标点的行；
 * - 过长截断，避免把整段输出塞进标题行。
 */
const firstPreviewLine = (text?: string, max = 120): string => {
  if (!text) return "";
  const takeLine = (value: string) => {
    const line =
      value
        .split("\n")
        .map((l) => l.trim())
        .find((l) => l && !/^[\s{}[\]",:'`\\=_*#-]+$/.test(l)) ?? "";
    return line.length > max ? `${line.slice(0, max)}…` : line;
  };
  try {
    const parsed = JSON.parse(text) as unknown;
    const findFirstString = (value: unknown): string => {
      if (typeof value === "string" && value.trim()) return value;
      if (Array.isArray(value)) {
        for (const item of value) {
          const found = findFirstString(item);
          if (found) return found;
        }
      } else if (value && typeof value === "object") {
        for (const item of Object.values(value as Record<string, unknown>)) {
          const found = findFirstString(item);
          if (found) return found;
        }
      }
      return "";
    };
    const extracted = findFirstString(parsed);
    if (extracted) return takeLine(extracted);
  } catch {
    // 非 JSON 内容，走普通首行逻辑。
  }
  return takeLine(text);
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
      <div
        v-for="entry in entries"
        :key="entry.id"
        class="flex min-w-0 flex-col"
        @click="toggleItem(entry)"
      >
        <!-- 标题行：与展开内容上下布局，互不居中 -->
        <div
          class="group flex min-h-6 items-center gap-2 rounded-[6px] px-1.5 py-[3px] text-[11.5px] leading-[14px] w-full"
          :class="
            hasDetail(entry)
              ? 'cursor-pointer hover:bg-[color-mix(in_srgb,var(--brand-foreground)_6%,transparent)] active:bg-[color-mix(in_srgb,var(--brand-foreground)_9%,transparent)]'
              : 'cursor-default'
          "
        >
          <component :is="entry.icon" class="h-[11px] w-[11px] flex-none text-brand-muted-strong" />
          <span
            class="min-w-0 max-w-[300px] flex-[0_1_auto] overflow-hidden truncate text-brand-muted"
            >{{ entry.title }}</span
          >
          <span
            v-if="!isItemExpanded(entry.id) && entry.preview"
            class="min-w-0 flex-1 overflow-hidden truncate text-[11px] text-brand-ghost"
            >{{ entry.preview }}</span
          >
          <span class="inline-flex flex-none items-center" aria-hidden="true">
            <X v-if="entry.status === 'error'" class="h-2.5 w-2.5 text-brand-danger" />
            <Check v-else-if="entry.status === 'success'" class="h-2.5 w-2.5 text-brand-ghost" />
            <span
              v-else-if="entry.status === 'running'"
              class="h-1.25 w-1.25 rounded-full bg-brand-accent animate-[activity-pulse_1.6s_ease-in-out_infinite]"
            ></span>
            <span v-else class="h-1.25 w-1.25 rounded-full bg-brand-ghost opacity-45"></span>
          </span>
        </div>

        <!-- 思考展开：弱化 markdown（位于行下方） -->
        <div
          v-if="isItemExpanded(entry.id) && entry.kind === 'reasoning' && entry.content"
          class="box-border w-full min-w-0 max-w-full overflow-hidden px-1"
          @click.stop
        >
          <XMarkdown
            :content="entry.content"
            :components="markdownComponents"
            :streaming="{
              hasNextChunk: reasoningLive,
              enableAnimation: reasoningLive,
              tail: false,
            }"
            :class-name="markdownClassName"
            :config="{ breaks: true }"
            open-links-in-new-tab
          />
        </div>

        <!-- 工具展开：inset 详情卡片（位于行下方） -->

        <div
          v-else-if="isItemExpanded(entry.id) && entry.sections?.length"
          class="my-0.5 mb-1 flex w-full min-w-0 flex-col gap-2 overflow-hidden rounded-[7px] border border-solid border-brand-border bg-brand-surface p-2 font-mono text-[10.5px] leading-4 text-brand-muted"
          @click.stop
        >
          <div
            v-for="(section, index) in entry.sections"
            :key="index"
            class="relative flex w-full min-w-0 flex-col gap-0.75"
          >
            <div class="flex min-h-5 items-start pr-6">
              <span class="text-[10.5px] font-medium text-brand-muted">{{ section.label }}</span>
              <button
                v-if="section.copyable"
                type="button"
                class="absolute -top-0.5 -right-0.5 grid h-[22px] w-[22px] place-items-center rounded-[5px] border-0 bg-transparent p-0 hover:bg-[color-mix(in_srgb,var(--brand-foreground)_9%,transparent)]"
                :title="copiedSection === entry.id ? '已复制' : '复制全部内容'"
                @click="copyEntry(entry)"
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

:deep(.activity-reasoning-markdown) {
  width: 100%;
  max-width: 100%;
  --text-color: var(--brand-muted-strong);
  --heading-color: var(--brand-muted-strong);
  --line-color: color-mix(in srgb, var(--brand-muted-strong) 30%, transparent);
  color: var(--brand-muted-strong);
  font-size: 13px;
  white-space: normal;
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
</style>

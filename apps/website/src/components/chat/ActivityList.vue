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
import type { TranscriptTimelineItem } from "../../services/transcript";
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
  timeline?: TranscriptTimelineItem[];
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
  timeline: () => [],
});
const emit = defineEmits<Emits>();

const theme = inject(
  markdownThemeKey,
  computed<MarkdownTheme>(() => "dark"),
);
const markdownComponents: Record<string, Component> = { code: MarkdownCodeRenderer };
const markdownClassName = computed(() => `chat-markdown x-markdown-${theme.value}`);

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
  kind: "reasoning" | "tool" | "plan" | "workspace" | "content";
  icon: Component | null;
  title: string;
  preview: string;
  status: "running" | "success" | "error" | "pending";
  content?: string;
  sections?: Array<{ label: string; content: string; copyable?: boolean }>;
  fileChanges?: Array<{ path: string; additions?: number; deletions?: number }>;
  fileStats?: { additions: number; deletions: number };
}

/**
 * Activity ids come from several provider protocols. Reasoning chunks in
 * particular often reuse the same provider id after a tool call, so make the
 * ids unique at the UI boundary before they are used as Vue keys/state keys.
 */
const normalizeEntryIds = (items: ActivityEntry[]): ActivityEntry[] => {
  const used = new Set<string>();
  return items.map((entry, index) => {
    const base = entry.kind === "reasoning" ? "reasoning" : entry.id || `activity-${index}`;
    let id = base;
    let suffix = 1;
    while (used.has(id)) id = `${base}-${suffix++}`;
    used.add(id);
    return id === entry.id ? entry : { ...entry, id };
  });
};

const reasoningLive = computed(
  () => props.streaming && Boolean(props.reasoning) && !props.reasoning!.done,
);

const isFileChange = (tool: ToolCallItem): boolean =>
  tool.kind === "fileChange" || tool.name === "fileChange";

const fileName = (path: string): string => path.split(/[\\/]/).filter(Boolean).at(-1) || path;

const fileChangeStats = (tool: ToolCallItem): { additions: number; deletions: number } => {
  const changes = tool.fileChanges ?? [];
  const additions = changes.reduce((total, change) => total + (change.additions ?? 0), 0);
  const deletions = changes.reduce((total, change) => total + (change.deletions ?? 0), 0);
  return { additions, deletions };
};

const fileChangeSubject = (tool: ToolCallItem): string => {
  const changes = tool.fileChanges ?? [];
  if (changes.length === 1 && changes[0]) return fileName(changes[0].path);
  if (changes.length > 1) return `${changes.length} 个文件`;
  return tool.displayTarget ? fileName(tool.displayTarget) : "文件";
};

function toolActivityEntry(tool: ToolCallItem): ActivityEntry {
  const sections: Array<{ label: string; content: string; copyable?: boolean }> = [];
  if (tool.input !== undefined) {
    sections.push({ label: "参数", content: formatToolDetail(tool.input, 2000), copyable: true });
  }
  const output = [tool.output, tool.error]
    .filter((value): value is string => Boolean(value))
    .map((value) => formatToolDetail(value))
    .join("\n\n");
  if (output) sections.push({ label: "输出", content: output, copyable: tool.input === undefined });

  const status: ActivityEntry["status"] =
    tool.status === "completed"
      ? "success"
      : tool.status === "error"
        ? "error"
        : tool.status === "running"
          ? "running"
          : "pending";
  const fileChange = isFileChange(tool);
  const fileStats = fileChange ? fileChangeStats(tool) : undefined;
  const subject = fileChange ? fileChangeSubject(tool) : tool.name;
  const title = fileChange
    ? tool.status === "running"
      ? `正在编辑 ${subject}`
      : tool.status === "completed"
        ? `已编辑 ${subject}`
        : tool.status === "error"
          ? `编辑 ${subject} 失败`
          : `等待编辑 ${subject}`
    : tool.status === "running"
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
        ? fileChange
          ? firstPreviewLine(tool.output)
          : firstPreviewLine(tool.output) ||
            (tool.durationMs ? `已完成 · ${(tool.durationMs / 1000).toFixed(1)}s` : "已完成")
        : "";
  return {
    id: `tool-${tool.id || tool.name}`,
    kind: "tool",
    icon: fileChange ? Pencil : Wrench,
    title,
    preview,
    status,
    sections: sections.length ? sections : undefined,
    ...(fileChange && tool.fileChanges?.length ? { fileChanges: tool.fileChanges } : {}),
    ...(fileStats ? { fileStats } : {}),
  };
}

const entries = computed<ActivityEntry[]>(() => {
  const list: ActivityEntry[] = [];

  if (props.timeline.length) {
    for (const item of props.timeline) {
      if (item.kind === "content") {
        list.push({
          id: item.id,
          kind: "content",
          icon: null,
          title: "",
          preview: "",
          status: "success",
          content: item.content,
        });
      } else if (item.kind === "reasoning") {
        list.push({
          id: item.id,
          kind: "reasoning",
          icon: Sparkles,
          title: props.streaming ? "正在思考" : "思考过程",
          preview: "",
          status: props.streaming ? "running" : "success",
          content: item.content,
        });
      } else if (item.kind === "plan") {
        for (const [index, entry] of (item.plan.entries ?? []).entries()) {
          const status: ActivityEntry["status"] =
            entry.status === "completed"
              ? "success"
              : entry.status === "in_progress"
                ? "running"
                : "pending";
          list.push({
            id: `${item.id}-${index}`,
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
      } else {
        list.push(toolActivityEntry(item.activity));
      }
    }
    return normalizeEntryIds(list);
  }

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
    list.push(toolActivityEntry(tool));
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

  return normalizeEntryIds(list);
});

/** 活动摘要："正在执行：N 次命令，M 次思考" / "已执行：…"。 */
const summaryLabel = computed(() => {
  if (!entries.value.length) return "";
  let commands = 0;
  let reasoning = 0;
  let plans = 0;
  let files = 0;
  for (const entry of entries.value) {
    if (entry.kind === "reasoning") reasoning += 1;
    else if (entry.kind === "plan") plans += 1;
    else if (entry.kind === "workspace") files += 1;
    else if (entry.kind === "tool") {
      if (entry.fileChanges?.length || entry.fileStats) files += 1;
      else commands += 1;
    }
  }
  const parts: string[] = [];
  if (commands) parts.push(`${commands} 次命令`);
  if (reasoning) parts.push(`${reasoning} 次思考`);
  if (plans) parts.push(`${plans} 个计划`);
  if (files) parts.push(`${files} 次文件修改`);
  const running = entries.value.some((entry) => entry.status === "running");
  return running ? `正在执行：${parts.join("，")}` : `已执行：${parts.join("，")}`;
});
const anyRunning = computed(() => entries.value.some((entry) => entry.status === "running"));

const hasDetail = (entry: ActivityEntry): boolean =>
  Boolean(entry.content) || Boolean(entry.sections?.length) || Boolean(entry.fileChanges?.length);
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

    <div v-if="summaryExpanded || streaming" class="flex w-full min-w-0 flex-col pl-[15px]">
      <div
        v-for="entry in entries"
        :key="entry.id"
        class="flex min-w-0 flex-col"
        @click="toggleItem(entry)"
      >
        <XMarkdown
          v-if="entry.kind === 'content' && entry.content"
          :content="entry.content"
          :components="markdownComponents"
          :streaming="{ hasNextChunk: streaming, enableAnimation: streaming, tail: false }"
          :class-name="markdownClassName"
          :config="{ breaks: true }"
          open-links-in-new-tab
        />

        <!-- 标题行：与展开内容上下布局，互不居中 -->
        <div
          v-else
          class="my-4px group flex min-h-6 items-center rounded-[6px] px-1.5 py-[3px] text-[11.5px] leading-[14px] w-full"
          :class="
            hasDetail(entry)
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
            <span
              v-if="!isItemExpanded(entry.id) && entry.preview"
              class="min-w-0 flex-1 overflow-hidden truncate text-[11px] text-brand-ghost"
              >{{ entry.preview }}</span
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
          <div
            v-if="
              isItemExpanded(entry.id) &&
              ((entry.kind === 'reasoning' && entry.content) ||
                entry.fileChanges?.length ||
                entry.sections?.length)
            "
            class="activity-collapse-shell"
            @click.stop
          >
            <div class="activity-collapse-content">
              <!-- 思考展开：弱化 markdown（位于行下方） -->
              <div
                v-if="entry.kind === 'reasoning' && entry.content"
                class="box-border w-full min-w-0 max-w-full overflow-hidden px-1"
              >
                <XMarkdown
                  :content="entry.content"
                  :components="markdownComponents"
                  :streaming="{
                    hasNextChunk: reasoningLive,
                    enableAnimation: reasoningLive,
                    tail: false,
                  }"
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
                    class="flex min-w-0 items-center gap-2 rounded-[4px] px-1 py-0.5"
                  >
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
        </Transition>
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

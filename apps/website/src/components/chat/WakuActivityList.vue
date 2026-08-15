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
import { formatWorkedDuration } from "../../utils/wakuDuration";

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
  () => `waku-reasoning-markdown chat-markdown x-markdown-${theme.value}`,
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

/** Waku activity_summary："正在执行：1 次思考 · 2 次工具调用" / "已执行：…"。 */
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
  <div v-if="entries.length" class="waku-activity-list">
    <!-- 摘要行：Waku 的 activities 折叠开关 -->
    <button type="button" class="waku-summary" @click="toggleSummary">
      <span v-if="anyRunning" class="waku-pulse" aria-hidden="true"></span>
      <span class="waku-summary-text">{{ summaryLabel }}</span>
      <ChevronRight v-if="!summaryExpanded" class="waku-chevron" />
      <ChevronDown v-else class="waku-chevron" />
    </button>

    <div v-if="summaryExpanded" class="waku-items">
      <div
        v-for="entry in entries"
        :key="entry.id"
        class="waku-item"
        :class="{ expandable: hasDetail(entry), expanded: isItemExpanded(entry.id) }"
        @click="toggleItem(entry)"
      >
        <!-- 标题行：与展开内容上下布局，互不居中 -->
        <div class="waku-item-row">
          <component :is="entry.icon" class="waku-item-icon" />
          <span class="waku-item-title">{{ entry.title }}</span>
          <span v-if="!isItemExpanded(entry.id) && entry.preview" class="waku-item-preview">{{
            entry.preview
          }}</span>
          <span class="waku-item-status" aria-hidden="true">
            <X v-if="entry.status === 'error'" class="waku-status-x" />
            <Check v-else-if="entry.status === 'success'" class="waku-status-check" />
            <span v-else-if="entry.status === 'running'" class="waku-pulse"></span>
            <span v-else class="waku-pulse waku-pulse-pending"></span>
          </span>
        </div>

        <!-- 思考展开：弱化 markdown（位于行下方） -->
        <div
          v-if="isItemExpanded(entry.id) && entry.kind === 'reasoning' && entry.content"
          class="waku-reasoning-body"
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
            escape-raw-html
            open-links-in-new-tab
          />
        </div>

        <!-- 工具展开：inset 详情卡片（位于行下方） -->

        <div
          v-else-if="isItemExpanded(entry.id) && entry.sections?.length"
          class="waku-detail-card"
          @click.stop
        >
          <div v-for="(section, index) in entry.sections" :key="index" class="waku-section">
            <div class="waku-section-header">
              <span class="waku-section-label">{{ section.label }}</span>
              <button
                v-if="section.copyable"
                type="button"
                class="waku-copy"
                :title="copiedSection === entry.id ? '已复制' : '复制全部内容'"
                @click="copyEntry(entry)"
              >
                <Check v-if="copiedSection === entry.id" class="waku-copy-icon" />
                <Copy v-else class="waku-copy-icon" />
              </button>
            </div>
            <pre class="waku-section-content">{{ section.content }}</pre>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.waku-activity-list {
  width: 100%;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

/* ---- 摘要行 ---- */
.waku-summary {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 22px;
  padding: 0 2px;
  border: none;
  background: transparent;
  cursor: pointer;
  font: inherit;
  font-size: 11px;
  line-height: 14px;
  font-weight: 500;
  color: var(--brand-muted-strong);
  text-align: left;
  border-radius: 4px;
  width: fit-content;
}
.waku-summary:hover {
  color: var(--brand-muted);
}
.waku-summary-text {
  white-space: nowrap;
}
.waku-chevron {
  width: 10px;
  height: 10px;
  color: var(--brand-ghost);
  flex: none;
}

/* ---- 条目 ---- */
.waku-items {
  width: 100%;
  min-width: 0;
  display: flex;
  flex-direction: column;
  padding-left: 15px;
}
.waku-item {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.waku-item-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 24px;
  padding: 3px 6px;
  border-radius: 6px;
  font-size: 11.5px;
  line-height: 14px;
  cursor: default;
}
.waku-item.expandable .waku-item-row {
  cursor: pointer;
}
.waku-item.expandable .waku-item-row:hover {
  background: color-mix(in srgb, var(--brand-foreground) 6%, transparent);
}
.waku-item.expandable .waku-item-row:active {
  background: color-mix(in srgb, var(--brand-foreground) 9%, transparent);
}
.waku-item-icon {
  width: 11px;
  height: 11px;
  color: var(--brand-muted-strong);
  flex: none;
}
.waku-item-title {
  max-width: 300px;
  min-width: 0;
  flex: 0 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--brand-muted);
}
.waku-item-preview {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  color: var(--brand-ghost);
}
.waku-item.expanded .waku-item-preview {
  visibility: hidden;
}
.waku-item-status {
  display: inline-flex;
  align-items: center;
  flex: none;
}
.waku-status-check {
  width: 10px;
  height: 10px;
  color: var(--brand-ghost);
}
.waku-status-x {
  width: 10px;
  height: 10px;
  color: var(--brand-danger);
}

/* ---- 呼吸圆点（waku pulse_dot：0.3 → 1.0，1.6s）---- */
.waku-pulse {
  width: 5px;
  height: 5px;
  border-radius: 999px;
  background: var(--brand-accent);
  flex: none;
  animation: waku-pulse 1.6s ease-in-out infinite;
}
.waku-pulse-pending {
  background: var(--brand-ghost);
  opacity: 0.45;
  animation: none;
}
@keyframes waku-pulse {
  0%,
  100% {
    opacity: 0.3;
  }
  50% {
    opacity: 1;
  }
}

/* ---- 思考展开：弱化 markdown ---- */
.waku-reasoning-body {
  box-sizing: border-box;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  padding: 0 4px;
  overflow: hidden;
}
:deep(.waku-reasoning-markdown) {
  width: 100%;
  max-width: 100%;
  --text-color: var(--brand-muted-strong);
  --heading-color: var(--brand-muted-strong);
  --line-color: color-mix(in srgb, var(--brand-muted-strong) 30%, transparent);
  color: var(--brand-muted-strong);
  font-size: 13px;
  white-space: normal;
}
:deep(.waku-reasoning-markdown p),
:deep(.waku-reasoning-markdown li) {
  color: var(--brand-muted-strong);
  white-space: normal;
}
:deep(.waku-reasoning-markdown h1),
:deep(.waku-reasoning-markdown h2),
:deep(.waku-reasoning-markdown h3),
:deep(.waku-reasoning-markdown h4) {
  color: var(--brand-muted-strong);
  font-size: 14px;
  line-height: 20px;
}
:deep(.waku-reasoning-markdown a) {
  color: var(--brand-muted);
}
:deep(.waku-reasoning-markdown code:not(pre code)) {
  color: var(--brand-muted);
}

/* ---- 工具展开：inset 详情卡片 ---- */
.waku-detail-card {
  width: 100%;
  min-width: 0;
  margin: 2px 0 4px 0;
  padding: 8px;
  border: 1px solid var(--brand-border);
  border-radius: 7px;
  background: var(--brand-surface);
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-family: var(--vp-mono, ui-monospace, "SF Mono", Menlo, Consolas, monospace);
  font-size: 10.5px;
  line-height: 16px;
  color: var(--brand-muted);
  overflow: hidden;
}
.waku-section {
  position: relative;
  width: 100%;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.waku-section-header {
  min-height: 20px;
  display: flex;
  align-items: flex-start;
  padding-right: 24px;
}
.waku-section-label {
  font-family: var(--vp-font, inherit);
  font-size: 10.5px;
  font-weight: 500;
  color: var(--brand-muted);
}
.waku-copy {
  display: grid;
  place-items: center;
  position: absolute;
  top: -2px;
  right: -2px;
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  border-radius: 5px;
  background: transparent;
  cursor: pointer;
}
.waku-copy:hover {
  background: color-mix(in srgb, var(--brand-foreground) 9%, transparent);
}
.waku-copy-icon {
  width: 11px;
  height: 11px;
  color: var(--brand-ghost);
}
.waku-section-content {
  width: 100%;
  min-width: 0;
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font: inherit;
  color: var(--brand-muted);
}
</style>

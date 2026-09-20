import type { Component } from "vue";
import { ListTodo, Pencil, Sparkles, Wrench } from "@lucide/vue";
import { fileChangeTitle, toolTitle } from "@cc-heart/open-chat-types";
import type {
  FileChangeMessage,
  PlanMessage,
  ReasoningMessage,
  SegmentStatus,
  ToolMessage,
  TranscriptMessage,
  WorkspaceMessage,
} from "@cc-heart/open-chat-types";
import { formatWorkedDuration } from "../../utils/chatDuration";

/** 活动条目：由消息派生的纯展示数据（icon 为 lucide 组件本身）。 */
export interface ActivityEntry {
  id: string;
  kind: "reasoning" | "tool" | "plan" | "workspace";
  icon: Component | null;
  title: string;
  preview: string;
  status: "running" | "success" | "error" | "pending";
  content?: string;
  sections?: Array<{ label: string; content: string; copyable?: boolean }>;
  fileChanges?: Array<{
    path: string;
    additions?: number;
    deletions?: number;
    patch?: string;
  }>;
  fileStats?: { additions: number; deletions: number };
}

/** 条目派生参数（对应 ActivityList 的 props 中的派生相关字段）。 */
export interface ActivityEntryOptions {
  /** 会话是否仍在流式输出。 */
  streaming: boolean;
  /** 思考是否已完成（流式中 false 时显示「正在思考」）。 */
  reasoningDone?: boolean;
  /** 思考阶段耗时（用于「思考用时 Xs」）。 */
  reasoningDurationMs?: number;
  /** 覆盖思考条目标题；缺省按流式状态与耗时自动生成。 */
  reasoningTitle?: string;
}

/**
 * 工具详情文本化：字符串原样，对象 JSON 美化（序列化失败退化为 String），
 * 超长截断避免把整段输出塞进展开区。
 */
export const formatToolDetail = (value: unknown, maxLength = 4000): string => {
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

/**
 * 条目 id 去重。
 *
 * Activity ids come from several provider protocols. Reasoning chunks in
 * particular often reuse the same provider id after a tool call, so make the
 * ids unique at the UI boundary before they are used as Vue keys/state keys.
 */
export const normalizeEntryIds = (items: ActivityEntry[]): ActivityEntry[] => {
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

/** 消息状态 → 行状态（pending/running/completed/error → pending/running/success/error）。 */
export const segmentStatus = (status: SegmentStatus): ActivityEntry["status"] =>
  status === "completed"
    ? "success"
    : status === "error"
      ? "error"
      : status === "running"
        ? "running"
        : "pending";

/** 条目是否可展开（有思考正文 / 工具分区 / 文件变更之一）。 */
export const hasActivityDetail = (entry: ActivityEntry): boolean =>
  Boolean(entry.content) || Boolean(entry.sections?.length) || Boolean(entry.fileChanges?.length);

/**
 * 工具输出/错误预览：
 * - JSON 对象（如 bash 的 { stdout, stderr, exitCode }）取第一个有内容的字符串首行，避免预览显示裸 `{`；
 * - 普通文本取第一个非空且非纯 JSON 标点的行；
 * - 过长截断，避免把整段输出塞进标题行。
 *
 * 注意：此函数曾被 `entries` computed 在 setup 阶段同步调用（useMarkdownStreaming
 * 立即求值以读取最后一条思考内容），因此当时必须用函数声明而非 const 箭头函数规避
 * TDZ（ReferenceError 会让 setup 抛错、组件进入半初始化状态，之后每次渲染都报
 * `reading 'length'`）。抽到模块后该风险不复存在：模块体在任何调用方执行前已完整
 * 求值，所有绑定（含 const 箭头函数）都已初始化。
 */
export function firstPreviewLine(text?: string, max = 120): string {
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
}

/** 工具消息 → 条目：参数 / 输出两个可复制分区。 */
export function toolActivityEntry(tool: ToolMessage): ActivityEntry {
  const sections: Array<{ label: string; content: string; copyable?: boolean }> = [];
  if (tool.input !== undefined) {
    sections.push({ label: "参数", content: formatToolDetail(tool.input, 2000), copyable: true });
  }
  const output = [tool.output, tool.error]
    .filter((value): value is string => Boolean(value))
    .map((value) => formatToolDetail(value))
    .join("\n\n");
  if (output) sections.push({ label: "输出", content: output, copyable: tool.input === undefined });

  const status = segmentStatus(tool.status);
  const title = toolTitle(tool.name, tool.status);
  const preview =
    tool.status === "error"
      ? firstPreviewLine(tool.error)
      : tool.status === "completed"
        ? firstPreviewLine(tool.output) ||
          (tool.durationMs ? `已完成 · ${(tool.durationMs / 1000).toFixed(1)}s` : "已完成")
        : "";
  return {
    id: `tool-${tool.id || tool.name}`,
    kind: "tool",
    icon: Wrench,
    title,
    preview,
    status,
    sections: sections.length ? sections : undefined,
  };
}

/** 文件修改消息 → 条目：单文件变更 + 统一 diff。 */
export function fileChangeActivityEntry(change: FileChangeMessage): ActivityEntry {
  const status = segmentStatus(change.status ?? "completed");
  const title = fileChangeTitle(change.path, change.status);
  const preview =
    status === "success"
      ? [
          change.additions ? `+${change.additions}` : "",
          change.deletions ? `-${change.deletions}` : "",
        ]
          .filter(Boolean)
          .join(" ") || "已完成"
      : "";
  return {
    id: `file-${change.path}`,
    kind: "tool",
    icon: Pencil,
    title,
    preview,
    status,
    fileChanges: [
      {
        path: change.path,
        ...(change.additions !== undefined ? { additions: change.additions } : {}),
        ...(change.deletions !== undefined ? { deletions: change.deletions } : {}),
        ...(change.patch ? { patch: change.patch } : {}),
      },
    ],
    fileStats: {
      additions: change.additions ?? 0,
      deletions: change.deletions ?? 0,
    },
  };
}

/** 计划条目 → 条目。id 沿用「当前列表长度 + 条目序号」以保持既有 key 稳定。 */
function planActivityEntry(
  entry: PlanMessage["entries"][number],
  index: number,
  listLength: number,
): ActivityEntry {
  const status: ActivityEntry["status"] =
    entry.status === "completed"
      ? "success"
      : entry.status === "in_progress"
        ? "running"
        : "pending";
  return {
    id: `plan-${listLength}-${index}`,
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
  };
}

/** 工作区消息 → 条目：每个生成文件一条，每条错误一条。 */
function workspaceActivityEntries(message: WorkspaceMessage, streaming: boolean): ActivityEntry[] {
  const entries: ActivityEntry[] = [];
  for (const file of message.files ?? []) {
    const writing = file.status === "streaming" && streaming;
    entries.push({
      id: `file-${file.path}`,
      kind: "workspace",
      icon: Pencil,
      title: writing ? `正在写入 ${file.path}` : `已生成 ${file.path}`,
      preview: writing ? "写入中" : "已生成",
      status: writing ? "running" : "success",
    });
  }
  for (const [index, error] of (message.errors ?? []).entries()) {
    entries.push({
      id: `workspace-error-${index}`,
      kind: "workspace",
      icon: Pencil,
      title: "文件生成异常",
      preview: error,
      status: "error",
    });
  }
  return entries;
}

/** 思考条目标题：显式覆盖 > 正在思考 > 思考用时 > 思考过程。 */
function reasoningTitleOf(running: boolean, options: ActivityEntryOptions): string {
  if (options.reasoningTitle) return options.reasoningTitle;
  if (running) return "正在思考";
  return options.reasoningDurationMs
    ? `思考用时 ${formatWorkedDuration(options.reasoningDurationMs)}`
    : "思考过程";
}

/** 思考消息 → 条目（流式中且未完成时显示「正在思考」）。 */
function reasoningActivityEntry(
  message: ReasoningMessage,
  listLength: number,
  running: boolean,
  title: string,
): ActivityEntry {
  return {
    id: `reasoning-${listLength}`,
    kind: "reasoning",
    icon: Sparkles,
    title,
    preview: "",
    status: running ? "running" : "success",
    content: message.content,
  };
}

/**
 * 消息列表 → 活动条目列表（顺序、id、状态与预览文本与派生前完全一致）。
 * plan/workspace 消息会展开成多条条目。
 */
export function buildActivityEntries(
  messages: TranscriptMessage[],
  options: ActivityEntryOptions,
): ActivityEntry[] {
  const list: ActivityEntry[] = [];
  const reasoningRunning = options.streaming && options.reasoningDone !== true;
  const reasoningTitle = reasoningTitleOf(reasoningRunning, options);

  for (const message of messages) {
    if (message.role === "reasoning") {
      list.push(reasoningActivityEntry(message, list.length, reasoningRunning, reasoningTitle));
    } else if (message.role === "tool") {
      list.push(toolActivityEntry(message));
    } else if (message.role === "fileChange") {
      list.push(fileChangeActivityEntry(message));
    } else if (message.role === "plan") {
      // entries 缺省时按空计划处理：任何 getter 抛错都会让组件进入半初始化
      // 状态，随后每次渲染持续报错（见 firstPreviewLine 注释）。
      for (const [index, entry] of (message.entries ?? []).entries()) {
        list.push(planActivityEntry(entry, index, list.length));
      }
    } else if (message.role === "workspace") {
      for (const entry of workspaceActivityEntries(message, options.streaming)) list.push(entry);
    }
  }

  return normalizeEntryIds(list);
}

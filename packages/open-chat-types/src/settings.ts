/** Open Chat 渲染/摘要设置（前后端共享的默认值）。 */

export const SEGMENT_KINDS = [
  "reasoning",
  "content",
  "tool",
  "plan",
  "fileChange",
  "workspace",
] as const;

export const SUMMARY_LABELS = {
  running: "正在执行",
  done: "已执行",
  commands: "次命令",
  reasoning: "次思考",
  plans: "个计划",
  files: "次文件修改",
} as const;

export interface ActivitySummaryTextOptions {
  running?: boolean;
}

/** 把 ActivitySummary 渲染为「已执行：N 次思考，M 次文件修改」文本。 */
export function formatActivitySummary(
  summary: { commands: number; reasoning: number; plans: number; files: number },
  options: ActivitySummaryTextOptions = {},
): string {
  const parts: string[] = [];
  if (summary.commands) parts.push(`${summary.commands}${SUMMARY_LABELS.commands}`);
  if (summary.reasoning) parts.push(`${summary.reasoning}${SUMMARY_LABELS.reasoning}`);
  if (summary.plans) parts.push(`${summary.plans}${SUMMARY_LABELS.plans}`);
  if (summary.files) parts.push(`${summary.files}${SUMMARY_LABELS.files}`);
  if (!parts.length) return "";
  const prefix = options.running ? SUMMARY_LABELS.running : SUMMARY_LABELS.done;
  return `${prefix}：${parts.join("，")}`;
}

/** 思考标题（流式中/结束后）。 */
export function reasoningTitle(streaming: boolean, durationMs?: number): string {
  if (streaming) return "正在思考";
  if (durationMs !== undefined) return `思考用时 ${Math.round(durationMs / 1000)}s`;
  return "思考过程";
}

/** 工具标题（状态驱动）。 */
export function toolTitle(name: string, status: string, fileSubject?: string): string {
  const subject = fileSubject || name;
  switch (status) {
    case "running":
      return `正在运行 ${subject}`;
    case "completed":
      return `已运行 ${subject}`;
    case "error":
      return `${subject} 失败`;
    default:
      return `等待运行 ${subject}`;
  }
}

/** 文件修改标题（状态驱动）。 */
export function fileChangeTitle(path: string, status?: string): string {
  const name = path.split(/[\\/]/).filter(Boolean).at(-1) || path;
  switch (status) {
    case "running":
      return `正在编辑 ${name}`;
    case "error":
      return `编辑 ${name} 失败`;
    case "completed":
    default:
      return `已编辑 ${name}`;
  }
}

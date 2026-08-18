import type {
  TranscriptActivity,
  TranscriptPlan,
  TranscriptSegment,
  TranscriptTimelineItem,
} from "./types";

/** legacyToSegments 的输入形状（旧 XModelMessage 字段，用于持久化数据兜底）。 */
export interface LegacySegmentSource {
  content?: string;
  reasoningContent?: string;
  toolCalls?: TranscriptActivity[];
  agentPlan?: TranscriptPlan;
  timeline?: TranscriptTimelineItem[];
}

/** 旧 XModelMessage 字段 → 扁平 segments（历史持久化数据兜底，前端 toMessageSegments 使用）。 */
export function legacyToSegments(message: LegacySegmentSource): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  const timeline = message.timeline;

  const pushActivity = (activity: TranscriptActivity): void => {
    const fileChanges = activity.fileChanges ?? [];
    const isFileChange = activity.kind === "fileChange" || activity.name === "fileChange";
    const { fileChanges: _dropped, ...toolPayload } = activity;

    if (isFileChange) {
      pushFileChanges(fileChanges);
      return;
    }
    segments.push({
      kind: "tool",
      id: toolPayload.id,
      name: toolPayload.name,
      status: toolPayload.status,
      ...(toolPayload.kind !== undefined ? { providerKind: toolPayload.kind } : {}),
      ...(toolPayload.input !== undefined ? { input: toolPayload.input } : {}),
      ...(toolPayload.output !== undefined ? { output: toolPayload.output } : {}),
      ...(toolPayload.error !== undefined ? { error: toolPayload.error } : {}),
      ...(toolPayload.durationMs !== undefined ? { durationMs: toolPayload.durationMs } : {}),
      ...(toolPayload.displayTarget !== undefined
        ? { displayTarget: toolPayload.displayTarget }
        : {}),
    });
    pushFileChanges(fileChanges);
  };

  const pushFileChanges = (
    fileChanges: Array<{ path: string; additions?: number; deletions?: number }>,
  ): void => {
    for (const change of fileChanges) {
      if (!change.path) continue;
      segments.push({
        kind: "fileChange",
        path: change.path,
        ...(change.additions !== undefined ? { additions: change.additions } : {}),
        ...(change.deletions !== undefined ? { deletions: change.deletions } : {}),
      });
    }
  };

  if (timeline?.length) {
    for (const item of timeline) {
      if (item.kind === "reasoning") {
        if (item.content) segments.push({ kind: "reasoning", content: item.content });
      } else if (item.kind === "content") {
        if (item.content) segments.push({ kind: "content", content: item.content });
      } else if (item.kind === "tool") {
        pushActivity(item.activity);
      } else if (item.kind === "plan") {
        if (item.plan) segments.push({ kind: "plan", entries: item.plan.entries ?? [] });
      }
    }
    return segments;
  }

  if (message.reasoningContent?.trim()) {
    segments.push({ kind: "reasoning", content: message.reasoningContent.trim() });
  }
  for (const activity of message.toolCalls ?? []) pushActivity(activity);
  if (message.agentPlan) segments.push({ kind: "plan", entries: message.agentPlan.entries ?? [] });
  if (message.content?.trim()) segments.push({ kind: "content", content: message.content.trim() });
  return segments;
}

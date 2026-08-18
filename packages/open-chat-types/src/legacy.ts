import type {
  TranscriptActivity,
  TranscriptMessage,
  TranscriptPlan,
  TranscriptTimelineItem,
} from "./types";

/** legacyToMessages 的输入形状（旧 XModelMessage 字段，用于持久化数据兜底）。 */
export interface LegacySegmentSource {
  content?: string;
  reasoningContent?: string;
  toolCalls?: TranscriptActivity[];
  agentPlan?: TranscriptPlan;
  timeline?: TranscriptTimelineItem[];
}

/** 旧 XModelMessage 字段 → 扁平消息（历史持久化数据兜底，前端 toMessageMessages 使用）。 */
export function legacyToMessages(message: LegacySegmentSource): TranscriptMessage[] {
  const messages: TranscriptMessage[] = [];
  const timeline = message.timeline;
  const now = Date.now();
  let seq = 0;
  const nextId = (): string => `legacy-${now}-${seq++}`;
  const nextTimestamp = (): number => now + seq;

  const pushActivity = (activity: TranscriptActivity): void => {
    const fileChanges = activity.fileChanges ?? [];
    const isFileChange = activity.kind === "fileChange" || activity.name === "fileChange";
    const { fileChanges: _dropped, ...toolPayload } = activity;

    if (isFileChange) {
      pushFileChanges(fileChanges);
      return;
    }
    messages.push({
      id: toolPayload.id,
      timestamp: nextTimestamp(),
      role: "tool",
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
      messages.push({
        id: `fc:${change.path}`,
        timestamp: nextTimestamp(),
        role: "fileChange",
        path: change.path,
        ...(change.additions !== undefined ? { additions: change.additions } : {}),
        ...(change.deletions !== undefined ? { deletions: change.deletions } : {}),
      });
    }
  };

  if (timeline?.length) {
    for (const item of timeline) {
      if (item.kind === "reasoning") {
        if (item.content) {
          messages.push({
            id: item.id,
            timestamp: nextTimestamp(),
            role: "reasoning",
            content: item.content,
          });
        }
      } else if (item.kind === "content") {
        if (item.content) {
          messages.push({
            id: item.id,
            timestamp: nextTimestamp(),
            role: "content",
            content: item.content,
          });
        }
      } else if (item.kind === "tool") {
        pushActivity(item.activity);
      } else if (item.kind === "plan") {
        if (item.plan) {
          messages.push({
            id: item.id,
            timestamp: nextTimestamp(),
            role: "plan",
            entries: item.plan.entries ?? [],
          });
        }
      }
    }
    return messages;
  }

  if (message.reasoningContent?.trim()) {
    messages.push({
      id: nextId(),
      timestamp: nextTimestamp(),
      role: "reasoning",
      content: message.reasoningContent.trim(),
    });
  }
  for (const activity of message.toolCalls ?? []) pushActivity(activity);
  if (message.agentPlan) {
    messages.push({
      id: nextId(),
      timestamp: nextTimestamp(),
      role: "plan",
      entries: message.agentPlan.entries ?? [],
    });
  }
  if (message.content?.trim()) {
    messages.push({
      id: nextId(),
      timestamp: nextTimestamp(),
      role: "content",
      content: message.content.trim(),
    });
  }
  return messages;
}

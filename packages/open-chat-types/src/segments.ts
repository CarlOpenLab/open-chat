import type {
  FileChangeSegment,
  PlanSegment,
  ReasoningSegment,
  SegmentStatus,
  ToolSegment,
  TranscriptActivity,
  TranscriptSegment,
  TranscriptTimelineItem,
} from "./types";

export interface ActivitySummary {
  /** 工具执行次数（不含文件修改段）。 */
  commands: number;
  /** 思考次数。 */
  reasoning: number;
  /** 计划条数。 */
  plans: number;
  /** 文件修改次数（fileChange 段 + workspace 文件数）。 */
  files: number;
}

/** 合并相邻 content 段为正文（段之间用空行分隔）。 */
export function mergeContentSegments(segments: readonly TranscriptSegment[]): string {
  const parts: string[] = [];
  for (const segment of segments) {
    if (segment.kind === "content" && segment.content.trim()) {
      parts.push(segment.content.trim());
    }
  }
  return parts.join("\n\n");
}

/** 把工具活动（live native_event / 旧字段）映射为 segments。
 *  - 非 fileChange 活动 → 单个 tool 段（P1：不带 fileChanges）；
 *  - fileChange 活动 → 每个文件一个 fileChange 段。 */
export function activityToSegments(activity: TranscriptActivity): TranscriptSegment[] {
  const isFileChange = activity.kind === "fileChange" || activity.name === "fileChange";
  if (!isFileChange) {
    return [
      {
        kind: "tool",
        id: activity.id,
        name: activity.name,
        status: activity.status,
        ...(activity.kind !== undefined ? { providerKind: activity.kind } : {}),
        ...(activity.input !== undefined ? { input: activity.input } : {}),
        ...(activity.output !== undefined ? { output: activity.output } : {}),
        ...(activity.error !== undefined ? { error: activity.error } : {}),
        ...(activity.durationMs !== undefined ? { durationMs: activity.durationMs } : {}),
        ...(activity.displayTarget !== undefined ? { displayTarget: activity.displayTarget } : {}),
      },
    ];
  }
  return (activity.fileChanges ?? []).map((change) => ({
    kind: "fileChange" as const,
    path: change.path,
    ...(change.additions !== undefined ? { additions: change.additions } : {}),
    ...(change.deletions !== undefined ? { deletions: change.deletions } : {}),
    status: activity.status,
  }));
}

/** 统计活动摘要（供「已执行：N 次思考，M 次文件修改」等）。 */
export function summarizeActivities(segments: readonly TranscriptSegment[]): ActivitySummary {
  let commands = 0;
  let reasoning = 0;
  let plans = 0;
  let files = 0;
  for (const segment of segments) {
    if (segment.kind === "tool") commands += 1;
    else if (segment.kind === "reasoning") reasoning += 1;
    else if (segment.kind === "plan") plans += segment.entries.length;
    else if (segment.kind === "fileChange") files += 1;
    else if (segment.kind === "workspace") files += segment.files.length;
  }
  return { commands, reasoning, plans, files };
}

export function mergeReasoningContent(segments: readonly TranscriptSegment[]): string {
  const parts: string[] = [];
  for (const segment of segments) {
    if (segment.kind === "reasoning" && segment.content.trim()) {
      parts.push(segment.content.trim());
    }
  }
  return parts.join("\n\n");
}

/** 相邻同种段合并 / 工具按 id upsert / 文件修改按 path upsert。 */
export function applySegmentDelta(
  segments: readonly TranscriptSegment[],
  delta: TranscriptSegment,
): TranscriptSegment[] {
  const result = segments.slice();
  switch (delta.kind) {
    case "content":
    case "reasoning": {
      const previous = result.at(-1);
      if (previous?.kind === delta.kind) {
        result[result.length - 1] = {
          ...previous,
          content: `${previous.content}${delta.content}`,
        } as TranscriptSegment;
      } else {
        result.push(delta);
      }
      return result;
    }
    case "tool": {
      const index = result.findIndex(
        (segment) => segment.kind === "tool" && segment.id === delta.id,
      );
      if (index === -1) return [...result, delta];
      const next = result.slice();
      next[index] = { ...(next[index] as ToolSegment), ...delta };
      return next;
    }
    case "plan": {
      const index = result.findIndex((segment) => segment.kind === "plan");
      if (index === -1) return [...result, delta];
      const next = result.slice();
      next[index] = delta;
      return next;
    }
    case "fileChange": {
      const index = result.findIndex(
        (segment) => segment.kind === "fileChange" && segment.path === delta.path,
      );
      if (index === -1) return [...result, delta];
      const next = result.slice();
      next[index] = { ...(next[index] as FileChangeSegment), ...delta };
      return next;
    }
    case "workspace": {
      return [...result, delta];
    }
  }
}

/** 把扁平 segments 序列化为模型请求需要的 OpenAI wire 消息体。 */
export function segmentsToOpenAIFormat(segments: readonly TranscriptSegment[]): {
  content: string;
  reasoning_content?: string;
  tool_calls?: Array<Record<string, unknown>>;
} {
  const content = mergeContentSegments(segments);
  const reasoningContent = mergeReasoningContent(segments);
  const toolCalls = segments
    .filter((segment): segment is ToolSegment => segment.kind === "tool")
    .map((tool) => ({
      id: tool.id,
      type: "function",
      function: {
        name: tool.name,
        arguments:
          typeof tool.input === "string"
            ? tool.input
            : tool.input !== undefined
              ? JSON.stringify(tool.input)
              : "{}",
      },
    }));
  return {
    content,
    ...(reasoningContent ? { reasoning_content: reasoningContent } : {}),
    ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
  };
}

/** 过渡期：把扁平 segments 桥接回旧 timeline（供现有渲染组件消费）。 */
export function buildTimelineItems(
  segments: readonly TranscriptSegment[],
  ownerId: string,
): TranscriptTimelineItem[] {
  const timeline: TranscriptTimelineItem[] = [];
  let contentCount = 0;
  let reasoningCount = 0;
  for (const segment of segments) {
    if (segment.kind === "reasoning") {
      timeline.push({
        kind: "reasoning",
        id: `reasoning-${ownerId}-${reasoningCount++}`,
        content: segment.content,
      });
    } else if (segment.kind === "content") {
      timeline.push({
        kind: "content",
        id: `content-${ownerId}-${contentCount++}`,
        content: segment.content,
      });
    } else if (segment.kind === "tool") {
      timeline.push({
        kind: "tool",
        id: segment.id,
        activity: {
          id: segment.id,
          name: segment.name,
          status: segment.status,
          ...(segment.providerKind !== undefined ? { kind: segment.providerKind } : {}),
          ...(segment.input !== undefined ? { input: segment.input } : {}),
          ...(segment.output !== undefined ? { output: segment.output } : {}),
          ...(segment.error !== undefined ? { error: segment.error } : {}),
          ...(segment.durationMs !== undefined ? { durationMs: segment.durationMs } : {}),
          ...(segment.displayTarget !== undefined ? { displayTarget: segment.displayTarget } : {}),
        },
      });
    } else if (segment.kind === "plan") {
      timeline.push({
        kind: "plan",
        id: `plan-${ownerId}`,
        plan: { entries: segment.entries },
      });
    } else if (segment.kind === "fileChange") {
      timeline.push({
        kind: "tool",
        id: `file-${ownerId}-${segment.path}`,
        activity: {
          id: `file-${ownerId}-${segment.path}`,
          name: "file_change",
          kind: "fileChange",
          status: (segment.status ?? "completed") as SegmentStatus,
          fileChanges: [
            {
              path: segment.path,
              ...(segment.additions !== undefined ? { additions: segment.additions } : {}),
              ...(segment.deletions !== undefined ? { deletions: segment.deletions } : {}),
            },
          ],
        },
      });
    }
  }
  return timeline;
}

export function isAssistantMessageWithSegments(message: {
  role?: string;
  segments?: unknown;
}): message is { role: "assistant"; segments: TranscriptSegment[] } {
  return message.role === "assistant" && Array.isArray(message.segments);
}

/** 从消息里取计划段（过渡期用）。 */
export function findPlanSegment(segments: readonly TranscriptSegment[]): PlanSegment | undefined {
  return segments.find((segment): segment is PlanSegment => segment.kind === "plan");
}

/** 从消息里取思考文本（过渡期用）。 */
export function findReasoningSegments(segments: readonly TranscriptSegment[]): ReasoningSegment[] {
  return segments.filter((segment): segment is ReasoningSegment => segment.kind === "reasoning");
}

/** 从消息里取工具段（过渡期用）。 */
export function findToolSegments(segments: readonly TranscriptSegment[]): ToolSegment[] {
  return segments.filter((segment): segment is ToolSegment => segment.kind === "tool");
}

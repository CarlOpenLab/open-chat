import type {
  FileChangeMessage,
  PlanMessage,
  ReasoningMessage,
  ToolMessage,
  TranscriptActivity,
  TranscriptMessage,
} from "./types";

export interface ActivitySummary {
  /** 工具执行次数（不含文件修改消息）。 */
  commands: number;
  /** 思考次数。 */
  reasoning: number;
  /** 计划条数。 */
  plans: number;
  /** 文件修改次数（fileChange 消息 + workspace 文件数）。 */
  files: number;
}

/** 合并全部 content 消息为正文（消息之间用空行分隔）。 */
export function mergeContentMessages(messages: readonly TranscriptMessage[]): string {
  const parts: string[] = [];
  for (const message of messages) {
    if (message.role === "content" && message.content.trim()) {
      parts.push(message.content.trim());
    }
  }
  return parts.join("\n\n");
}

/** 合并全部 reasoning 消息为思考文本。 */
export function mergeReasoningMessages(messages: readonly TranscriptMessage[]): string {
  const parts: string[] = [];
  for (const message of messages) {
    if (message.role === "reasoning" && message.content.trim()) {
      parts.push(message.content.trim());
    }
  }
  return parts.join("\n\n");
}

/** 把工具活动（live native_event / 旧字段）映射为消息。
 *  - 非 fileChange 活动 → 单条 tool 消息（P1：不带 fileChanges）；
 *  - fileChange 活动 → 每个文件一条 fileChange 消息。 */
export function activityToMessages(activity: TranscriptActivity): TranscriptMessage[] {
  const isFileChange = activity.kind === "fileChange" || activity.name === "fileChange";
  if (!isFileChange) {
    return [
      {
        id: activity.id,
        timestamp: Date.now(),
        role: "tool",
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
    id: `fc:${change.path}`,
    timestamp: Date.now(),
    role: "fileChange" as const,
    path: change.path,
    ...(change.additions !== undefined ? { additions: change.additions } : {}),
    ...(change.deletions !== undefined ? { deletions: change.deletions } : {}),
    ...(change.patch ? { patch: change.patch } : {}),
    status: activity.status,
  }));
}

/** 统计活动摘要（供「已执行：N 次思考，M 次文件修改」等）。 */
export function summarizeMessages(messages: readonly TranscriptMessage[]): ActivitySummary {
  let commands = 0;
  let reasoning = 0;
  let plans = 0;
  let files = 0;
  for (const message of messages) {
    if (message.role === "tool") commands += 1;
    else if (message.role === "reasoning") reasoning += 1;
    else if (message.role === "plan") plans += message.entries.length;
    else if (message.role === "fileChange") files += 1;
    else if (message.role === "workspace") files += message.files.length;
  }
  return { commands, reasoning, plans, files };
}

/** 流式 reducer：按 role 把增量消息合并/追加到消息列表。
 *  - content / reasoning：累积进「最后一条同 role 消息」；
 *  - tool：按 id upsert；
 *  - plan：唯一覆盖；
 *  - fileChange：按 path upsert；
 *  - workspace：唯一覆盖（后到者胜）。 */
export function applyMessageDelta(
  messages: readonly TranscriptMessage[],
  delta: TranscriptMessage,
): TranscriptMessage[] {
  const result = messages.slice();
  switch (delta.role) {
    case "content":
    case "reasoning": {
      const previous = result.at(-1);
      if (previous?.role === delta.role) {
        result[result.length - 1] = {
          ...previous,
          content: `${previous.content}${delta.content}`,
        };
      } else {
        result.push(delta);
      }
      return result;
    }
    case "tool": {
      const index = result.findIndex(
        (message) => message.role === "tool" && message.id === delta.id,
      );
      if (index === -1) return [...result, delta];
      const next = result.slice();
      next[index] = { ...(next[index] as ToolMessage), ...delta };
      return next;
    }
    case "plan": {
      const index = result.findIndex((message) => message.role === "plan");
      if (index === -1) return [...result, delta];
      const next = result.slice();
      next[index] = delta;
      return next;
    }
    case "fileChange": {
      const index = result.findIndex(
        (message) =>
          message.role === "fileChange" && message.path === (delta as FileChangeMessage).path,
      );
      if (index === -1) return [...result, delta];
      const next = result.slice();
      next[index] = { ...(next[index] as FileChangeMessage), ...delta };
      return next;
    }
    case "workspace":
    case "user": {
      const index = result.findIndex((message) => message.role === delta.role);
      if (index === -1) return [...result, delta];
      const next = result.slice();
      next[index] = delta;
      return next;
    }
  }
}

/** 把扁平消息序列化为模型请求需要的 OpenAI wire 消息体（单个 assistant 回合）。 */
export function messagesToOpenAIFormat(messages: readonly TranscriptMessage[]): {
  content: string;
  reasoning_content?: string;
  tool_calls?: Array<Record<string, unknown>>;
} {
  const content = mergeContentMessages(messages);
  const reasoningContent = mergeReasoningMessages(messages);
  const toolCalls = findToolMessages(messages).map((tool) => ({
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

/** 取全部 tool 消息。 */
export function findToolMessages(messages: readonly TranscriptMessage[]): ToolMessage[] {
  return messages.filter((message): message is ToolMessage => message.role === "tool");
}

/** 取计划消息（计划唯一）。 */
export function findPlanMessage(messages: readonly TranscriptMessage[]): PlanMessage | undefined {
  return messages.find((message): message is PlanMessage => message.role === "plan");
}

/** 取全部 reasoning 消息。 */
export function findReasoningMessages(messages: readonly TranscriptMessage[]): ReasoningMessage[] {
  return messages.filter((message): message is ReasoningMessage => message.role === "reasoning");
}

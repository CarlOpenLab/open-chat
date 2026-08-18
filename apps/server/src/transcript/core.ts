import type {
  AssistantMessage,
  TranscriptHistoryCollector,
  TranscriptMessage,
  TranscriptRole,
  TranscriptSegment,
} from "./types";

// ─────────────────────────────────────────────────────────────
// 扁平消息 collector（服务端 live 累积，如 ACP）。
// ─────────────────────────────────────────────────────────────

export function createTranscriptCollector(
  messages: TranscriptMessage[] = [],
): TranscriptHistoryCollector {
  return { messages, nextId: messages.length, activeRole: messages.at(-1)?.role ?? null };
}

export function transcriptMessageFor(
  collector: TranscriptHistoryCollector,
  role: TranscriptRole,
  idPrefix = "transcript",
): TranscriptMessage {
  const last = collector.messages.at(-1);
  if (last && collector.activeRole === role) return last;

  const timestamp = Date.now();
  const id = `${idPrefix}-${collector.nextId++}`;
  const message: TranscriptMessage =
    role === "user"
      ? { id, timestamp, role: "user", content: "" }
      : { id, timestamp, role: "assistant", segments: [] };
  collector.messages.push(message);
  collector.activeRole = role;
  return message;
}

// ─────────────────────────────────────────────────────────────
// 扁平 segments 操作。
// ─────────────────────────────────────────────────────────────

/** 相邻 content 段合并（块之间用空行），否则追加。 */
export function appendContentSegment(message: AssistantMessage, text: string): void {
  appendSegment(message, { kind: "content", content: text });
}

/** 相邻 reasoning 段合并，否则追加。 */
export function appendReasoningSegment(message: AssistantMessage, text: string): void {
  appendSegment(message, { kind: "reasoning", content: text });
}

export function appendSegment(message: AssistantMessage, segment: TranscriptSegment): void {
  const segments = message.segments;
  const previous = segments.at(-1);
  if (
    (segment.kind === "content" || segment.kind === "reasoning") &&
    previous?.kind === segment.kind
  ) {
    const merged =
      previous.kind === "content" && segment.kind === "content"
        ? `${previous.content}\n\n${segment.content}`
        : `${previous.content}${segment.content}`;
    segments[segments.length - 1] = { ...previous, content: merged } as TranscriptSegment;
  } else {
    segments.push(segment);
  }
}

/** 工具段按 id upsert（后到状态覆盖旧状态）。 */
export function upsertToolSegment(
  message: AssistantMessage,
  tool: Extract<TranscriptSegment, { kind: "tool" }>,
): void {
  const index = message.segments.findIndex(
    (segment) => segment.kind === "tool" && segment.id === tool.id,
  );
  if (index === -1) message.segments.push(tool);
  else message.segments[index] = { ...message.segments[index], ...tool };
}

/** plan 段唯一，后到者覆盖。 */
export function upsertPlanSegment(
  message: AssistantMessage,
  entries: Array<{ content: string; status: "pending" | "in_progress" | "completed" }>,
): void {
  const index = message.segments.findIndex((segment) => segment.kind === "plan");
  const segment: TranscriptSegment = { kind: "plan", entries };
  if (index === -1) message.segments.push(segment);
  else message.segments[index] = segment;
}

/** 文件修改段按 path upsert。 */
export function upsertFileChangeSegment(
  message: AssistantMessage,
  change: Extract<TranscriptSegment, { kind: "fileChange" }>,
): void {
  const index = message.segments.findIndex(
    (segment) => segment.kind === "fileChange" && segment.path === change.path,
  );
  if (index === -1) message.segments.push(change);
  else message.segments[index] = { ...message.segments[index], ...change };
}

/**
 * 扁平历史规范化：合并相邻 assistant 消息（拼接 segments，相邻同种段再合并），
 * user 消息边界保持权威。
 */
export function normalizeTranscriptHistory(messages: TranscriptMessage[]): TranscriptMessage[] {
  const history: TranscriptMessage[] = [];
  for (const message of messages) {
    if (message.role === "user") {
      history.push(message);
      continue;
    }
    if (!message.segments.length) continue;
    const previous = history.at(-1);
    if (previous?.role === "assistant") {
      for (const segment of message.segments) appendSegment(previous, segment);
    } else {
      history.push(message);
    }
  }
  return history;
}

/** 判断扁平 assistant 消息是否有内容（有任意 segment 即算）。 */
export function hasAssistantSegments(message: AssistantMessage): boolean {
  return message.segments.length > 0;
}

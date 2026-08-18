import type { BubbleItemType } from "@antdv-next/x";
import type { DefaultMessageInfo, XModelMessage } from "@antdv-next/x-sdk";
import {
  applySegmentDelta,
  extractWorkspaceFromContent,
  legacyToSegments,
  mergeContentSegments,
  mergeReasoningContent,
  segmentHistory,
} from "@cc-heart/open-chat-types";
import type {
  HistoryRecord,
  TranscriptMessage,
  TranscriptSegment,
  TranscriptTimelineItem,
  WorkspaceSegment,
} from "@cc-heart/open-chat-types";

export type {
  TranscriptActivity,
  TranscriptMessage,
  TranscriptPlan,
  TranscriptTimelineItem,
} from "@cc-heart/open-chat-types";

/** 接口返回的扁平记录 → 模型消息（先共享 segmentation 重组，再映射）。 */
export function recordsToModelMessages(
  records: HistoryRecord[],
): DefaultMessageInfo<XModelMessage>[] {
  return transcriptHistoryToModelMessages(segmentHistory(records));
}

/** 扁平消息 → 模型消息（useXChat 使用）。 */
export function transcriptHistoryToModelMessages(
  history: TranscriptMessage[],
): DefaultMessageInfo<XModelMessage>[] {
  return history.map((item) => ({
    id: item.id,
    status: "success",
    message: transcriptToModelMessage(item),
  }));
}

export function transcriptToModelMessage(item: TranscriptMessage): XModelMessage {
  if (item.role === "user") {
    return {
      role: "user",
      content: item.content,
      ...(item.attachments?.length ? { attachments: item.attachments } : {}),
      ...(item.hidden === true ? { openChatLocalOnly: true, hidden: true } : {}),
    };
  }

  const segments = item.segments;
  return {
    role: "assistant",
    content: mergeContentSegments(segments),
    ...(mergeReasoningContent(segments)
      ? { reasoningContent: mergeReasoningContent(segments) }
      : {}),
    ...(segments.length ? { segments } : {}),
    ...(item.attachments?.length ? { attachments: item.attachments } : {}),
  };
}

export function appendTranscriptMessageToModelMessages(
  messages: DefaultMessageInfo<XModelMessage>[],
  item: TranscriptMessage,
): DefaultMessageInfo<XModelMessage>[] {
  const incoming = transcriptToModelMessage(item);
  const last = messages.at(-1);
  if (item.role !== "assistant" || last?.message.role !== "assistant") {
    return [...messages, { id: item.id, status: "success", message: incoming }];
  }

  const previous = last.message;
  const previousSegments = toMessageSegments(previous);
  const incomingSegments = toMessageSegments(incoming);
  const segments = incomingSegments.reduce<TranscriptSegment[]>(
    (acc, segment) => applySegmentDelta(acc, segment),
    previousSegments,
  );
  return [
    ...messages.slice(0, -1),
    {
      ...last,
      status: "success",
      message: {
        ...previous,
        content: appendTranscriptField(previous.content, incoming.content),
        reasoningContent: appendTranscriptField(
          previous.reasoningContent,
          incoming.reasoningContent,
        ),
        ...(segments.length ? { segments } : {}),
        ...(incoming.reasoningContent ? { reasoningDone: false } : {}),
        ...(incoming.content && incoming.reasoningContent ? { reasoningDone: true } : {}),
      },
    },
  ];
}

export function modelMessagesToBubbleItems(
  messages: DefaultMessageInfo<XModelMessage>[],
): BubbleItemType[] {
  return messages
    .filter(({ message, extraInfo }) => !isHiddenModelMessage(message, extraInfo))
    .map(({ id, message, status, extraInfo }, index) => {
      // Antdv's `loading` prop replaces the content renderer with its own
      // skeleton. Keep assistant waiting rows in the same renderer as the
      // streaming response so the existing "工作中" indicator is visible
      // immediately after submission.
      const assistantWaiting = message.role === "assistant" && status === "loading";
      const timing = extraInfo as
        | { turnStartedAtMs?: unknown; turnDurationMs?: unknown }
        | undefined;
      const rawContent = typeof message.content === "string" ? message.content : "";
      let displayContent = rawContent;
      let segments = toMessageSegments(message);
      // live 路径的工作区块尚未提取：展示层剥离，并补一个 workspace 段。
      if (message.role === "assistant" && typeof message.content === "string") {
        const extracted = extractWorkspaceFromContent(message.content);
        if (extracted.hasWorkspaceBlock) {
          displayContent = extracted.markdown;
          segments = mergeDisplayWorkspace(segments, extracted);
        }
      }
      return {
        key: id ?? `message-${index}`,
        role: message.role,
        status: assistantWaiting ? "updating" : status,
        loading: status === "loading" && !assistantWaiting,
        content: displayContent,
        extraInfo: {
          ...(segments.length ? { segments } : {}),
          reasoningDone:
            typeof message.reasoningDone === "boolean" ? message.reasoningDone : undefined,
          chatError: typeof message.chatError === "string" ? message.chatError : undefined,
          chatNotices: Array.isArray(message.chatNotices) ? message.chatNotices : undefined,
          attachments: Array.isArray(message.attachments) ? message.attachments : undefined,
          turnStartedAtMs:
            typeof timing?.turnStartedAtMs === "number" ? timing.turnStartedAtMs : undefined,
          turnDurationMs:
            typeof timing?.turnDurationMs === "number" ? timing.turnDurationMs : undefined,
        },
      };
    });
}

function appendTranscriptField(previous: unknown, incoming: unknown): string {
  const left = typeof previous === "string" ? previous : "";
  const right = typeof incoming === "string" ? incoming : "";
  if (!right) return left;
  if (!left) return right;
  return `${left}\n\n${right}`;
}

/** 把展示层提取出的工作区块并入 segments（按 workspace 段唯一合并）。 */
function mergeDisplayWorkspace(
  segments: TranscriptSegment[],
  extracted: ReturnType<typeof extractWorkspaceFromContent>,
): TranscriptSegment[] {
  const workspace: WorkspaceSegment = {
    kind: "workspace",
    files: extracted.files,
    errors: extracted.errors,
    ...(extracted.hasPendingBlock !== undefined
      ? { hasPendingBlock: extracted.hasPendingBlock }
      : {}),
  };
  const index = segments.findIndex((segment) => segment.kind === "workspace");
  if (index === -1) return [...segments, workspace];
  const next = segments.slice();
  next[index] = workspace;
  return next;
}

/** 从 XModelMessage 取 segments；旧字段（live 过渡数据）兜底转换。 */
function toMessageSegments(message: XModelMessage): TranscriptSegment[] {
  const segments = (message as XModelMessage & { segments?: unknown }).segments;
  if (Array.isArray(segments)) return segments as TranscriptSegment[];
  const legacy = {
    content: typeof message.content === "string" ? message.content : "",
    ...(typeof message.reasoningContent === "string"
      ? { reasoningContent: message.reasoningContent }
      : {}),
    ...(Array.isArray(message.toolCalls) ? { toolCalls: message.toolCalls } : {}),
    ...(message.agentPlan && typeof message.agentPlan === "object"
      ? { agentPlan: message.agentPlan }
      : {}),
    ...(Array.isArray((message as { timeline?: unknown }).timeline)
      ? {
          timeline: (message as unknown as { timeline: unknown[] })
            .timeline as TranscriptTimelineItem[],
        }
      : {}),
  };
  return legacyToSegments(legacy);
}

/** 隐藏的模型上下文消息（a2ui-submission 遗留能力）：进上下文但不渲染。 */
export function isHiddenModelMessage(
  message: XModelMessage,
  extraInfo?: Record<string, unknown>,
): boolean {
  return (
    message.role === "user" &&
    ((message as XModelMessage & { openChatLocalOnly?: unknown }).openChatLocalOnly === true ||
      extraInfo?.hidden === true)
  );
}

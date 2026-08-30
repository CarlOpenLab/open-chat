import type { BubbleItemType } from "@antdv-next/x";
import type { DefaultMessageInfo, XModelMessage } from "@antdv-next/x-sdk";
import {
  mergeContentMessages,
  mergeReasoningMessages,
  type TranscriptMessage,
  type TranscriptRole,
} from "@cc-heart/open-chat-types";

export type {
  TranscriptActivity,
  TranscriptMessage,
  TranscriptPlan,
  TranscriptTimelineItem,
} from "@cc-heart/open-chat-types";

/** 网站侧消息：XModelMessage 基础上携带平铺片段（assistant 消息的 fragments）。 */
export interface ChatModelMessage extends XModelMessage {
  /** 该条 UI 消息携带的扁平片段（assistant 流式/历史；user 消息为单条）。 */
  fragments: TranscriptMessage[];
}

/** 扁平消息 → 模型消息（useXChat 使用）：一条消息对应一条 UI 消息。 */
export function transcriptHistoryToModelMessages(
  history: TranscriptMessage[],
): DefaultMessageInfo<XModelMessage>[] {
  return history.map((item) => ({
    id: item.id,
    status: "success",
    message: transcriptToModelMessage(item),
  }));
}

export function transcriptToModelMessage(item: TranscriptMessage): ChatModelMessage {
  const base: ChatModelMessage = {
    id: item.id,
    timestamp: item.timestamp,
    fragments: [item],
    role: item.role === "user" ? "user" : "assistant",
    content: "",
  };
  if (item.role === "user") {
    return {
      ...base,
      content: item.content,
      ...(item.attachments?.length ? { attachments: item.attachments } : {}),
      ...(item.hidden === true ? { openChatLocalOnly: true, hidden: true } : {}),
    };
  }
  if (item.role === "content") {
    return { ...base, content: item.content };
  }
  return base;
}

/** 把模型消息（可能携带多片段）追加/合并一条扁平消息（流式 transcript_message 用）。 */
export function appendTranscriptMessageToModelMessages(
  messages: DefaultMessageInfo<XModelMessage>[],
  item: TranscriptMessage,
): DefaultMessageInfo<XModelMessage>[] {
  const incoming = transcriptToModelMessage(item);
  const last = messages.at(-1);
  if (!last || (last.message as ChatModelMessage).fragments?.[0]?.role === "user") {
    return [...messages, { id: item.id, status: "success", message: incoming }];
  }
  const previous = last.message as ChatModelMessage;
  const fragments = [...(previous.fragments ?? []), item];
  return [
    ...messages.slice(0, -1),
    {
      ...last,
      id: item.id,
      status: "success",
      message: {
        ...previous,
        ...(item.role === "content" ? { content: item.content } : {}),
        fragments,
      } as ChatModelMessage,
    },
  ];
}

/** 模型消息 → 气泡项：按 fragment role 平铺成独立气泡（前端按 role 分派渲染）。 */
export function modelMessagesToBubbleItems(
  messages: DefaultMessageInfo<XModelMessage>[],
): BubbleItemType[] {
  const items: BubbleItemType[] = [];
  for (const { id, message, status, extraInfo } of messages) {
    if (isHiddenModelMessage(message, extraInfo)) continue;
    const chatMessage = message as ChatModelMessage;
    const fragments = chatMessage.fragments ?? [toSingleFragment(chatMessage)];
    // Antdv 的 loading prop 会替换内容渲染器为骨架屏；保持 loading 行用同一渲染器。
    const assistantWaiting = message.role === "assistant" && status === "loading";
    const timing = extraInfo as { turnStartedAtMs?: unknown; turnDurationMs?: unknown } | undefined;
    const bubbleExtra = {
      reasoningDone: typeof message.reasoningDone === "boolean" ? message.reasoningDone : undefined,
      chatError: typeof message.chatError === "string" ? message.chatError : undefined,
      chatNotices: Array.isArray(message.chatNotices) ? message.chatNotices : undefined,
      turnStartedAtMs:
        typeof timing?.turnStartedAtMs === "number" ? timing.turnStartedAtMs : undefined,
      turnDurationMs:
        typeof timing?.turnDurationMs === "number" ? timing.turnDurationMs : undefined,
    };

    // 单条消息片段过多（agent 回合常见：思考/正文/工具反复交错）时，每个片段
    // 都会平铺成一行独立气泡，行级渲染开销 ~0.5-1MB/行，几十上百片段就能把
    // 页面内存打爆。超过阈值后按相邻同角色片段合并（保持原始时间顺序），
    // 文本内容不丢失（mergeContentMessages 用空行连接）。
    const merged = buildMergedBubbleItems(fragments, assistantWaiting, status, bubbleExtra, id);
    if (merged) {
      items.push(...merged);
      continue;
    }
    fragments.forEach((fragment, index) => {
      items.push({
        // 片段 id（如 "assistant-c"）在多条 assistant 消息间不唯一，前缀消息 id，
        // 否则 v-for 相同 key 会跨消息串扰（渲染错乱/内存膨胀）。
        key: fragment.id ? `${id ?? "message"}::${fragment.id}` : `${id ?? "message"}-${index}`,
        role: fragment.role === "user" ? "user" : "assistant",
        status: assistantWaiting ? "updating" : status,
        loading: status === "loading" && !assistantWaiting,
        content: fragment.role === "user" || fragment.role === "content" ? fragment.content : "",
        extraInfo: {
          messageRole: fragment.role,
          message: fragment,
          ...bubbleExtra,
          ...(fragment.role === "user" || fragment.role === "content"
            ? { attachments: fragment.attachments }
            : {}),
        },
      });
    });
  }
  return items;
}

/** 单条 assistant 消息的片段合并阈值：超过后折叠为少数几行气泡。 */
const MERGE_FRAGMENT_THRESHOLD = 32;

/**
 * 片段折叠（仅当单条消息片段数超过阈值）：
 * 相邻同角色片段分为一组（run），每组折叠为一行气泡，组顺序即片段到达顺序 ——
 * 思考/正文/工具反复交错的回合仍按时间顺序呈现（思考 → 正文 → 工具 → 思考 → …），
 * 只是把每段连续碎片压成一行（正文合并不丢文本，思考合并进同一活动条目）。
 * 返回 null 表示无需折叠（没有可合并的连续片段）。
 */
function buildMergedBubbleItems(
  fragments: TranscriptMessage[],
  assistantWaiting: boolean,
  status: DefaultMessageInfo<XModelMessage>["status"],
  bubbleExtra: Record<string, unknown>,
  messageId?: string | number,
): BubbleItemType[] | null {
  if (fragments.length <= MERGE_FRAGMENT_THRESHOLD) return null;
  // 相邻同角色片段成组（run）：只折叠连续片段，顺序即片段到达顺序
  const runs: TranscriptMessage[][] = [];
  for (const fragment of fragments) {
    const lastRun = runs.at(-1);
    if (lastRun && lastRun[0].role === fragment.role) lastRun.push(fragment);
    else runs.push([fragment]);
  }
  if (!runs.some((run) => run.length > 1)) return null;

  const msgKey = messageId ?? "message";
  const items: BubbleItemType[] = [];
  for (const run of runs) {
    const role = run[0].role;
    const first = run[0];
    const last = run.at(-1)!;
    if (role === "content" && run.length > 1) {
      const mergedContent = mergeContentMessages(run);
      if (!mergedContent) continue;
      items.push({
        key: `${msgKey}::content-${items.length}`,
        role: "assistant",
        status: assistantWaiting ? "updating" : status,
        loading: false,
        content: mergedContent,
        extraInfo: {
          messageRole: "content",
          message: { ...last, content: mergedContent },
          ...bubbleExtra,
        },
      });
      continue;
    }
    if (role === "reasoning" && run.length > 1) {
      items.push({
        key: `${msgKey}::reasoning-${items.length}`,
        role: "assistant",
        status: assistantWaiting ? "updating" : status,
        loading: false,
        content: "",
        extraInfo: {
          messageRole: "activities",
          message: {
            ...first,
            content: mergeReasoningMessages(run),
          },
          ...bubbleExtra,
        },
      });
      continue;
    }
    // 单片段 / 不可合并片段（tool/plan/fileChange/workspace/user）：按原样平铺，保持顺序
    for (const fragment of run) {
      items.push({
        key: fragment.id ? `${msgKey}::${fragment.id}` : `${msgKey}-${items.length}`,
        role: fragment.role === "user" ? "user" : "assistant",
        status: assistantWaiting ? "updating" : status,
        loading: false,
        content: fragment.role === "user" || fragment.role === "content" ? fragment.content : "",
        extraInfo: {
          messageRole: fragment.role,
          message: fragment,
          ...bubbleExtra,
          ...(fragment.role === "user" || fragment.role === "content"
            ? { attachments: fragment.attachments }
            : {}),
        },
      });
    }
  }
  return items.length ? items : null;
}

/** 兜底：没有 fragments 的旧消息按 role 转单片段。 */
function toSingleFragment(message: XModelMessage): TranscriptMessage {
  const id = (message as XModelMessage & { id?: string }).id ?? "legacy";
  const timestamp = (message as XModelMessage & { timestamp?: number }).timestamp ?? Date.now();
  if (message.role === "user") {
    return {
      id,
      timestamp,
      role: "user",
      content: typeof message.content === "string" ? message.content : "",
      ...(Array.isArray(message.attachments) ? { attachments: message.attachments } : {}),
    };
  }
  const reasoningContent =
    typeof message.reasoningContent === "string" ? message.reasoningContent : "";
  if (reasoningContent) {
    return { id: `${id}-r`, timestamp, role: "reasoning", content: reasoningContent };
  }
  return {
    id: `${id}-c`,
    timestamp,
    role: "content",
    content: typeof message.content === "string" ? message.content : "",
  };
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

export type { TranscriptRole };

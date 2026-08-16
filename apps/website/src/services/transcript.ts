import type { BubbleItemType } from "@antdv-next/x";
import type { DefaultMessageInfo, XModelMessage } from "@antdv-next/x-sdk";
import { isA2UISubmissionContextMessage } from "../utils/a2ui";

export type TranscriptRole = "user" | "assistant";
export type TranscriptActivityStatus = "pending" | "running" | "completed" | "error";

export interface TranscriptFileChange {
  path: string;
  additions?: number;
  deletions?: number;
}

export interface TranscriptActivity extends Record<string, unknown> {
  id: string;
  name: string;
  status: TranscriptActivityStatus;
  kind?: string;
  input?: unknown;
  output?: string;
  error?: string;
  durationMs?: number;
  fileChanges?: TranscriptFileChange[];
  displayTarget?: string;
}

export interface TranscriptPlan extends Record<string, unknown> {
  entries?: Array<{
    content: string;
    status: "pending" | "in_progress" | "completed";
  }>;
}

export type TranscriptTimelineItem =
  | { kind: "reasoning"; id: string; content: string }
  | { kind: "content"; id: string; content: string }
  | { kind: "tool"; id: string; activity: TranscriptActivity }
  | { kind: "plan"; id: string; plan: TranscriptPlan };

/** Wire contract shared by every server-side provider adapter. */
export interface TranscriptMessage {
  id: string;
  role: TranscriptRole;
  content: string;
  reasoningContent?: string;
  toolCalls?: TranscriptActivity[];
  agentPlan?: TranscriptPlan;
  timeline?: TranscriptTimelineItem[];
}

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
  const timeline = item.timeline?.length ? item.timeline : fallbackTimeline(item);
  return {
    role: item.role,
    content: item.content,
    ...(item.reasoningContent ? { reasoningContent: item.reasoningContent } : {}),
    ...(item.toolCalls?.length ? { toolCalls: item.toolCalls } : {}),
    ...(item.agentPlan ? { agentPlan: item.agentPlan } : {}),
    ...(timeline.length ? { timeline } : {}),
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
  const content = appendTranscriptField(previous.content, incoming.content);
  const reasoningContent = appendTranscriptField(
    previous.reasoningContent,
    incoming.reasoningContent,
  );
  const toolCalls = mergeTranscriptActivities(previous.toolCalls, incoming.toolCalls);
  const timeline = mergeTranscriptTimeline(previous.timeline, incoming.timeline);
  return [
    ...messages.slice(0, -1),
    {
      ...last,
      status: "success",
      message: {
        ...previous,
        content,
        ...(reasoningContent ? { reasoningContent } : {}),
        ...(toolCalls.length ? { toolCalls } : {}),
        ...(incoming.agentPlan ? { agentPlan: incoming.agentPlan } : {}),
        ...(timeline.length ? { timeline } : {}),
        ...(incoming.reasoningContent ? { reasoningDone: false } : {}),
        ...(incoming.content && reasoningContent ? { reasoningDone: true } : {}),
      },
    },
  ];
}

export function modelMessagesToBubbleItems(
  messages: DefaultMessageInfo<XModelMessage>[],
): BubbleItemType[] {
  return messages
    .filter(({ message, extraInfo }) => !isA2UISubmissionContextMessage(message, extraInfo))
    .map(({ id, message, status, extraInfo }, index) => {
      // Antdv's `loading` prop replaces the content renderer with its own
      // skeleton. Keep assistant waiting rows in the same renderer as the
      // streaming response so the existing "工作中" indicator is visible
      // immediately after submission.
      const assistantWaiting = message.role === "assistant" && status === "loading";
      const timing = extraInfo as
        | { turnStartedAtMs?: unknown; turnDurationMs?: unknown }
        | undefined;
      return {
        key: id ?? `message-${index}`,
        role: message.role,
        status: assistantWaiting ? "updating" : status,
        loading: status === "loading" && !assistantWaiting,
        content: typeof message.content === "string" ? message.content : "",
        extraInfo: {
          reasoningContent:
            typeof message.reasoningContent === "string" ? message.reasoningContent : undefined,
          reasoningDone:
            typeof message.reasoningDone === "boolean" ? message.reasoningDone : undefined,
          toolCalls: Array.isArray(message.toolCalls) ? message.toolCalls : undefined,
          chatError: typeof message.chatError === "string" ? message.chatError : undefined,
          chatNotices: Array.isArray(message.chatNotices) ? message.chatNotices : undefined,
          agentPlan:
            message.agentPlan && typeof message.agentPlan === "object"
              ? message.agentPlan
              : undefined,
          timeline: Array.isArray(message.timeline)
            ? message.timeline
            : fallbackTimeline({
                id: String(id ?? `message-${index}`),
                role: message.role as TranscriptRole,
                content: typeof message.content === "string" ? message.content : "",
                reasoningContent:
                  typeof message.reasoningContent === "string"
                    ? message.reasoningContent
                    : undefined,
                toolCalls: Array.isArray(message.toolCalls) ? message.toolCalls : undefined,
                agentPlan:
                  message.agentPlan && typeof message.agentPlan === "object"
                    ? message.agentPlan
                    : undefined,
              }),
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

function mergeTranscriptActivities(previous: unknown, incoming: unknown): TranscriptActivity[] {
  const result = Array.isArray(previous) ? ([...previous] as TranscriptActivity[]) : [];
  if (!Array.isArray(incoming)) return result;
  for (const activity of incoming as TranscriptActivity[]) {
    const index = result.findIndex((item) => item.id === activity.id);
    if (index === -1) result.push(activity);
    else result[index] = { ...result[index], ...activity };
  }
  return result;
}

function mergeTranscriptTimeline(previous: unknown, incoming: unknown): TranscriptTimelineItem[] {
  const result = Array.isArray(previous) ? ([...previous] as TranscriptTimelineItem[]) : [];
  if (!Array.isArray(incoming)) return result;
  for (const item of incoming as TranscriptTimelineItem[]) {
    if (item.kind === "tool") {
      const index = result.findIndex((entry) => entry.kind === "tool" && entry.id === item.id);
      if (index === -1) result.push(item);
      else {
        const previousItem = result[index];
        if (previousItem?.kind === "tool") {
          result[index] = {
            ...previousItem,
            activity: { ...previousItem.activity, ...item.activity },
          };
        }
      }
    } else if (item.kind === "plan") {
      const index = result.findIndex((entry) => entry.kind === "plan" && entry.id === item.id);
      if (index === -1) result.push(item);
      else result[index] = item;
    } else {
      const previousItem = result.at(-1);
      if (previousItem?.kind === item.kind) {
        result[result.length - 1] = {
          ...previousItem,
          content: `${previousItem.content}${item.content}`,
        };
      } else {
        const duplicateCount = result.filter((entry) => entry.id === item.id).length;
        result.push(duplicateCount ? { ...item, id: `${item.id}-${duplicateCount}` } : item);
      }
    }
  }
  return result;
}

function fallbackTimeline(message: TranscriptMessage): TranscriptTimelineItem[] {
  if (message.role !== "assistant") return [];
  const timeline: TranscriptTimelineItem[] = [];
  if (message.reasoningContent?.trim()) {
    timeline.push({
      kind: "reasoning",
      id: `reasoning-${message.id}`,
      content: message.reasoningContent,
    });
  }
  for (const activity of message.toolCalls ?? []) {
    timeline.push({ kind: "tool", id: activity.id, activity });
  }
  if (message.agentPlan)
    timeline.push({ kind: "plan", id: `plan-${message.id}`, plan: message.agentPlan });
  if (message.content.trim())
    timeline.push({ kind: "content", id: `content-${message.id}`, content: message.content });
  return timeline;
}

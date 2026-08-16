import type { BubbleItemType } from "@antdv-next/x";
import type { DefaultMessageInfo, XModelMessage } from "@antdv-next/x-sdk";
import { isA2UISubmissionContextMessage } from "../utils/a2ui";

export type TranscriptRole = "user" | "assistant";
export type TranscriptActivityStatus = "pending" | "running" | "completed" | "error";

export interface TranscriptActivity extends Record<string, unknown> {
  id: string;
  name: string;
  status: TranscriptActivityStatus;
  input?: unknown;
  output?: string;
  error?: string;
  durationMs?: number;
}

export interface TranscriptPlan extends Record<string, unknown> {
  entries?: Array<{
    content: string;
    status: "pending" | "in_progress" | "completed";
  }>;
}

/** Wire contract shared by every server-side provider adapter. */
export interface TranscriptMessage {
  id: string;
  role: TranscriptRole;
  content: string;
  reasoningContent?: string;
  toolCalls?: TranscriptActivity[];
  agentPlan?: TranscriptPlan;
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
  return {
    role: item.role,
    content: item.content,
    ...(item.reasoningContent ? { reasoningContent: item.reasoningContent } : {}),
    ...(item.toolCalls?.length ? { toolCalls: item.toolCalls } : {}),
    ...(item.agentPlan ? { agentPlan: item.agentPlan } : {}),
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
      const timing = extraInfo as
        | { turnStartedAtMs?: unknown; turnDurationMs?: unknown }
        | undefined;
      return {
        key: id ?? `message-${index}`,
        role: message.role,
        status,
        loading: status === "loading",
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

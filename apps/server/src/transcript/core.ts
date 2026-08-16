import type {
  TranscriptActivity,
  TranscriptHistoryCollector,
  TranscriptMessage,
  TranscriptRole,
} from "./types";

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

  const message: TranscriptMessage = {
    id: `${idPrefix}-${collector.nextId++}`,
    role,
    content: "",
  };
  collector.messages.push(message);
  collector.activeRole = role;
  return message;
}

export function appendTranscriptText(current: string | undefined, next: string, separator = "") {
  if (!next) return current ?? "";
  if (!current) return next;
  return `${current}${separator}${next}`;
}

export function upsertTranscriptActivity(
  activities: TranscriptActivity[] | undefined,
  activity: TranscriptActivity,
): TranscriptActivity[] {
  const next = activities ? activities.slice() : [];
  const index = next.findIndex((item) => item.id === activity.id);
  if (index === -1) next.push(activity);
  else next[index] = { ...next[index], ...activity };
  return next;
}

/**
 * Provider histories occasionally split one assistant turn across several
 * adjacent records. Merge only adjacent assistant records; user boundaries
 * remain authoritative turn boundaries.
 */
export function normalizeTranscriptHistory(messages: TranscriptMessage[]): TranscriptMessage[] {
  const history: TranscriptMessage[] = [];
  for (const message of messages) {
    if (!hasTranscriptContent(message)) continue;
    const previous = history.at(-1);
    if (message.role === "assistant" && previous?.role === "assistant") {
      previous.content = appendTranscriptText(previous.content, message.content, "\n\n");
      previous.reasoningContent = optionalText(
        appendTranscriptText(previous.reasoningContent, message.reasoningContent ?? "", "\n\n"),
      );
      for (const activity of message.toolCalls ?? []) {
        previous.toolCalls = upsertTranscriptActivity(previous.toolCalls, activity);
      }
      if (message.agentPlan) previous.agentPlan = message.agentPlan;
      continue;
    }
    history.push({
      ...message,
      content: message.content.trim(),
      reasoningContent: optionalText(message.reasoningContent?.trim() ?? ""),
    });
  }
  return history;
}

export function hasTranscriptContent(message: TranscriptMessage): boolean {
  return Boolean(
    message.content.trim() ||
    message.reasoningContent?.trim() ||
    message.toolCalls?.length ||
    message.agentPlan,
  );
}

function optionalText(value: string): string | undefined {
  return value || undefined;
}

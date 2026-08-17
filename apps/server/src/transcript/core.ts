import type {
  TranscriptActivity,
  TranscriptHistoryCollector,
  TranscriptMessage,
  TranscriptRole,
  TranscriptTimelineItem,
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

export function appendTranscriptTimeline(
  message: TranscriptMessage,
  item: TranscriptTimelineItem,
): void {
  const timeline = message.timeline ? message.timeline.slice() : [];
  if (item.kind === "tool") {
    const index = timeline.findIndex((entry) => entry.kind === "tool" && entry.id === item.id);
    if (index === -1) timeline.push(item);
    else {
      const previous = timeline[index];
      if (previous?.kind === "tool") {
        timeline[index] = {
          ...previous,
          activity: { ...previous.activity, ...item.activity },
        };
      }
    }
  } else if (item.kind === "plan") {
    const index = timeline.findIndex((entry) => entry.kind === "plan" && entry.id === item.id);
    if (index === -1) timeline.push(item);
    else timeline[index] = item;
  } else {
    const previous = timeline.at(-1);
    if (previous?.kind === item.kind) {
      timeline[timeline.length - 1] = {
        ...previous,
        content: `${previous.content}${item.content}`,
      };
    } else {
      const duplicateCount = timeline.filter((entry) => entry.id === item.id).length;
      timeline.push(duplicateCount ? { ...item, id: `${item.id}-${duplicateCount}` } : item);
    }
  }
  message.timeline = timeline;
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
      for (const item of message.timeline ?? []) appendTranscriptTimeline(previous, item);
      continue;
    }
    const normalized = {
      ...message,
      content: message.content.trim(),
      reasoningContent: optionalText(message.reasoningContent?.trim() ?? ""),
    };
    if (normalized.role === "assistant" && !normalized.timeline?.length) {
      if (normalized.reasoningContent) {
        appendTranscriptTimeline(normalized, {
          kind: "reasoning",
          id: `reasoning-${normalized.id}`,
          content: normalized.reasoningContent,
        });
      }
      for (const activity of normalized.toolCalls ?? []) {
        appendTranscriptTimeline(normalized, { kind: "tool", id: activity.id, activity });
      }
      if (normalized.agentPlan) {
        appendTranscriptTimeline(normalized, {
          kind: "plan",
          id: `plan-${normalized.id}`,
          plan: normalized.agentPlan,
        });
      }
      if (normalized.content) {
        appendTranscriptTimeline(normalized, {
          kind: "content",
          id: `content-${normalized.id}`,
          content: normalized.content,
        });
      }
    }
    history.push(normalized);
  }
  return history;
}

export function hasTranscriptContent(message: TranscriptMessage): boolean {
  return Boolean(
    message.content.trim() ||
    message.reasoningContent?.trim() ||
    message.toolCalls?.length ||
    message.agentPlan ||
    message.attachments?.length,
  );
}

function optionalText(value: string): string | undefined {
  return value || undefined;
}

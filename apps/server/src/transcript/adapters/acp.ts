import type { SessionUpdate } from "@agentclientprotocol/sdk";
import { appendTranscriptTimeline, transcriptMessageFor, upsertTranscriptActivity } from "../core";
import type { TranscriptActivity, TranscriptHistoryCollector, TranscriptPlan } from "../types";
import { stringifyValue } from "../value";

export function collectAcpHistoryUpdate(
  collector: TranscriptHistoryCollector,
  update: SessionUpdate,
): void {
  switch (update.sessionUpdate) {
    case "user_message_chunk": {
      const text = acpContentText(update.content);
      if (text) transcriptMessageFor(collector, "user", "acp-history").content += text;
      break;
    }
    case "agent_message_chunk": {
      const text = acpContentText(update.content);
      if (text) {
        const message = transcriptMessageFor(collector, "assistant", "acp-history");
        message.content += text;
        appendTranscriptTimeline(message, {
          kind: "content",
          id: `content-${message.id}`,
          content: text,
        });
      }
      break;
    }
    case "agent_thought_chunk": {
      const text = acpContentText(update.content);
      if (!text) break;
      const message = transcriptMessageFor(collector, "assistant", "acp-history");
      message.reasoningContent = `${message.reasoningContent ?? ""}${text}`;
      appendTranscriptTimeline(message, {
        kind: "reasoning",
        id: `reasoning-${message.id}`,
        content: text,
      });
      break;
    }
    case "tool_call":
    case "tool_call_update": {
      const message = transcriptMessageFor(collector, "assistant", "acp-history");
      const activity = normalizeAcpActivity(update);
      message.toolCalls = upsertTranscriptActivity(message.toolCalls, activity);
      appendTranscriptTimeline(message, { kind: "tool", id: activity.id, activity });
      break;
    }
    case "plan":
    case "plan_update":
      const message = transcriptMessageFor(collector, "assistant", "acp-history");
      const plan = normalizeAcpPlan(update);
      message.agentPlan = plan;
      appendTranscriptTimeline(message, { kind: "plan", id: `plan-${message.id}`, plan });
      break;
    default:
      break;
  }
}

export function normalizeAcpPlan(update: SessionUpdate): TranscriptPlan {
  if (update.sessionUpdate !== "plan" && update.sessionUpdate !== "plan_update") return {};
  const source =
    update.sessionUpdate === "plan"
      ? update.entries
      : update.plan.type === "items"
        ? update.plan.entries
        : update.plan.type === "markdown"
          ? [{ content: update.plan.content, status: "in_progress" as const }]
          : [{ content: update.plan.uri, status: "in_progress" as const }];
  const entries = source.flatMap((entry) => {
    if (!entry.content.trim()) return [];
    return [{ content: entry.content, status: entry.status }];
  });
  return entries.length ? { entries } : {};
}

export function normalizeAcpActivity(update: SessionUpdate): TranscriptActivity {
  if (update.sessionUpdate !== "tool_call" && update.sessionUpdate !== "tool_call_update") {
    return { id: "unknown", name: "工具调用", status: "pending" };
  }
  const rawStatus = update.status;
  const status =
    rawStatus === "completed"
      ? "completed"
      : rawStatus === "failed"
        ? "error"
        : rawStatus === "pending"
          ? "pending"
          : "running";
  return {
    id: update.toolCallId,
    name: update.title || update.name || update.kind || "工具调用",
    status,
    input: update.rawInput,
    output: stringifyValue(update.rawOutput ?? update.content, "[无法序列化的工具输出]"),
    ...(rawStatus === "failed"
      ? { error: stringifyValue(update.rawOutput, "[无法序列化的工具输出]") }
      : {}),
  };
}

function acpContentText(content: unknown): string {
  if (!content || typeof content !== "object") return "";
  const block = content as { type?: unknown; text?: unknown };
  return block.type === "text" && typeof block.text === "string" ? block.text : "";
}

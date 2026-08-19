import type { SessionUpdate } from "@agentclientprotocol/sdk";
import { transcriptMessageFor, upsertPlanMessage, upsertToolMessage } from "../core";
import type { TranscriptHistoryCollector, TranscriptPlan } from "../types";
import { stringifyValue } from "../value";

/** 把 ACP 会话更新累积到扁平 collector（每条消息带 id/timestamp/role）。 */
export function collectAcpHistoryUpdate(
  collector: TranscriptHistoryCollector,
  update: SessionUpdate,
): void {
  switch (update.sessionUpdate) {
    case "user_message_chunk": {
      const text = acpContentText(update.content);
      if (text) {
        const message = transcriptMessageFor(collector, "user", "acp-history");
        if (message.role === "user") message.content += text;
      }
      break;
    }
    case "agent_message_chunk": {
      const text = acpContentText(update.content);
      if (text) {
        const message = transcriptMessageFor(collector, "content", "acp-history");
        if (message.role === "content") message.content += text;
      }
      break;
    }
    case "agent_thought_chunk": {
      const text = acpContentText(update.content);
      if (text) {
        const message = transcriptMessageFor(collector, "reasoning", "acp-history");
        if (message.role === "reasoning") message.content += text;
      }
      break;
    }
    case "tool_call":
    case "tool_call_update": {
      const activity = normalizeAcpActivity(update);
      upsertToolMessage(collector.messages, {
        id: activity.id,
        timestamp: Date.now(),
        role: "tool",
        name: activity.name,
        status: activity.status,
        ...(activity.input !== undefined ? { input: activity.input } : {}),
        ...(activity.output !== undefined ? { output: activity.output } : {}),
        ...(activity.error !== undefined ? { error: activity.error } : {}),
      });
      break;
    }
    case "plan":
    case "plan_update":
      upsertPlanMessage(
        collector.messages,
        "acp-plan",
        Date.now(),
        normalizeAcpPlan(update).entries ?? [],
      );
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

export function normalizeAcpActivity(update: SessionUpdate): {
  id: string;
  name: string;
  status: "pending" | "running" | "completed" | "error";
  input?: unknown;
  output?: string;
  error?: string;
} {
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

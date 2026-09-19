import type { PlanEntry, SessionEvent, ToolCall } from "acp-hub-core";
import { transcriptMessageFor, upsertPlanMessage, upsertToolMessage } from "../core";
import type { TranscriptHistoryCollector } from "../types";
import { stringifyValue } from "../value";

/**
 * acp-hub 统一 SessionEvent → 扁平 collector 的累积规则。
 * 与 acp.ts（原始 ACP SessionUpdate 版）平行；形状差异已在这里吸收
 * （如 PlanEntry 的 priority 字段、ToolCall 的 content/locations）。
 */
export function collectHubEvent(collector: TranscriptHistoryCollector, event: SessionEvent): void {
  switch (event.type) {
    case "message_delta": {
      if (event.text) {
        const message = transcriptMessageFor(collector, "content", "acp-history");
        if (message.role === "content") message.content += event.text;
      }
      break;
    }
    case "thought_delta": {
      if (event.text) {
        const message = transcriptMessageFor(collector, "reasoning", "acp-history");
        if (message.role === "reasoning") message.content += event.text;
      }
      break;
    }
    case "tool_call":
    case "tool_call_update": {
      const activity = normalizeHubActivity(event.toolCall);
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
    case "plan": {
      upsertPlanMessage(
        collector.messages,
        "acp-plan",
        Date.now(),
        normalizeHubPlan(event.entries),
      );
      break;
    }
    default:
      break;
  }
}

export function normalizeHubPlan(
  entries: PlanEntry[],
): Array<{ content: string; status: "pending" | "in_progress" | "completed" }> {
  return entries.flatMap((entry) => {
    if (!entry.content.trim()) return [];
    return [{ content: entry.content, status: entry.status }];
  });
}

export function normalizeHubActivity(toolCall: ToolCall): {
  id: string;
  name: string;
  status: "pending" | "running" | "completed" | "error";
  input?: unknown;
  output?: string;
  error?: string;
} {
  const rawStatus = toolCall.status;
  const status =
    rawStatus === "completed"
      ? "completed"
      : rawStatus === "failed"
        ? "error"
        : rawStatus === "pending"
          ? "pending"
          : "running";
  return {
    id: toolCall.toolCallId,
    name: toolCall.title || toolCall.kind || "工具调用",
    status,
    input: toolCall.rawInput,
    output: stringifyValue(toolCall.rawOutput ?? toolCall.content, "[无法序列化的工具输出]"),
    ...(rawStatus === "failed"
      ? { error: stringifyValue(toolCall.rawOutput, "[无法序列化的工具输出]") }
      : {}),
  };
}

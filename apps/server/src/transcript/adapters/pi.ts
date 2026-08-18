import { randomUUID } from "node:crypto";
import {
  appendContentSegment,
  appendReasoningSegment,
  normalizeTranscriptHistory,
  upsertToolSegment,
} from "../core";
import type { AssistantMessage, ToolSegment, TranscriptMessage } from "../types";
import { asRecord, contentText, extractTimestamp, messageContentText, stringValue } from "../value";

/** 把 pi jsonl 历史转换为扁平消息模型（segments + id/timestamp）。 */
export function convertPiHistory(lines: Array<Record<string, unknown>>): TranscriptMessage[] {
  const history: TranscriptMessage[] = [];

  for (const line of lines) {
    if (stringValue(line.type) !== "message") continue;
    const message = asRecord(line.message);
    const role = stringValue(message?.role);
    const content = message?.content;
    const blocks = Array.isArray(content) ? content : [];
    const timestamp = extractTimestamp(line.timestamp);

    if (role === "toolResult" || role === "tool") {
      applyPiToolResult(history, message ?? {});
      continue;
    }
    if (role !== "user" && role !== "assistant") continue;

    const text = messageContentText(content);
    const reasoning = blocks
      .map(asRecord)
      .filter((block) => stringValue(block?.type) === "thinking")
      .map((block) => stringValue(block?.thinking))
      .filter(Boolean)
      .join("\n");
    const toolCalls = blocks
      .map(asRecord)
      .filter((block) => ["toolCall", "tool_use", "tool"].includes(stringValue(block?.type)))
      .map((block) => normalizePiToolCall(block!));
    if (!text && !reasoning && !toolCalls.length) continue;

    if (role === "user") {
      history.push({
        id: stringValue(line.id) || randomUUID(),
        timestamp,
        role: "user",
        content: text,
      });
      continue;
    }

    const assistant: AssistantMessage = {
      id: stringValue(line.id) || randomUUID(),
      timestamp,
      role: "assistant",
      segments: [],
    };
    for (const blockValue of blocks) {
      const block = asRecord(blockValue);
      if (!block) continue;
      const type = stringValue(block.type);
      if (type === "thinking") {
        const blockText = stringValue(block.thinking);
        if (blockText) appendReasoningSegment(assistant, blockText);
      } else if (["toolCall", "tool_use", "tool"].includes(type)) {
        upsertToolSegment(assistant, normalizePiToolCall(block));
      } else if (type === "text") {
        const blockText = stringValue(block.text);
        if (blockText) appendContentSegment(assistant, blockText);
      }
    }
    history.push(assistant);
  }

  return normalizeTranscriptHistory(history);
}

export function normalizePiToolCall(block: Record<string, unknown>): ToolSegment {
  return {
    kind: "tool",
    id: stringValue(block.id) || randomUUID(),
    name: stringValue(block.name) || "工具调用",
    status: "running",
    ...(block.arguments !== undefined
      ? { input: block.arguments }
      : block.input !== undefined
        ? { input: block.input }
        : {}),
  };
}

/** toolResult 消息 → 给最近的 assistant 消息 upsert tool 段（completed/error）。 */
function applyPiToolResult(history: TranscriptMessage[], message: Record<string, unknown>): void {
  const activity = normalizePiToolResult(message);
  if (!activity) return;
  const assistant = [...history].reverse().find((item) => item.role === "assistant");
  if (!assistant || assistant.role !== "assistant") return;
  const existing = assistant.segments.find(
    (segment): segment is Extract<ToolSegment, { kind: "tool" }> =>
      segment.kind === "tool" && segment.id === activity.id,
  );
  const name = stringValue(message.toolName) || existing?.name || "工具调用";
  upsertToolSegment(assistant, {
    kind: "tool",
    id: activity.id,
    name,
    status: activity.status,
    ...(activity.output !== undefined ? { output: activity.output } : {}),
    ...(activity.error !== undefined ? { error: activity.error } : {}),
  });
}

function normalizePiToolResult(message: Record<string, unknown>): ToolSegment | null {
  const id = stringValue(message.toolCallId);
  if (!id) return null;
  const error = message.isError === true;
  const output = contentText(message.content);
  return {
    kind: "tool",
    id,
    name: stringValue(message.toolName) || "工具调用",
    status: error ? "error" : "completed",
    ...(output ? { output } : {}),
    ...(error ? { error: output } : {}),
  };
}

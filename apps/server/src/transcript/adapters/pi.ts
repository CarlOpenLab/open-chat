import { randomUUID } from "node:crypto";
import {
  appendContentMessage,
  appendReasoningMessage,
  normalizeTranscriptHistory,
  upsertToolMessage,
} from "../core";
import type { ToolMessage, TranscriptMessage } from "../types";
import { asRecord, contentText, extractTimestamp, messageContentText, stringValue } from "../value";

/** 把 pi jsonl 历史转换为扁平消息模型（每条消息带 id + timestamp + role）。 */
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
      .map((block) => normalizePiToolCall(block!, timestamp));
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

    const baseId = stringValue(line.id) || randomUUID();
    for (const blockValue of blocks) {
      const block = asRecord(blockValue);
      if (!block) continue;
      const type = stringValue(block.type);
      if (type === "thinking") {
        const blockText = stringValue(block.thinking);
        if (blockText) appendReasoningMessage(history, `${baseId}:r`, timestamp, blockText);
      } else if (["toolCall", "tool_use", "tool"].includes(type)) {
        upsertToolMessage(history, normalizePiToolCall(block, timestamp));
      } else if (type === "text") {
        const blockText = stringValue(block.text);
        if (blockText) appendContentMessage(history, `${baseId}:c`, timestamp, blockText);
      }
    }
  }

  return normalizeTranscriptHistory(history);
}

export function normalizePiToolCall(
  block: Record<string, unknown>,
  timestamp: number,
): ToolMessage {
  return {
    id: stringValue(block.id) || randomUUID(),
    timestamp,
    role: "tool",
    name: stringValue(block.name) || "工具调用",
    status: "running",
    ...(block.arguments !== undefined
      ? { input: block.arguments }
      : block.input !== undefined
        ? { input: block.input }
        : {}),
  };
}

/** toolResult 消息 → 按 toolCallId upsert 最近的 tool 消息（completed/error）。 */
function applyPiToolResult(history: TranscriptMessage[], message: Record<string, unknown>): void {
  const activity = normalizePiToolResult(message);
  if (!activity) return;
  const existing = [...history]
    .reverse()
    .find((item): item is ToolMessage => item.role === "tool" && item.id === activity.id);
  const name = stringValue(message.toolName) || existing?.name || "工具调用";
  upsertToolMessage(history, {
    id: activity.id,
    timestamp: existing?.timestamp ?? Date.now(),
    role: "tool",
    name,
    status: activity.status,
    ...(activity.output !== undefined ? { output: activity.output } : {}),
    ...(activity.error !== undefined ? { error: activity.error } : {}),
  });
}

function normalizePiToolResult(message: Record<string, unknown>): ToolMessage | null {
  const id = stringValue(message.toolCallId);
  if (!id) return null;
  const error = message.isError === true;
  const output = contentText(message.content);
  return {
    id,
    timestamp: Date.now(),
    role: "tool",
    name: stringValue(message.toolName) || "工具调用",
    status: error ? "error" : "completed",
    ...(output ? { output } : {}),
    ...(error ? { error: output } : {}),
  };
}

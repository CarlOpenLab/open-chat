import { randomUUID } from "node:crypto";
import {
  appendContentMessage,
  appendReasoningMessage,
  normalizeTranscriptHistory,
  upsertToolMessage,
} from "../core";
import type { ToolMessage, TranscriptActivity, TranscriptMessage } from "../types";
import {
  asRecord,
  contentText,
  extractTimestamp,
  messageContentText,
  stringifyValue,
  stringValue,
} from "../value";

/** 把 claude jsonl 历史转换为扁平消息模型（每条消息带 id + timestamp + role）。 */
export function convertClaudeHistory(lines: Array<Record<string, unknown>>): TranscriptMessage[] {
  const history: TranscriptMessage[] = [];

  for (const line of lines) {
    const message = asRecord(line.message);
    const role = stringValue(message?.role);
    const content = message?.content;
    const blocks = Array.isArray(content) ? content : [];
    const timestamp = extractTimestamp(line.timestamp);

    if (role === "user") {
      applyClaudeToolResults(history, blocks);
      const text = messageContentText(content);
      if (text) {
        history.push({
          id: stringValue(line.uuid) || randomUUID(),
          timestamp,
          role: "user",
          content: text,
        });
      }
      continue;
    }

    if (role !== "assistant") continue;
    const text = messageContentText(content);
    const reasoning = blocks
      .map(asRecord)
      .filter((block) => stringValue(block?.type) === "thinking")
      .map((block) => stringValue(block?.thinking))
      .filter(Boolean)
      .join("\n");
    const toolCalls = blocks
      .map(asRecord)
      .filter((block) => stringValue(block?.type) === "tool_use")
      .map((block) => normalizeClaudeToolUse(block!, timestamp));
    if (!text && !reasoning && !toolCalls.length) continue;
    const baseId = stringValue(line.uuid) || randomUUID();
    for (const blockValue of blocks) {
      const block = asRecord(blockValue);
      if (!block) continue;
      const blockType = stringValue(block.type);
      if (blockType === "thinking") {
        const blockText = stringValue(block.thinking);
        if (blockText) appendReasoningMessage(history, `${baseId}:r`, timestamp, blockText);
      } else if (blockType === "tool_use") {
        upsertToolMessage(history, normalizeClaudeToolUse(block, timestamp));
      } else if (blockType === "text") {
        const blockText = stringValue(block.text);
        if (blockText) appendContentMessage(history, `${baseId}:c`, timestamp, blockText);
      }
    }
  }

  return normalizeTranscriptHistory(history);
}

function normalizeClaudeToolUse(block: Record<string, unknown>, timestamp: number): ToolMessage {
  return {
    id: stringValue(block.id) || randomUUID(),
    timestamp,
    role: "tool",
    name: stringValue(block.name) || "工具调用",
    status: "running",
    ...(block.input !== undefined ? { input: block.input } : {}),
  };
}

/** tool_result 块（出现在 user 消息里）→ 按 toolCallId upsert 最近的 tool 消息。 */
function applyClaudeToolResults(history: TranscriptMessage[], blocks: unknown[]): void {
  for (const blockValue of blocks) {
    const block = asRecord(blockValue);
    if (stringValue(block?.type) !== "tool_result") continue;
    const id = stringValue(block?.tool_use_id);
    if (!id) continue;
    const error = block?.is_error === true;
    const existing = [...history]
      .reverse()
      .find((message): message is ToolMessage => message.role === "tool" && message.id === id);
    const name = existing?.name || "工具调用";
    const activity: TranscriptActivity = {
      id,
      name,
      status: error ? "error" : "completed",
      output: contentText(block?.content),
      ...(error ? { error: stringifyValue(block?.content) } : {}),
    };
    upsertToolMessage(history, {
      id,
      timestamp: existing?.timestamp ?? Date.now(),
      role: "tool",
      name,
      status: activity.status,
      ...(activity.output !== undefined ? { output: activity.output } : {}),
      ...(activity.error !== undefined ? { error: activity.error } : {}),
    });
  }
}

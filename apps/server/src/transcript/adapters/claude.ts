import { randomUUID } from "node:crypto";
import {
  appendContentSegment,
  appendReasoningSegment,
  normalizeTranscriptHistory,
  upsertToolSegment,
} from "../core";
import type {
  AssistantMessage,
  ToolSegment,
  TranscriptActivity,
  TranscriptMessage,
  TranscriptSegment,
} from "../types";
import {
  asRecord,
  contentText,
  extractTimestamp,
  messageContentText,
  stringifyValue,
  stringValue,
} from "../value";

/** 把 claude jsonl 历史转换为扁平消息模型（segments + id/timestamp）。 */
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
      .map((block) => normalizeClaudeToolUse(block!));
    if (!text && !reasoning && !toolCalls.length) continue;
    const assistant: AssistantMessage = {
      id: stringValue(line.uuid) || randomUUID(),
      timestamp,
      role: "assistant",
      segments: [],
    };
    for (const blockValue of blocks) {
      const block = asRecord(blockValue);
      if (!block) continue;
      const blockType = stringValue(block.type);
      if (blockType === "thinking") {
        const blockText = stringValue(block.thinking);
        if (blockText) appendReasoningSegment(assistant, blockText);
      } else if (blockType === "tool_use") {
        upsertToolSegment(assistant, normalizeClaudeToolUse(block));
      } else if (blockType === "text") {
        const blockText = stringValue(block.text);
        if (blockText) appendContentSegment(assistant, blockText);
      }
    }
    history.push(assistant);
  }

  return normalizeTranscriptHistory(history);
}

function normalizeClaudeToolUse(block: Record<string, unknown>): ToolSegment {
  return {
    kind: "tool",
    id: stringValue(block.id) || randomUUID(),
    name: stringValue(block.name) || "工具调用",
    status: "running",
    ...(block.input !== undefined ? { input: block.input } : {}),
  };
}

/** tool_result 块（出现在 user 消息里）→ 按 toolCallId 给最近的 assistant 消息 upsert tool 段。 */
function applyClaudeToolResults(history: TranscriptMessage[], blocks: unknown[]): void {
  const assistant = [...history].reverse().find((message) => message.role === "assistant");
  if (!assistant || assistant.role !== "assistant") return;
  for (const blockValue of blocks) {
    const block = asRecord(blockValue);
    if (stringValue(block?.type) !== "tool_result") continue;
    const id = stringValue(block?.tool_use_id);
    if (!id) continue;
    const error = block?.is_error === true;
    const existing = assistant.segments.find(
      (segment): segment is Extract<TranscriptSegment, { kind: "tool" }> =>
        segment.kind === "tool" && segment.id === id,
    );
    const name = existing?.name || "工具调用";
    const activity: TranscriptActivity = {
      id,
      name,
      status: error ? "error" : "completed",
      output: contentText(block?.content),
      ...(error ? { error: stringifyValue(block?.content) } : {}),
    };
    upsertToolSegment(assistant, {
      kind: "tool",
      id,
      name,
      status: activity.status,
      ...(activity.output !== undefined ? { output: activity.output } : {}),
      ...(activity.error !== undefined ? { error: activity.error } : {}),
    });
  }
}

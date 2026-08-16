import { randomUUID } from "node:crypto";
import {
  appendTranscriptTimeline,
  normalizeTranscriptHistory,
  upsertTranscriptActivity,
} from "../core";
import type { TranscriptActivity, TranscriptMessage } from "../types";
import { asRecord, contentText, messageContentText, stringifyValue, stringValue } from "../value";

export function convertClaudeHistory(lines: Array<Record<string, unknown>>): TranscriptMessage[] {
  const history: TranscriptMessage[] = [];

  for (const line of lines) {
    const message = asRecord(line.message);
    const role = stringValue(message?.role);
    const content = message?.content;
    const blocks = Array.isArray(content) ? content : [];

    if (role === "user") {
      applyClaudeToolResults(history, blocks);
      const text = messageContentText(content);
      if (text) {
        history.push({
          id: stringValue(line.uuid) || randomUUID(),
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
    const normalized: TranscriptMessage = {
      id: stringValue(line.uuid) || randomUUID(),
      role: "assistant",
      content: text,
      ...(reasoning ? { reasoningContent: reasoning } : {}),
      ...(toolCalls.length ? { toolCalls } : {}),
    };
    for (const blockValue of blocks) {
      const block = asRecord(blockValue);
      if (!block) continue;
      if (stringValue(block.type) === "thinking") {
        const text = stringValue(block.thinking);
        if (text)
          appendTranscriptTimeline(normalized, {
            kind: "reasoning",
            id: `reasoning-${normalized.id}`,
            content: text,
          });
      } else if (stringValue(block.type) === "tool_use") {
        const activity = normalizeClaudeToolUse(block);
        appendTranscriptTimeline(normalized, { kind: "tool", id: activity.id, activity });
      } else if (stringValue(block.type) === "text") {
        const text = stringValue(block.text);
        if (text)
          appendTranscriptTimeline(normalized, {
            kind: "content",
            id: `content-${normalized.id}`,
            content: text,
          });
      }
    }
    history.push(normalized);
  }

  return normalizeTranscriptHistory(history);
}

function normalizeClaudeToolUse(block: Record<string, unknown>): TranscriptActivity {
  return {
    id: stringValue(block.id) || randomUUID(),
    name: stringValue(block.name) || "工具调用",
    status: "running",
    input: block.input,
  };
}

function applyClaudeToolResults(history: TranscriptMessage[], blocks: unknown[]): void {
  const assistant = [...history].reverse().find((message) => message.role === "assistant");
  if (!assistant) return;
  for (const blockValue of blocks) {
    const block = asRecord(blockValue);
    if (stringValue(block?.type) !== "tool_result") continue;
    const id = stringValue(block?.tool_use_id);
    if (!id) continue;
    const error = block?.is_error === true;
    const activity: TranscriptActivity = {
      id,
      name: assistant.toolCalls?.find((tool) => tool.id === id)?.name || "工具调用",
      status: error ? "error" : "completed",
      output: contentText(block?.content),
      ...(error ? { error: stringifyValue(block?.content) } : {}),
    };
    assistant.toolCalls = upsertTranscriptActivity(assistant.toolCalls, activity);
    appendTranscriptTimeline(assistant, { kind: "tool", id, activity });
  }
}

import { randomUUID } from "node:crypto";
import { normalizeTranscriptHistory, upsertTranscriptActivity } from "../core";
import type { TranscriptActivity, TranscriptMessage, TranscriptStreamEvent } from "../types";
import { asRecord, contentText, messageContentText, stringValue } from "../value";

export function convertPiHistory(lines: Array<Record<string, unknown>>): TranscriptMessage[] {
  const history: TranscriptMessage[] = [];

  for (const line of lines) {
    if (stringValue(line.type) !== "message") continue;
    const message = asRecord(line.message);
    const role = stringValue(message?.role);
    const content = message?.content;
    const blocks = Array.isArray(content) ? content : [];

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
    history.push({
      id: stringValue(line.id) || randomUUID(),
      role,
      content: text,
      ...(reasoning ? { reasoningContent: reasoning } : {}),
      ...(toolCalls.length ? { toolCalls } : {}),
    });
  }

  return normalizeTranscriptHistory(history);
}

export function normalizePiStreamLine(line: Record<string, unknown>): TranscriptStreamEvent[] {
  if (stringValue(line.type) !== "message") return [];
  const message = asRecord(line.message);
  const role = stringValue(message?.role);
  if (role === "toolResult" || role === "tool") {
    const activity = normalizePiToolResult(message ?? {});
    return activity ? [{ type: "activity.upsert", activity }] : [];
  }
  const normalized = convertPiHistory([line])[0];
  return normalized ? [{ type: "message.append", message: normalized }] : [];
}

export function normalizePiToolCall(block: Record<string, unknown>): TranscriptActivity {
  return {
    id: stringValue(block.id) || randomUUID(),
    name: stringValue(block.name) || "工具调用",
    status: "running",
    input: block.arguments ?? block.input,
  };
}

function applyPiToolResult(history: TranscriptMessage[], message: Record<string, unknown>): void {
  const activity = normalizePiToolResult(message);
  if (!activity) return;
  const assistant = [...history].reverse().find((item) => item.role === "assistant");
  if (!assistant) return;
  assistant.toolCalls = upsertTranscriptActivity(assistant.toolCalls, {
    ...activity,
    name:
      stringValue(message.toolName) ||
      assistant.toolCalls?.find((item) => item.id === activity.id)?.name ||
      "工具调用",
  });
}

function normalizePiToolResult(message: Record<string, unknown>): TranscriptActivity | null {
  const id = stringValue(message.toolCallId);
  if (!id) return null;
  const error = message.isError === true;
  const output = contentText(message.content);
  return {
    id,
    name: stringValue(message.toolName) || "工具调用",
    status: error ? "error" : "completed",
    output,
    ...(error ? { error: output } : {}),
  };
}

import {
  appendContentSegment,
  appendReasoningSegment,
  normalizeTranscriptHistory,
  upsertToolSegment,
} from "../core";
import type { AssistantMessage, ToolSegment, TranscriptMessage, UserMessage } from "../types";
import { asRecord, extractTimestamp, stringifyValue, stringValue } from "../value";

/** 把 opencode 会话历史转换为扁平消息模型（segments + id/timestamp）。 */
export function convertOpenCodeHistory(values: unknown[]): TranscriptMessage[] {
  const history: TranscriptMessage[] = [];
  for (const value of values) {
    const message = asRecord(value);
    if (!message) continue;
    const info = asRecord(message.info ?? message.message ?? message) ?? {};
    const role = info.role === "user" || info.role === "assistant" ? info.role : undefined;
    if (!role) continue;
    const parts = Array.isArray(message.parts)
      ? message.parts
      : Array.isArray(info.parts)
        ? info.parts
        : [];
    const timestamp = extractTimestamp(info.time ?? message.time);
    const id = stringValue(info.id) || `opencode-${history.length}`;

    if (role === "user") {
      let content = "";
      for (const partValue of parts) {
        const part = asRecord(partValue);
        if (!part) continue;
        if (part.type === "text") content += stringValue(part.text);
      }
      if (!content) content = stringValue(info.content);
      if (!content) continue;
      const user: UserMessage = { id, timestamp, role: "user", content };
      history.push(user);
      continue;
    }

    let content = "";
    let reasoningContent = "";
    const toolCalls: ToolSegment[] = [];
    for (const partValue of parts) {
      const part = asRecord(partValue);
      if (!part) continue;
      if (part.type === "text") content += stringValue(part.text);
      if (part.type === "reasoning" || part.type === "thinking") {
        reasoningContent += stringValue(part.text);
      }
      if (part.type === "tool") toolCalls.push(normalizeOpenCodeActivity(part));
    }
    if (!content) content = stringValue(info.content);
    if (!content && !reasoningContent && toolCalls.length === 0) continue;

    const assistant: AssistantMessage = { id, timestamp, role: "assistant", segments: [] };
    for (const partValue of parts) {
      const part = asRecord(partValue);
      if (!part) continue;
      const type = stringValue(part.type);
      if (type === "text") {
        const text = stringValue(part.text);
        if (text) appendContentSegment(assistant, text);
      } else if (type === "reasoning" || type === "thinking") {
        const text = stringValue(part.text);
        if (text) appendReasoningSegment(assistant, text);
      } else if (type === "tool") {
        upsertToolSegment(assistant, normalizeOpenCodeActivity(part));
      }
    }
    history.push(assistant);
  }
  return normalizeTranscriptHistory(history);
}

function normalizeOpenCodeActivity(part: Record<string, unknown>): ToolSegment {
  const state = asRecord(part.state) ?? {};
  const rawStatus = stringValue(state.status || part.status);
  const status =
    rawStatus === "completed"
      ? "completed"
      : rawStatus === "error" || rawStatus === "failed"
        ? "error"
        : rawStatus === "pending"
          ? "pending"
          : "running";
  const id = stringValue(part.callID || part.callId || part.id) || `tool-${stringValue(part.name)}`;
  return {
    kind: "tool",
    id,
    name: stringValue(part.name || part.tool) || "工具调用",
    status,
    ...(state.input !== undefined || part.input !== undefined
      ? { input: state.input ?? part.input }
      : {}),
    ...(state.output !== undefined || part.output !== undefined
      ? { output: stringifyValue(state.output ?? part.output) }
      : {}),
    ...(status === "error" ? { error: stringifyValue(state.error ?? part.error, "工具失败") } : {}),
  };
}

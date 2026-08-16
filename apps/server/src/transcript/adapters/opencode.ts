import { normalizeTranscriptHistory } from "../core";
import type { TranscriptActivity, TranscriptMessage } from "../types";
import { asRecord, stringifyValue, stringValue } from "../value";

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
    let content = "";
    let reasoningContent = "";
    const toolCalls: TranscriptActivity[] = [];
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
    history.push({
      id: stringValue(info.id) || `opencode-${history.length}`,
      role,
      content,
      ...(reasoningContent ? { reasoningContent } : {}),
      ...(toolCalls.length ? { toolCalls } : {}),
    });
  }
  return normalizeTranscriptHistory(history);
}

function normalizeOpenCodeActivity(part: Record<string, unknown>): TranscriptActivity {
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
    id,
    name: stringValue(part.name || part.tool) || "工具调用",
    status,
    input: state.input ?? part.input,
    output: stringifyValue(state.output ?? part.output),
    ...(status === "error" ? { error: stringifyValue(state.error ?? part.error) } : {}),
  };
}

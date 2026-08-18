// transcript/adapters/sessionEvents.ts — 会话事件日志 → 规范历史
//
// 把会话事件日志（每行一个 JSON 事件，已解析的行数组）还原为 open-chat 扁平规范历史
// TranscriptMessage[]（每条消息带 id/timestamp/role），供历史加载 / 渲染 / 续聊使用。
// 与 sessionEvents.ts 的合成器互为逆向。
//
// 还原规则：
//   - user/message → user 消息（text 块拼接）；
//   - assistant/message → 平铺为 reasoning / content / tool 消息；
//   - tool/call 事件补充 tool-call 块缺失的 name/arguments（部分源只写块不带参数）；
//   - tool/result → 按 toolCallId upsert 对应 tool 消息的 output / status / error
//     （与 claude.ts / pi.ts 相同的 activity-upsert 纪律）；
//   - 其余事件（turn/start、step/start、session/title 等）不进入历史。

import { randomUUID } from "node:crypto";
import {
  appendContentMessage,
  appendReasoningMessage,
  normalizeTranscriptHistory,
  upsertToolMessage,
} from "../core";
import type { ToolMessage, TranscriptMessage, UserMessage } from "../types";
import { asRecord, contentText, extractTimestamp, stringValue } from "../value";

/** 把 arguments JSON 字符串解析回 input 对象（非 JSON / 空串返回原字符串）。 */
export function parseEventArguments(argumentsValue: unknown): unknown {
  if (typeof argumentsValue !== "string" || argumentsValue.trim() === "") {
    return argumentsValue ?? undefined;
  }
  try {
    return JSON.parse(argumentsValue);
  } catch {
    return argumentsValue;
  }
}

/** 会话事件日志（已解析的 JSON 行）→ 扁平规范历史。 */
export function convertSessionEventsHistory(
  lines: Array<Record<string, unknown>>,
): TranscriptMessage[] {
  const history: TranscriptMessage[] = [];

  // 第一遍：收集 tool/call 事件的 callId → name/arguments（tool-call 块可能不带参数）。
  const callById = new Map<string, { name: string; argumentsValue: unknown }>();
  for (const ev of lines) {
    if (stringValue(ev?.type) !== "tool/call") continue;
    const data = asRecord(ev.data);
    const callId = stringValue(data?.callId);
    if (!callId) continue;
    callById.set(callId, {
      name: stringValue(data?.name),
      argumentsValue: data?.arguments,
    });
  }

  for (const ev of lines) {
    const type = stringValue(ev?.type);
    const data = asRecord(ev?.data);
    if (!data) continue;
    const timestamp = extractTimestamp(ev?.time);

    if (type === "user/message") {
      const text = contentText(data.content);
      if (!text.trim()) continue;
      const user: UserMessage = {
        id: stringValue(data.id) || randomUUID(),
        timestamp,
        role: "user",
        content: text,
      };
      history.push(user);
      continue;
    }

    if (type !== "assistant/message") {
      // tool/result 按事件顺序出现：处理时刻最近的 assistant 就是其所属 step
      // （与 claude.ts / pi.ts 相同的 activity-upsert 纪律，避免跨轮错挂）。
      if (type === "tool/result") applyToolResults(history, data);
      continue;
    }
    const message = asRecord(data.message);
    const blocks = Array.isArray(message?.content) ? message.content : [];
    const text = blocks
      .map(asRecord)
      .filter((block) => block && stringValue(block.type) === "text")
      .map((block) => stringValue(block?.text))
      .filter(Boolean)
      .join("\n");
    const reasoning = blocks
      .map(asRecord)
      .filter((block) => block && stringValue(block.type) === "reasoning")
      .map((block) => stringValue(block?.text) || stringValue(block?.thinking))
      .filter(Boolean)
      .join("\n");
    const toolCalls = blocks
      .map(asRecord)
      .filter((block) => block && stringValue(block.type) === "tool-call")
      .map((block) => normalizeToolCall(block!, callById, timestamp));
    if (!text && !reasoning && !toolCalls.length) continue;
    const baseId = stringValue(message?.id) || randomUUID();
    for (const blockValue of blocks) {
      const block = asRecord(blockValue);
      if (!block) continue;
      const blockType = stringValue(block.type);
      if (blockType === "reasoning") {
        const blockText = stringValue(block.text) || stringValue(block.thinking);
        if (blockText) appendReasoningMessage(history, `${baseId}:r`, timestamp, blockText);
      } else if (blockType === "tool-call") {
        upsertToolMessage(history, normalizeToolCall(block, callById, timestamp));
      } else if (blockType === "text") {
        const blockText = stringValue(block.text);
        if (blockText) appendContentMessage(history, `${baseId}:c`, timestamp, blockText);
      }
    }
  }

  return normalizeTranscriptHistory(history);
}

function normalizeToolCall(
  block: Record<string, unknown>,
  callById: Map<string, { name: string; argumentsValue: unknown }>,
  timestamp: number,
): ToolMessage {
  const id = stringValue(block.id);
  const known = id ? callById.get(id) : undefined;
  return {
    id: id || randomUUID(),
    timestamp,
    role: "tool",
    name: stringValue(block.name) || known?.name || "工具调用",
    status: "running",
    ...(block.arguments !== undefined || known?.argumentsValue !== undefined
      ? { input: parseEventArguments(block.arguments ?? known?.argumentsValue) }
      : {}),
  };
}

/** 把单个 tool/result 事件按 toolCallId 挂到最近的 tool 消息（activity-upsert）。 */
function applyToolResults(history: TranscriptMessage[], data: Record<string, unknown>): void {
  const message = asRecord(data.message);
  const blocks = Array.isArray(message?.content) ? message.content : [];
  for (const blockValue of blocks) {
    const block = asRecord(blockValue);
    if (!block || stringValue(block.type) !== "tool-result") continue;
    const toolCallId = stringValue(block.toolCallId) || stringValue(data.toolCallId);
    if (!toolCallId) continue;
    const error = block.isError === true;
    const output = contentText(block.content);
    const existing = [...history]
      .reverse()
      .find((item): item is ToolMessage => item.role === "tool" && item.id === toolCallId);
    const name = existing?.name || "工具调用";
    upsertToolMessage(history, {
      id: toolCallId,
      timestamp: existing?.timestamp ?? Date.now(),
      role: "tool",
      name,
      status: error ? "error" : "completed",
      ...(output ? { output } : {}),
      ...(error ? { error: output } : {}),
    });
  }
}

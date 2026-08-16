import { randomUUID } from "node:crypto";
import {
  appendTranscriptText,
  hasTranscriptContent,
  normalizeTranscriptHistory,
  upsertTranscriptActivity,
} from "../core";
import type { TranscriptActivity, TranscriptMessage } from "../types";
import { asRecord, contentText, stringifyValue, stringValue } from "../value";

const ACTIVITY_TYPES = new Set([
  "commandExecution",
  "fileChange",
  "mcpToolCall",
  "dynamicToolCall",
  "collabToolCall",
  "webSearch",
  "imageView",
]);

export function convertCodexThreadHistory(turns: unknown[]): TranscriptMessage[] {
  const history: TranscriptMessage[] = [];

  for (const turnValue of turns) {
    const turn = asRecord(turnValue);
    const items = Array.isArray(turn?.items) ? turn.items : [];
    let assistant: TranscriptMessage | undefined;
    let hasExplicitFinal = false;
    const unphasedMessages: Array<{ id: string; text: string }> = [];
    const ensureAssistant = (id: string) => {
      assistant ??= { id: `${id}:assistant`, role: "assistant", content: "" };
      return assistant;
    };

    for (const itemValue of items) {
      const item = asRecord(itemValue);
      if (!item) continue;
      const type = stringValue(item.type);
      const id = stringValue(item.id) || randomUUID();

      if (type === "userMessage") {
        const content = contentText(item.content);
        if (content) history.push({ id, role: "user", content });
        continue;
      }

      if (type === "agentMessage") {
        const text = stringValue(item.text).trim();
        if (!text) continue;
        const phase = stringValue(item.phase);
        if (phase === "commentary") {
          const message = ensureAssistant(id);
          message.reasoningContent = appendTranscriptText(message.reasoningContent, text, "\n\n");
        } else if (phase === "final_answer") {
          const message = ensureAssistant(id);
          message.content = appendTranscriptText(message.content, text, "\n\n");
          hasExplicitFinal = true;
        } else {
          unphasedMessages.push({ id, text });
        }
        continue;
      }

      if (type === "reasoning") {
        const reasoning = contentText(item.summary) || contentText(item.content);
        if (!reasoning) continue;
        const message = ensureAssistant(id);
        message.reasoningContent = appendTranscriptText(
          message.reasoningContent,
          reasoning,
          "\n\n",
        );
        continue;
      }

      if (type === "plan") {
        const text = stringValue(item.text) || contentText(item.content);
        if (!text) continue;
        ensureAssistant(id).agentPlan = {
          entries: [{ content: text, status: "completed" }],
        };
        continue;
      }

      if (ACTIVITY_TYPES.has(type)) {
        const message = ensureAssistant(id);
        message.toolCalls = upsertTranscriptActivity(
          message.toolCalls,
          normalizeCodexActivity(item, true),
        );
      }
    }

    if (unphasedMessages.length) {
      const finalIndex = hasExplicitFinal ? -1 : unphasedMessages.length - 1;
      unphasedMessages.forEach(({ id, text }, index) => {
        const message = ensureAssistant(id);
        if (index === finalIndex) {
          message.content = appendTranscriptText(message.content, text, "\n\n");
        } else {
          message.reasoningContent = appendTranscriptText(message.reasoningContent, text, "\n\n");
        }
      });
    }

    if (assistant && hasTranscriptContent(assistant)) history.push(assistant);
  }

  return normalizeTranscriptHistory(history);
}

export function normalizeCodexActivity(
  item: Record<string, unknown>,
  complete: boolean,
): TranscriptActivity {
  const id =
    stringValue(item.id) ||
    stringValue(item.callId) ||
    stringValue(item.toolCallId) ||
    randomUUID();
  const name =
    stringValue(item.name) || stringValue(item.title) || stringValue(item.type) || "工具调用";
  const rawStatus = stringValue(item.status);
  const failed = rawStatus === "failed" || rawStatus === "declined";
  return {
    id,
    name,
    status: complete ? (failed ? "error" : "completed") : "running",
    input: item.arguments ?? item.command ?? item.input,
    output: stringifyValue(item.aggregatedOutput ?? item.output ?? item.result),
    durationMs: typeof item.durationMs === "number" ? item.durationMs : undefined,
    ...(failed ? { error: stringifyValue(item.error ?? item.output) } : {}),
  };
}

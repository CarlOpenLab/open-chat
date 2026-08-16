import { randomUUID } from "node:crypto";
import {
  appendTranscriptText,
  appendTranscriptTimeline,
  hasTranscriptContent,
  normalizeTranscriptHistory,
  upsertTranscriptActivity,
} from "../core";
import type { TranscriptActivity, TranscriptFileChange, TranscriptMessage } from "../types";
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
        if (phase === "commentary" || phase === "final_answer") {
          const message = ensureAssistant(id);
          appendCodexContent(message, text);
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
        appendTranscriptTimeline(message, {
          kind: "reasoning",
          id: `reasoning-${message.id}`,
          content: reasoning,
        });
        continue;
      }

      if (type === "plan") {
        const text = stringValue(item.text) || contentText(item.content);
        if (!text) continue;
        const message = ensureAssistant(id);
        message.agentPlan = {
          entries: [{ content: text, status: "completed" }],
        };
        appendTranscriptTimeline(message, {
          kind: "plan",
          id: `plan-${message.id}`,
          plan: message.agentPlan,
        });
        continue;
      }

      if (ACTIVITY_TYPES.has(type)) {
        const message = ensureAssistant(id);
        const activity = normalizeCodexActivity(item, true);
        message.toolCalls = upsertTranscriptActivity(message.toolCalls, activity);
        appendTranscriptTimeline(message, { kind: "tool", id: activity.id, activity });
      }
    }

    if (unphasedMessages.length) {
      unphasedMessages.forEach(({ id, text }) => {
        const message = ensureAssistant(id);
        appendCodexContent(message, text);
      });
    }

    if (assistant && hasTranscriptContent(assistant)) history.push(assistant);
  }

  return normalizeTranscriptHistory(history);
}

function appendCodexContent(message: TranscriptMessage, text: string): void {
  message.content = appendTranscriptText(message.content, text, "\n\n");
  const previous = message.timeline?.at(-1);
  appendTranscriptTimeline(message, {
    kind: "content",
    id: `content-${message.id}`,
    content: previous?.kind === "content" ? `\n\n${text}` : text,
  });
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
  const kind = stringValue(item.type) || name;
  const input =
    item.arguments ??
    item.command ??
    item.input ??
    (kind === "fileChange" ? (item.changes ?? item.fileChanges ?? item.file_changes) : undefined);
  const fileChanges = kind === "fileChange" ? extractFileChanges(item) : undefined;
  return {
    id,
    name,
    status: complete ? (failed ? "error" : "completed") : "running",
    kind,
    input,
    output: stringifyValue(item.aggregatedOutput ?? item.output ?? item.result),
    ...(fileChanges?.length ? { fileChanges } : {}),
    durationMs: typeof item.durationMs === "number" ? item.durationMs : undefined,
    ...(failed ? { error: stringifyValue(item.error ?? item.output) } : {}),
  };
}

function extractFileChanges(item: Record<string, unknown>): TranscriptFileChange[] {
  const source =
    item.arguments ?? item.input ?? item.changes ?? item.fileChanges ?? item.file_changes;
  const changes: TranscriptFileChange[] = [];
  collectFileChanges(source, changes, 0);
  return dedupeFileChanges(changes);
}

function collectFileChanges(value: unknown, changes: TranscriptFileChange[], depth: number): void {
  if (depth > 5 || value === null || value === undefined) return;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === "object") {
        collectFileChanges(parsed, changes, depth + 1);
        return;
      }
    } catch {
      // Raw unified diffs are handled below.
    }
    collectPatchChanges(value, changes);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectFileChanges(entry, changes, depth + 1);
    return;
  }
  if (typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  const path =
    stringValue(record.path) ||
    stringValue(record.file) ||
    stringValue(record.filename) ||
    stringValue(record.filePath);
  if (path) {
    const diff = stringValue(record.diff) || stringValue(record.patch);
    const counts = diff ? countPatchChanges(diff) : {};
    changes.push({
      path,
      additions: numberValue(record.additions) ?? counts.additions,
      deletions: numberValue(record.deletions) ?? counts.deletions,
    });
  }
  for (const key of ["changes", "fileChanges", "file_changes", "files", "patch", "diff"]) {
    if (record[key] !== undefined) collectFileChanges(record[key], changes, depth + 1);
  }
}

function collectPatchChanges(patch: string, changes: TranscriptFileChange[]): void {
  const paths = [...patch.matchAll(/^\+\+\+\s+(?:b\/)?(.+)$/gm)].map((match) => match[1]?.trim());
  const counts = countPatchChanges(patch);
  for (const path of paths) {
    if (path && path !== "/dev/null") changes.push({ path, ...counts });
  }
}

function countPatchChanges(diff: string): { additions?: number; deletions?: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("@@")) continue;
    if (line.startsWith("+")) additions += 1;
    if (line.startsWith("-")) deletions += 1;
  }
  return {
    ...(additions ? { additions } : {}),
    ...(deletions ? { deletions } : {}),
  };
}

function dedupeFileChanges(changes: TranscriptFileChange[]): TranscriptFileChange[] {
  const result: TranscriptFileChange[] = [];
  for (const change of changes) {
    const previous = result.find((entry) => entry.path === change.path);
    if (!previous) result.push(change);
    else {
      previous.additions = (previous.additions ?? 0) + (change.additions ?? 0) || undefined;
      previous.deletions = (previous.deletions ?? 0) + (change.deletions ?? 0) || undefined;
    }
  }
  return result;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

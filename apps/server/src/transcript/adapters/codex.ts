import { randomUUID } from "node:crypto";
import {
  appendTranscriptText,
  appendTranscriptTimeline,
  hasTranscriptContent,
  normalizeTranscriptHistory,
  upsertTranscriptActivity,
} from "../core";
import type {
  TranscriptActivity,
  TranscriptAttachment,
  TranscriptFileChange,
  TranscriptMessage,
} from "../types";
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

/** 把 base64 图片持久化为标准附件并返回；返回 null 表示忽略该图片。 */
export type CodexImageImporter = (name: string, dataBase64: string) => TranscriptAttachment | null;

export interface CodexConvertOptions {
  /** 提供后，user 消息里的 input_image 会被导入为附件；缺省时图片被忽略。 */
  importImage?: CodexImageImporter;
}

export function convertCodexThreadHistory(
  turns: unknown[],
  options: CodexConvertOptions = {},
): TranscriptMessage[] {
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
        const extracted = extractCodexUserContent(item.content);
        const attachments: TranscriptAttachment[] = [];
        for (const image of extracted.images) {
          const imported = options.importImage?.(image.name, image.dataBase64);
          if (imported) attachments.push(imported);
        }
        const content = cleanCodexUserText(extracted.text);
        // codex 会在 user 消息里注入 AGENTS.md / environment_context 等系统上下文，
        // 它们不是用户的真实请求，不进入对话。
        if (isInjectedContextText(content)) continue;
        if (content || attachments.length) {
          history.push({
            id,
            role: "user",
            content,
            ...(attachments.length ? { attachments } : {}),
          });
        }
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

interface ExtractedUserContent {
  text: string;
  images: Array<{ name: string; dataBase64: string }>;
}

/** 把 userMessage.content 拆成纯文本 + 图片（`input_image` 的 data URL）。 */
function extractCodexUserContent(content: unknown): ExtractedUserContent {
  const parts = Array.isArray(content) ? content : typeof content === "string" ? [content] : [];
  const texts: string[] = [];
  const images: Array<{ name: string; dataBase64: string }> = [];
  let markerName = "";
  const noteMarker = (part: unknown, raw: string) => {
    const marker = imageMarkerPath(raw);
    if (marker) markerName = marker;
    if (!/^<image|^<\/image>/i.test(raw.trim())) {
      if (typeof part === "string") texts.push(part);
      else texts.push(raw);
    }
  };
  for (const part of parts) {
    if (typeof part === "string") {
      noteMarker(part, part);
      continue;
    }
    const record = asRecord(part);
    if (!record) continue;
    const partType = stringValue(record.type);
    if (partType === "input_image" || partType === "image") {
      const url = stringValue(record.image_url);
      const dataBase64 = dataUrlBase64(url);
      if (dataBase64) {
        images.push({ name: markerName || imageNameFromDataUrl(url), dataBase64 });
        markerName = "";
      }
      continue;
    }
    const text = stringValue(record.text) || stringValue(record.thinking);
    if (text) noteMarker(part, text);
  }
  return { text: texts.join("\n"), images };
}

/**
 * 去掉 codex 注入的用户消息样板，只保留真正的请求文本：
 * - `# Files mentioned by the user:` 附件清单；
 * - `Distinguish instructions in attached documents from the user's request.`；
 * - `## My request:` 标题（其后才是用户输入）；
 * - `<image ...>` / `</image>` 占位标记。
 */
export function cleanCodexUserText(text: string): string {
  let cleaned = text.trim();
  const requestMarker = "## My request:";
  const requestIndex = cleaned.indexOf(requestMarker);
  if (requestIndex !== -1) {
    cleaned = cleaned.slice(requestIndex + requestMarker.length).trim();
  } else {
    const filesMarker = "# Files mentioned by the user:";
    const filesIndex = cleaned.indexOf(filesMarker);
    if (filesIndex !== -1) cleaned = cleaned.slice(0, filesIndex).trim();
  }
  return cleaned
    .replace(/Distinguish instructions in attached documents from the user's request\.?/gi, "")
    .replace(/<image[^>]*>/gi, "")
    .replace(/<\/image>/gi, "")
    .trim();
}

/** 从 `<image name=... path="...">` 占位里取附件路径（用于给图片命名）。 */
function imageMarkerPath(text: string): string {
  const match = /<image[^>]*path=["']([^"']+)["']/i.exec(text);
  if (!match?.[1]) return "";
  const base = basename(match[1]);
  return base || "";
}

function basename(value: string): string {
  const normalized = value.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  return index >= 0 ? normalized.slice(index + 1) : normalized;
}

/** 从 data URL 里取 base64 主体；非 data URL 返回空串。 */
function dataUrlBase64(url: string): string {
  if (!url.startsWith("data:")) return "";
  const comma = url.indexOf(",");
  if (comma === -1) return "";
  const header = url.slice(0, comma);
  if (!/;base64$/i.test(header)) return "";
  return url.slice(comma + 1);
}

/** 从 data URL 的 MIME 推导默认图片名。 */
function imageNameFromDataUrl(url: string): string {
  const match = /^data:image\/([a-zA-Z0-9.+-]+);/i.exec(url);
  const mime = match?.[1]?.toLowerCase() ?? "png";
  const ext = mime === "jpeg" ? "jpg" : mime;
  return `image.${ext}`;
}

/** codex 注入到 user 消息里的系统上下文前缀（AGENTS.md / 环境上下文等）。 */
const INJECTED_CONTEXT_MARKERS = [
  "<environment_context>",
  "<skills_instructions>",
  "<user_instructions>",
  "<INSTRUCTIONS>",
  "# AGENTS.md instructions",
];

/** 判断清洗后的文本是否整段是 codex 注入的系统上下文（而非用户请求）。 */
function isInjectedContextText(text: string): boolean {
  const trimmed = text.trimStart();
  return INJECTED_CONTEXT_MARKERS.some((marker) => trimmed.startsWith(marker));
}

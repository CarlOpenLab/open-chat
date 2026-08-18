import type {
  AssistantMessage,
  PlanEntryStatus,
  SegmentStatus,
  TranscriptAttachment,
  TranscriptMessage,
  TranscriptSegment,
  UserMessage,
  WorkspaceSegment,
} from "./types";

// ─────────────────────────────────────────────────────────────
// 扁平历史记录（wire contract）。
//
// 接口返回的是按时间升序（从顶到底）的扁平记录数组：user 消息与
// assistant 的每个 segment 都是独立的顶层记录，各自带 id + timestamp。
// 后端不再对消息/segments 分组，前端（或任何消费方）用 segmentHistory
// 把扁平记录重组为消息模型。
// ─────────────────────────────────────────────────────────────

export interface UserRecord {
  id: string;
  timestamp: number;
  kind: "user";
  content: string;
  attachments?: TranscriptAttachment[];
  hidden?: boolean;
}

export interface ReasoningRecord {
  id: string;
  timestamp: number;
  kind: "reasoning";
  content: string;
}

export interface ContentRecord {
  id: string;
  timestamp: number;
  kind: "content";
  content: string;
}

export interface ToolRecord {
  id: string;
  timestamp: number;
  kind: "tool";
  name: string;
  status: SegmentStatus;
  providerKind?: string;
  input?: unknown;
  output?: string;
  error?: string;
  durationMs?: number;
  displayTarget?: string;
}

export interface PlanRecord {
  id: string;
  timestamp: number;
  kind: "plan";
  entries: Array<{ content: string; status: PlanEntryStatus }>;
}

export interface FileChangeRecord {
  id: string;
  timestamp: number;
  kind: "fileChange";
  path: string;
  additions?: number;
  deletions?: number;
  status?: SegmentStatus;
}

export interface WorkspaceRecord {
  id: string;
  timestamp: number;
  kind: "workspace";
  files: WorkspaceSegment["files"];
  errors: string[];
  hasPendingBlock?: boolean;
}

export type HistoryRecord =
  | UserRecord
  | ReasoningRecord
  | ContentRecord
  | ToolRecord
  | PlanRecord
  | FileChangeRecord
  | WorkspaceRecord;

export function isUserRecord(record: HistoryRecord): record is UserRecord {
  return record.kind === "user";
}

/** 把消息模型展平为扁平记录数组（user → user 记录；assistant → 每条 segment 一条记录）。 */
export function flattenHistory(messages: readonly TranscriptMessage[]): HistoryRecord[] {
  const records: HistoryRecord[] = [];
  for (const message of messages) {
    if (message.role === "user") {
      records.push({
        id: message.id,
        timestamp: message.timestamp,
        kind: "user",
        content: message.content,
        ...(message.attachments?.length ? { attachments: message.attachments } : {}),
        ...(message.hidden === true ? { hidden: true } : {}),
      });
      continue;
    }
    message.segments.forEach((segment, index) => {
      const record = segmentToRecord(segment, message.id, message.timestamp, index);
      if (record) records.push(record);
    });
  }
  return records;
}

function segmentToRecord(
  segment: TranscriptSegment,
  messageId: string,
  timestamp: number,
  index: number,
): HistoryRecord | null {
  switch (segment.kind) {
    case "reasoning":
      return {
        id: `${messageId}:${index}`,
        timestamp,
        kind: "reasoning",
        content: segment.content,
      };
    case "content":
      return { id: `${messageId}:${index}`, timestamp, kind: "content", content: segment.content };
    case "tool":
      return {
        id: segment.id,
        timestamp,
        kind: "tool",
        name: segment.name,
        status: segment.status,
        ...(segment.providerKind !== undefined ? { providerKind: segment.providerKind } : {}),
        ...(segment.input !== undefined ? { input: segment.input } : {}),
        ...(segment.output !== undefined ? { output: segment.output } : {}),
        ...(segment.error !== undefined ? { error: segment.error } : {}),
        ...(segment.durationMs !== undefined ? { durationMs: segment.durationMs } : {}),
        ...(segment.displayTarget !== undefined ? { displayTarget: segment.displayTarget } : {}),
      };
    case "plan":
      return { id: `${messageId}:${index}`, timestamp, kind: "plan", entries: segment.entries };
    case "fileChange":
      return {
        id: `fc:${segment.path}`,
        timestamp,
        kind: "fileChange",
        path: segment.path,
        ...(segment.additions !== undefined ? { additions: segment.additions } : {}),
        ...(segment.deletions !== undefined ? { deletions: segment.deletions } : {}),
        ...(segment.status !== undefined ? { status: segment.status } : {}),
      };
    case "workspace":
      return {
        id: `${messageId}:${index}`,
        timestamp,
        kind: "workspace",
        files: segment.files,
        errors: segment.errors,
        ...(segment.hasPendingBlock !== undefined
          ? { hasPendingBlock: segment.hasPendingBlock }
          : {}),
      };
    default:
      return null;
  }
}

// ─────────────────────────────────────────────────────────────
// 二次 segmentation：扁平记录 → 消息模型。
//
// - user 记录开启新 user 消息，并关闭当前 assistant 回合；
// - assistant 记录累积到当前 assistant 消息的 segments；
// - 相邻 content / reasoning 记录合并（content 用空行、reasoning 拼接）；
// - tool 按 id upsert、plan 唯一覆盖、fileChange 按 path upsert；
// - content 记录内若含 File Workspace 块，拆成干净的 content + workspace 段。
// ─────────────────────────────────────────────────────────────

/** 把扁平记录重组为消息模型（前后端共用同一套 segmentation）。 */
export function segmentHistory(records: readonly HistoryRecord[]): TranscriptMessage[] {
  const messages: TranscriptMessage[] = [];
  let current: AssistantMessage | null = null;
  let lastUserId = "";

  const closeAssistant = () => {
    if (current && current.segments.length) messages.push(current);
    current = null;
  };

  for (const record of records) {
    if (record.kind === "user") {
      closeAssistant();
      const user: UserMessage = {
        id: record.id,
        timestamp: record.timestamp,
        role: "user",
        content: record.content,
        ...(record.attachments?.length ? { attachments: record.attachments } : {}),
        ...(record.hidden === true ? { hidden: true } : {}),
      };
      messages.push(user);
      lastUserId = record.id;
      continue;
    }

    if (!current) {
      current = {
        id: lastUserId ? `${lastUserId}:assistant` : record.id,
        timestamp: record.timestamp,
        role: "assistant",
        segments: [],
      };
    }
    applyRecordToSegments(current, record);
  }
  closeAssistant();
  return messages;
}

function applyRecordToSegments(message: AssistantMessage, record: HistoryRecord): void {
  const segments = message.segments;
  const previous = segments.at(-1);
  const mergeText = (kind: "content" | "reasoning", text: string, separator: string): void => {
    if (!text) return;
    if (previous?.kind === kind) {
      segments[segments.length - 1] = {
        ...previous,
        content: `${previous.content}${separator}${text}`,
      } as TranscriptSegment;
    } else {
      segments.push({ kind, content: text });
    }
  };

  switch (record.kind) {
    case "reasoning":
      mergeText("reasoning", record.content, "");
      break;
    case "content": {
      const extracted = extractWorkspaceFromContent(record.content);
      if (extracted.hasWorkspaceBlock) {
        if (extracted.markdown.trim()) mergeText("content", extracted.markdown.trim(), "\n\n");
        const workspace: WorkspaceSegment = {
          kind: "workspace",
          files: extracted.files,
          errors: extracted.errors,
          ...(extracted.hasPendingBlock !== undefined
            ? { hasPendingBlock: extracted.hasPendingBlock }
            : {}),
        };
        const workspaceIndex = segments.findIndex((s) => s.kind === "workspace");
        if (workspaceIndex === -1) segments.push(workspace);
        else segments[workspaceIndex] = workspace;
      } else {
        mergeText("content", record.content, "\n\n");
      }
      break;
    }
    case "tool": {
      const tool: Extract<TranscriptSegment, { kind: "tool" }> = {
        kind: "tool",
        id: record.id,
        name: record.name,
        status: record.status,
        ...(record.providerKind !== undefined ? { providerKind: record.providerKind } : {}),
        ...(record.input !== undefined ? { input: record.input } : {}),
        ...(record.output !== undefined ? { output: record.output } : {}),
        ...(record.error !== undefined ? { error: record.error } : {}),
        ...(record.durationMs !== undefined ? { durationMs: record.durationMs } : {}),
        ...(record.displayTarget !== undefined ? { displayTarget: record.displayTarget } : {}),
      };
      const index = segments.findIndex(
        (segment) => segment.kind === "tool" && segment.id === tool.id,
      );
      if (index === -1) segments.push(tool);
      else segments[index] = { ...segments[index], ...tool };
      break;
    }
    case "plan": {
      const plan: TranscriptSegment = { kind: "plan", entries: record.entries };
      const index = segments.findIndex((segment) => segment.kind === "plan");
      if (index === -1) segments.push(plan);
      else segments[index] = plan;
      break;
    }
    case "fileChange": {
      const change: Extract<TranscriptSegment, { kind: "fileChange" }> = {
        kind: "fileChange",
        path: record.path,
        ...(record.additions !== undefined ? { additions: record.additions } : {}),
        ...(record.deletions !== undefined ? { deletions: record.deletions } : {}),
        ...(record.status !== undefined ? { status: record.status } : {}),
      };
      const index = segments.findIndex(
        (segment) => segment.kind === "fileChange" && segment.path === change.path,
      );
      if (index === -1) segments.push(change);
      else segments[index] = { ...segments[index], ...change };
      break;
    }
    case "workspace": {
      const workspace: WorkspaceSegment = {
        kind: "workspace",
        files: record.files,
        errors: record.errors,
        ...(record.hasPendingBlock !== undefined
          ? { hasPendingBlock: record.hasPendingBlock }
          : {}),
      };
      const index = segments.findIndex((segment) => segment.kind === "workspace");
      if (index === -1) segments.push(workspace);
      else segments[index] = workspace;
      break;
    }
    case "user":
      break;
  }
}

// ─────────────────────────────────────────────────────────────
// File Workspace 块解析（opencode 的 <files>...</files> 协议）。
// 供 segmentHistory 把正文里的工作区块拆成 workspace 段。
// ─────────────────────────────────────────────────────────────

export interface ExtractedWorkspaceFile {
  path: string;
  content: string;
  language: string;
  status: "streaming" | "complete";
}

export interface ExtractedWorkspace {
  markdown: string;
  files: ExtractedWorkspaceFile[];
  errors: string[];
  hasWorkspaceBlock: boolean;
  hasPendingBlock: boolean;
}

interface ContentLine {
  start: number;
  contentEnd: number;
  end: number;
  text: string;
}

const FILES_OPEN_TAG = "<files>";
const FILES_CLOSE_TAG = "</files>";
const FILE_CLOSE_TAG = "</file>";
const FILE_OPEN_PATTERN = /^<file\s+path="([^"]+)"(?:\s+language="([^"]+)")?\s*>$/;
const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  cjs: "javascript",
  css: "css",
  csv: "csv",
  html: "html",
  java: "java",
  js: "javascript",
  json: "json",
  jsx: "jsx",
  md: "markdown",
  mjs: "javascript",
  py: "python",
  sh: "bash",
  ts: "typescript",
  tsx: "tsx",
  txt: "text",
  vue: "vue",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
};

function toLines(content: string): ContentLine[] {
  if (!content) return [];
  const lines: ContentLine[] = [];
  let start = 0;
  while (start < content.length) {
    const newline = content.indexOf("\n", start);
    const contentEnd = newline === -1 ? content.length : newline;
    const end = newline === -1 ? content.length : newline + 1;
    const rawText = content.slice(start, contentEnd);
    lines.push({
      start,
      contentEnd,
      end,
      text: rawText.endsWith("\r") ? rawText.slice(0, -1) : rawText,
    });
    start = end;
  }
  return lines;
}

function findOpeningTag(lines: ContentLine[], from: number): ContentLine | undefined {
  let fenceMarker = "";
  for (const line of lines) {
    const trimmed = line.text.trim();
    const fence = trimmed.match(/^(`{3,}|~{3,})/);
    if (fence) {
      const marker = fence[1][0];
      if (!fenceMarker) fenceMarker = marker;
      else if (fenceMarker === marker) fenceMarker = "";
      continue;
    }
    if (!fenceMarker && line.start >= from && trimmed === FILES_OPEN_TAG) return line;
  }
  return undefined;
}

function findExactLine(lines: ContentLine[], value: string, from: number): ContentLine | undefined {
  return lines.find((line) => line.start >= from && line.text.trim() === value);
}

function normalizePath(rawPath: string): string | null {
  const normalized = rawPath
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/{2,}/g, "/");
  const segments = normalized.split("/");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    normalized.length > 240 ||
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    return null;
  }
  return normalized;
}

function inferWorkspaceLanguage(path: string): string {
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  return (LANGUAGE_BY_EXTENSION[extension] ?? extension) || "text";
}

function parseFilesPayload(
  content: string,
  payloadStart: number,
  payloadEnd: number,
  outerComplete: boolean,
): Pick<ExtractedWorkspace, "files" | "errors"> {
  const payload = content.slice(payloadStart, payloadEnd);
  const lines = toLines(payload);
  const files: ExtractedWorkspaceFile[] = [];
  const errors: string[] = [];
  const seenPaths = new Set<string>();
  let lineIndex = 0;

  while (lineIndex < lines.length) {
    const line = lines[lineIndex];
    const trimmed = line.text.trim();
    if (!trimmed) {
      lineIndex += 1;
      continue;
    }

    const openMatch = trimmed.match(FILE_OPEN_PATTERN);
    if (!openMatch) {
      errors.push(`文件协议中存在无法识别的内容：${trimmed.slice(0, 60)}`);
      lineIndex += 1;
      continue;
    }

    const path = normalizePath(openMatch[1]);
    const closeLine = findExactLine(lines, FILE_CLOSE_TAG, line.end);
    const fileEnd = closeLine?.start ?? payload.length;
    const fileContent = payload.slice(line.end, fileEnd).replace(/\r\n/g, "\n").replace(/\n$/, "");

    if (!path) {
      errors.push(`文件路径无效：${openMatch[1]}`);
    } else if (seenPaths.has(path)) {
      errors.push(`文件路径重复：${path}`);
    } else {
      seenPaths.add(path);
      files.push({
        path,
        content: fileContent,
        language: openMatch[2]?.trim() || inferWorkspaceLanguage(path),
        status: closeLine ? "complete" : "streaming",
      });
    }

    if (!closeLine) {
      if (outerComplete) errors.push(`文件 ${path ?? openMatch[1]} 未完整闭合`);
      break;
    }
    lineIndex = lines.indexOf(closeLine) + 1;
  }

  return { files, errors };
}

/** 从正文里解析 File Workspace 块：返回干净的 markdown + 解析出的文件/错误。 */
export function extractWorkspaceFromContent(content: string): ExtractedWorkspace {
  const normalizedContent = content.replace(/\r\n/g, "\n");
  const lines = toLines(normalizedContent);
  const markdownParts: string[] = [];
  const files: ExtractedWorkspaceFile[] = [];
  const errors: string[] = [];
  let cursor = 0;
  let hasWorkspaceBlock = false;
  let hasPendingBlock = false;

  while (cursor < normalizedContent.length) {
    const openLine = findOpeningTag(lines, cursor);
    if (!openLine) break;

    hasWorkspaceBlock = true;
    markdownParts.push(normalizedContent.slice(cursor, openLine.start));
    const closeLine = findExactLine(lines, FILES_CLOSE_TAG, openLine.end);
    const payloadEnd = closeLine?.start ?? normalizedContent.length;
    const parsed = parseFilesPayload(
      normalizedContent,
      openLine.end,
      payloadEnd,
      Boolean(closeLine),
    );
    files.push(...parsed.files);
    errors.push(...parsed.errors);

    if (!closeLine) {
      hasPendingBlock = true;
      cursor = normalizedContent.length;
      break;
    }
    cursor = closeLine.end;
  }

  markdownParts.push(normalizedContent.slice(cursor));
  return {
    markdown: markdownParts.join("").trim(),
    files,
    errors,
    hasWorkspaceBlock,
    hasPendingBlock,
  };
}

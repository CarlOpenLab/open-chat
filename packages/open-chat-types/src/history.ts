import type { WorkspaceMessage } from "./types";

// ─────────────────────────────────────────────────────────────
// File Workspace 块解析（opencode 的 <files>...</files> 协议）。
// 供前端/服务端把正文里的工作区块拆成 workspace 消息。
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

/** 把提取出的工作区内容构造成 workspace 消息（无块时返回 null）。 */
export function extractedToWorkspaceMessage(
  extracted: ExtractedWorkspace,
  id: string,
  timestamp: number,
): WorkspaceMessage | null {
  if (!extracted.hasWorkspaceBlock) return null;
  return {
    id,
    timestamp,
    role: "workspace",
    files: extracted.files,
    errors: extracted.errors,
    ...(extracted.hasPendingBlock !== undefined
      ? { hasPendingBlock: extracted.hasPendingBlock }
      : {}),
  };
}

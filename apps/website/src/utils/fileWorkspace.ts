import { extractWorkspaceFromContent } from "@cc-heart/open-chat-types";
import type { TranscriptSegment } from "@cc-heart/open-chat-types";

type WorkspaceFileStatus = "streaming" | "complete";

interface WorkspaceFile {
  path: string;
  content: string;
  language: string;
  status: WorkspaceFileStatus;
  ownerMessageId?: string;
}

export interface WorkspaceFileDraft {
  path: string;
  baseContent: string;
  content: string;
  updatedAt: number;
}

export interface EditableWorkspaceFile extends WorkspaceFile {
  originalContent: string;
  dirty: boolean;
  hasIncomingChange: boolean;
}

interface WorkspaceDiffStats {
  added: number;
  removed: number;
}

/**
 * 顶栏 `+N -M` 的数据源：把每个 dirty 文件按行做多重集比较，
 * 本地草稿多出的行算新增、AI 版本里消失的行算删除（同一行内容的顺序变化不计）。
 */
export function collectWorkspaceDiffStats(
  files: readonly Pick<EditableWorkspaceFile, "content" | "originalContent" | "dirty">[],
): WorkspaceDiffStats {
  let added = 0;
  let removed = 0;

  for (const file of files) {
    if (!file.dirty) continue;

    const counts = new Map<string, number>();
    for (const line of file.originalContent.split("\n")) {
      counts.set(line, (counts.get(line) ?? 0) + 1);
    }
    for (const line of file.content.split("\n")) {
      const remaining = counts.get(line) ?? 0;
      if (remaining > 0) counts.set(line, remaining - 1);
      else added += 1;
    }
    for (const remaining of counts.values()) {
      removed += remaining;
    }
  }

  return { added, removed };
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

export function isValidWorkspaceFileDraft(value: unknown): value is WorkspaceFileDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<WorkspaceFileDraft>;
  return (
    typeof draft.path === "string" &&
    Boolean(normalizePath(draft.path)) &&
    typeof draft.baseContent === "string" &&
    typeof draft.content === "string" &&
    typeof draft.updatedAt === "number" &&
    Number.isFinite(draft.updatedAt)
  );
}

/** 兼容入口：解析正文里的 File Workspace 块（实现来自共享包）。 */
export function parseFileWorkspaceContent(content: string) {
  return extractWorkspaceFromContent(content);
}

interface FileWorkspaceConversationItem {
  id?: string | number;
  role: string;
  content: unknown;
  /** 扁平活动段（含 workspace 段，历史路径由 segmentHistory 提取）。 */
  segments?: TranscriptSegment[];
}

interface FileWorkspaceState {
  files: WorkspaceFile[];
  errors: string[];
  hasWorkspace: boolean;
  pending: boolean;
}

/**
 * 收集整个会话的 File Workspace：优先读消息的 workspace 段；
 * 对仍把工作区块留在正文里的消息（live 流尚未提取）回退解析 content。
 */
export function collectFileWorkspaceState(
  items: readonly FileWorkspaceConversationItem[],
): FileWorkspaceState {
  const filesByPath = new Map<string, WorkspaceFile>();
  const errors: string[] = [];
  let hasWorkspace = false;
  let pending = false;

  for (const item of items) {
    if (item.role !== "assistant") continue;
    const segments = item.segments ?? [];
    const workspaceSegments = segments.filter(
      (segment): segment is Extract<TranscriptSegment, { kind: "workspace" }> =>
        segment.kind === "workspace",
    );
    if (workspaceSegments.length) {
      hasWorkspace = true;
      for (const workspace of workspaceSegments) {
        if (workspace.hasPendingBlock === true) pending = true;
        errors.push(...workspace.errors);
        for (const file of workspace.files) {
          filesByPath.set(file.path, {
            path: file.path,
            content: file.content ?? "",
            language: file.language ?? "text",
            status: file.status,
            ownerMessageId: String(item.id ?? ""),
          });
        }
      }
      continue;
    }

    // 回退：仍在 content 里的块（live 流尚未拆分）。
    if (typeof item.content !== "string") continue;
    const parsed = parseFileWorkspaceContent(item.content);
    if (!parsed.hasWorkspaceBlock) continue;
    hasWorkspace = true;
    pending = pending || parsed.hasPendingBlock;
    errors.push(...parsed.errors);
    for (const file of parsed.files) {
      filesByPath.set(file.path, { ...file, ownerMessageId: String(item.id ?? "") });
    }
  }

  return { files: [...filesByPath.values()], errors, hasWorkspace, pending };
}

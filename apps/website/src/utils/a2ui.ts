import type { XCardCommand } from "@antdv-next/x-card";

const A2UI_OPEN_TAG = "<a2ui>";
const A2UI_CLOSE_TAG = "</a2ui>";
const A2UI_SUBMISSION_PREFIX = "[表单提交] ";
export const A2UI_SUBMISSION_MESSAGE_KIND = "a2ui-submission";
const FENCE = /^[\t ]{0,3}(`{3,}|~{3,})/;

export interface ParsedA2UIContent {
  markdown: string;
  commands: XCardCommand[];
  errors: string[];
  hasPendingBlock: boolean;
}

export interface A2UIConversationItem {
  content: unknown;
  role?: string;
  status?: string;
}

export interface A2UIConversationState {
  commands: XCardCommand[];
  errors: string[];
  pending: boolean;
}

export interface A2UIActionPayload {
  surfaceId: string;
  surfaceRevision: number;
  ownerMessageId: string;
  name: string;
  context: Record<string, unknown>;
  data: Record<string, unknown>;
}

export interface A2UISubmission {
  submissionId: string;
  conversationId: string;
  ownerMessageId: string;
  surfaceId: string;
  surfaceRevision: number;
  action: {
    name: string;
    context: Record<string, unknown>;
  };
  data: Record<string, unknown>;
  status: "submitted";
  submittedAt: number;
}

export function getA2UISurfaceId(command: XCardCommand): string {
  if ("createSurface" in command) return command.createSurface.surfaceId;
  if ("updateComponents" in command) return command.updateComponents.surfaceId;
  if ("updateDataModel" in command) return command.updateDataModel.surfaceId;
  if ("deleteSurface" in command) return command.deleteSurface.surfaceId;
  if ("surfaceUpdate" in command) return command.surfaceUpdate.surfaceId;
  if ("dataModelUpdate" in command) return command.dataModelUpdate.surfaceId;
  return command.beginRendering.surfaceId;
}

function findOpenTagOutsideCodeFence(content: string, from: number): number {
  let offset = 0;
  let fenceMarker = "";

  for (const line of content.split(/(?<=\n)/)) {
    const lineWithoutNewline = line.replace(/\r?\n$/, "");
    const fence = lineWithoutNewline.match(FENCE)?.[1] ?? "";

    if (fence) {
      if (!fenceMarker) fenceMarker = fence;
      else if (fence[0] === fenceMarker[0] && fence.length >= fenceMarker.length) fenceMarker = "";
    }

    if (!fenceMarker && offset + line.length > from) {
      const tagIndex = lineWithoutNewline.indexOf(A2UI_OPEN_TAG);
      const prefix = tagIndex === -1 ? "" : lineWithoutNewline.slice(0, tagIndex);
      if (tagIndex !== -1 && prefix.trim() === "" && offset + tagIndex >= from) {
        return offset + tagIndex;
      }
    }

    offset += line.length;
  }

  return -1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isValidA2UISubmission(value: unknown): value is A2UISubmission {
  if (!isRecord(value) || !isRecord(value.action) || !isRecord(value.data)) return false;
  return (
    typeof value.submissionId === "string" &&
    value.submissionId.length > 0 &&
    typeof value.conversationId === "string" &&
    typeof value.ownerMessageId === "string" &&
    value.ownerMessageId.length > 0 &&
    typeof value.surfaceId === "string" &&
    value.surfaceId.length > 0 &&
    typeof value.surfaceRevision === "number" &&
    Number.isInteger(value.surfaceRevision) &&
    value.surfaceRevision >= 0 &&
    typeof value.action.name === "string" &&
    value.action.name.length > 0 &&
    isRecord(value.action.context) &&
    value.status === "submitted" &&
    typeof value.submittedAt === "number" &&
    Number.isFinite(value.submittedAt)
  );
}

const UNSAFE_DATA_PATH_SEGMENTS = new Set(["__proto__", "constructor", "prototype"]);

export function createA2UIDataModelSnapshot(
  valuesByPath: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const snapshot: Record<string, unknown> = {};

  Object.entries(valuesByPath).forEach(([path, value]) => {
    if (!path.startsWith("/")) return;
    const segments = path
      .slice(1)
      .split("/")
      .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"));
    if (
      !segments.length ||
      segments.some((segment) => !segment || UNSAFE_DATA_PATH_SEGMENTS.has(segment))
    ) {
      return;
    }

    let target = snapshot;
    segments.forEach((segment, index) => {
      if (index === segments.length - 1) {
        target[segment] = value;
        return;
      }

      const current = target[segment];
      if (!isRecord(current)) target[segment] = {};
      target = target[segment] as Record<string, unknown>;
    });
  });

  return snapshot;
}

function escapeJsonPointerSegment(segment: string): string {
  return segment.replaceAll("~", "~0").replaceAll("/", "~1");
}

export function flattenA2UIDataModelSnapshot(
  snapshot: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const valuesByPath: Record<string, unknown> = {};

  const visit = (value: unknown, segments: string[]) => {
    if (isRecord(value) && Object.keys(value).length > 0) {
      Object.entries(value).forEach(([key, child]) => {
        if (!key || UNSAFE_DATA_PATH_SEGMENTS.has(key)) return;
        visit(child, [...segments, key]);
      });
      return;
    }

    if (segments.length === 0) return;
    valuesByPath[`/${segments.map(escapeJsonPointerSegment).join("/")}`] = value;
  };

  visit(snapshot, []);
  return valuesByPath;
}

export function createA2UISubmission(
  payload: A2UIActionPayload,
  conversationId: string,
  now: number = Date.now(),
): A2UISubmission {
  const randomId = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2, 14);
  return {
    submissionId: `a2ui-${randomId}`,
    conversationId,
    ownerMessageId: payload.ownerMessageId,
    surfaceId: payload.surfaceId,
    surfaceRevision: payload.surfaceRevision,
    action: {
      name: payload.name,
      context: payload.context,
    },
    data: payload.data,
    status: "submitted",
    submittedAt: now,
  };
}

/** Format a form submission as an internal user-context message so the model
 *  can process it. The host persists this message but does not render it as a
 *  chat bubble. */
export function formatA2UISubmissionAsUserMessage(submission: A2UISubmission): string {
  const dataJson = JSON.stringify(submission.data, null, 2);
  return `${A2UI_SUBMISSION_PREFIX}${submission.action.name}\n\n${dataJson}`;
}

/** Identify A2UI submission messages that should remain in model context but
 *  not be rendered as chat bubbles. */
export function isA2UISubmissionContextMessage(
  modelMessage: { role?: unknown },
  extraInfo?: Record<string, unknown>,
): boolean {
  return (
    modelMessage.role === "user" &&
    extraInfo?.kind === A2UI_SUBMISSION_MESSAGE_KIND &&
    extraInfo.hidden === true
  );
}

function validateCommand(value: unknown): value is XCardCommand {
  if (!isRecord(value) || value.version !== "v0.9") return false;

  const commandKeys = [
    "createSurface",
    "updateComponents",
    "updateDataModel",
    "deleteSurface",
  ].filter((key) => key in value);
  if (commandKeys.length !== 1) return false;

  const command = value[commandKeys[0]];
  if (!isRecord(command) || typeof command.surfaceId !== "string" || !command.surfaceId) {
    return false;
  }

  if ("createSurface" in value) {
    return typeof command.catalogId === "string" && command.catalogId.length > 0;
  }
  if ("updateComponents" in value) {
    if (!Array.isArray(command.components)) return false;
    return command.components.every((component) => {
      if (!isRecord(component)) return false;
      if (typeof component.id !== "string" || typeof component.component !== "string") return false;
      if ("child" in component && typeof component.child !== "string") return false;
      if ("children" in component) {
        if (
          !Array.isArray(component.children) ||
          !component.children.every((id) => typeof id === "string")
        ) {
          return false;
        }
      }
      if (
        (component.component === "Card" || component.component === "Button") &&
        (typeof component.child !== "string" || component.child.length === 0)
      ) {
        return false;
      }
      const hasChildren = Array.isArray(component.children) && component.children.length > 0;
      if (
        component.id === "root" &&
        ["Card", "Column", "Row"].includes(component.component) &&
        !component.child &&
        !hasChildren
      ) {
        return false;
      }
      return true;
    });
  }
  if ("updateDataModel" in value) {
    return typeof command.path === "string" && command.path.length > 1;
  }
  return true;
}

function parseCommandBlock(raw: string, blockNumber: number) {
  const errors: string[] = [];
  const commands: XCardCommand[] = [];

  try {
    const parsed: unknown = JSON.parse(raw);
    const values = Array.isArray(parsed) ? parsed : [parsed];

    values.forEach((value, index) => {
      if (validateCommand(value)) commands.push(value);
      else errors.push(`A2UI 块 ${blockNumber} 的第 ${index + 1} 条命令不符合 v0.9 格式`);
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "未知解析错误";
    errors.push(`A2UI 块 ${blockNumber} 不是有效的 JSON：${reason}`);
  }

  return { commands, errors };
}

export function collectCreatedA2UISurfaceIds(items: readonly A2UIConversationItem[]): string[] {
  const surfaceIds = new Set<string>();

  items.forEach((item) => {
    if (
      item.role !== "assistant" ||
      item.status === "loading" ||
      item.status === "updating" ||
      typeof item.content !== "string"
    ) {
      return;
    }

    const parsed = parseA2UIContent(item.content);
    if (parsed.hasPendingBlock) return;

    parsed.commands.forEach((command) => {
      if ("createSurface" in command) surfaceIds.add(command.createSurface.surfaceId);
    });
  });

  return [...surfaceIds];
}

export function appendA2UISurfaceIdContext(
  baseSystemPrompt: string,
  items: readonly A2UIConversationItem[],
): string {
  const usedSurfaceIds = collectCreatedA2UISurfaceIds(items);
  if (usedSurfaceIds.length === 0) return baseSystemPrompt;

  const runtimeContext = `A2UI runtime surface ID rules for the current conversation:
- Surface IDs already used by createSurface: ${JSON.stringify(usedSurfaceIds)}.
- You must not reuse any listed ID in a new createSurface command, even when its form is submitted, locked, or preserved.
- For another instance of a similar surface, keep its semantic prefix and select the next available positive integer suffix, for example ticket-branch-form-2.
- Use the same new surfaceId in every command belonging to the new A2UI block, including action context metadata.
- These runtime rules override any earlier fixed surfaceId instruction or example.`;

  return [baseSystemPrompt.trim(), runtimeContext].filter(Boolean).join("\n\n");
}

export function collectA2UIConversationState(
  items: readonly A2UIConversationItem[],
): A2UIConversationState {
  const commands: XCardCommand[] = [];
  const errors: string[] = [];
  const activeSurfaceIds = new Set<string>();
  let pending = false;

  items.forEach((item) => {
    if (item.role !== "assistant" || typeof item.content !== "string") return;
    const parsed = parseA2UIContent(item.content);
    errors.push(...parsed.errors);
    pending ||= item.status === "loading" && parsed.hasPendingBlock;

    parsed.commands.forEach((command) => {
      const surfaceId = getA2UISurfaceId(command);

      if ("createSurface" in command) {
        if (activeSurfaceIds.has(surfaceId)) {
          errors.push(`A2UI Surface ${surfaceId} 被重复创建`);
          return;
        }
        activeSurfaceIds.add(surfaceId);
      } else if (!activeSurfaceIds.has(surfaceId)) {
        errors.push(`A2UI Surface ${surfaceId} 尚未创建`);
        return;
      }

      commands.push(command);
      if ("deleteSurface" in command) activeSurfaceIds.delete(surfaceId);
    });
  });

  return { commands, errors, pending };
}

export function parseA2UIContent(content: string): ParsedA2UIContent {
  const markdownParts: string[] = [];
  const commands: XCardCommand[] = [];
  const errors: string[] = [];
  let cursor = 0;
  let blockNumber = 0;

  while (cursor < content.length) {
    const tagStart = findOpenTagOutsideCodeFence(content, cursor);

    if (tagStart === -1) {
      markdownParts.push(content.slice(cursor));
      break;
    }

    markdownParts.push(content.slice(cursor, tagStart));
    const payloadStart = tagStart + A2UI_OPEN_TAG.length;
    const closeIndex = content.indexOf(A2UI_CLOSE_TAG, payloadStart);

    if (closeIndex === -1) {
      return {
        markdown: markdownParts.join("").trim(),
        commands,
        errors,
        hasPendingBlock: true,
      };
    }

    blockNumber += 1;
    const parsed = parseCommandBlock(content.slice(payloadStart, closeIndex).trim(), blockNumber);
    commands.push(...parsed.commands);
    errors.push(...parsed.errors);
    cursor = closeIndex + A2UI_CLOSE_TAG.length;
  }

  return {
    markdown: markdownParts.join("").trim(),
    commands,
    errors,
    hasPendingBlock: false,
  };
}

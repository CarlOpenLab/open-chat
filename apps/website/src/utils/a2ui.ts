import type { XCardCommand } from "@antdv-next/x-card";

const A2UI_OPEN_TAG = "<a2ui-json>";
const A2UI_CLOSE_TAG = "</a2ui-json>";
const A2UI_FENCE = /^[\t ]{0,3}```json-a2ui[\t ]*$/i;
const A2UI_FENCE_CLOSE = /^[\t ]{0,3}```[\t ]*$/;
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

interface FencedBlockPosition {
  start: number;
  payloadStart: number;
}

function findA2UIFenceOutsideCodeFence(content: string, from: number): FencedBlockPosition | null {
  let offset = 0;
  let fenceMarker = "";

  for (const line of content.split(/(?<=\n)/)) {
    const lineWithoutNewline = line.replace(/\r?\n$/, "");

    if (!fenceMarker && offset >= from && A2UI_FENCE.test(lineWithoutNewline)) {
      return { start: offset, payloadStart: offset + line.length };
    }

    const fence = lineWithoutNewline.match(FENCE)?.[1] ?? "";
    if (fence) {
      if (!fenceMarker) fenceMarker = fence;
      else if (fence[0] === fenceMarker[0] && fence.length >= fenceMarker.length) fenceMarker = "";
    }

    offset += line.length;
  }

  return null;
}

function findA2UIFenceClose(content: string, payloadStart: number) {
  let offset = payloadStart;

  for (const line of content.slice(payloadStart).split(/(?<=\n)/)) {
    const lineWithoutNewline = line.replace(/\r?\n$/, "");
    if (A2UI_FENCE_CLOSE.test(lineWithoutNewline)) {
      return { closeIndex: offset, endIndex: offset + line.length };
    }
    offset += line.length;
  }

  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
    const fencedStart = findA2UIFenceOutsideCodeFence(content, cursor);
    const useFence = fencedStart !== null && (tagStart === -1 || fencedStart.start < tagStart);
    const blockStart = useFence ? (fencedStart?.start ?? -1) : tagStart;

    if (blockStart === -1) {
      markdownParts.push(content.slice(cursor));
      break;
    }

    markdownParts.push(content.slice(cursor, blockStart));
    const payloadStart = useFence
      ? (fencedStart?.payloadStart ?? content.length)
      : blockStart + A2UI_OPEN_TAG.length;
    const fencedClose = useFence ? findA2UIFenceClose(content, payloadStart) : null;
    const closeIndex = useFence
      ? (fencedClose?.closeIndex ?? -1)
      : content.indexOf(A2UI_CLOSE_TAG, payloadStart);

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
    cursor = useFence
      ? (fencedClose?.endIndex ?? content.length)
      : closeIndex + A2UI_CLOSE_TAG.length;
  }

  return {
    markdown: markdownParts.join("").trim(),
    commands,
    errors,
    hasPendingBlock: false,
  };
}

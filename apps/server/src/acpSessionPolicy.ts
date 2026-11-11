import type { ElicitationSchema } from "@agentclientprotocol/sdk";
import type { SessionEvent } from "@cc-heart/acp-hub-core";
import type { AcpPermissionMode } from "./acpManager";

/** UI 权限档位对应的 ACP 会话模式（Claude 桥接的 mode id）。 */
export function permissionModeToAcpMode(mode: AcpPermissionMode): string {
  switch (mode) {
    case "auto":
      return "acceptEdits";
    case "full":
      return "bypassPermissions";
    case "supervised":
    default:
      return "default";
  }
}

/** 前端问答卡消费的 `chat_question` 负载（form elicitation 的可渲染子集）。 */
export interface ChatQuestionPayload {
  id: string;
  version: "acp";
  agentId: string;
  sessionId: string;
  message: string;
  requestedSchema: ElicitationSchema;
  toolCallId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * 只把 form 模式的 elicitation 转成问答卡：url 模式或缺少 schema 的请求
 * 前端无法渲染，调用方应直接 cancel，避免 Agent 永远等待。
 */
export function toChatQuestionPayload(
  event: Extract<SessionEvent, { type: "elicitation_request" }>,
  context: { id: string; agentId: string; sessionId: string },
): ChatQuestionPayload | null {
  if (event.mode !== "form" || !event.requestedSchema) return null;
  return {
    id: context.id,
    version: "acp",
    agentId: context.agentId,
    sessionId: context.sessionId,
    message: event.message,
    requestedSchema: event.requestedSchema,
    ...(event.toolCallId !== undefined ? { toolCallId: event.toolCallId } : {}),
    ...(event.meta !== undefined ? { metadata: event.meta } : {}),
  };
}

import type { PermissionRequest } from "../../services/OpenChatProvider";
import {
  isElicitationQuestionPayload,
  type ElicitationQuestionPayload,
} from "./elicitationQuestions";

export interface AcpControlEventHandlers {
  /** 收到网关的 chat_permission 事件（ACP 审批请求）。 */
  onPermission: (request: PermissionRequest) => void;
  /** 收到 agent 的结构化提问（form elicitation）。 */
  onQuestion?: (payload: ElicitationQuestionPayload) => void;
  /** 提问已被回答 / 取消 / 随回合结束，撤掉其他标签页里的卡片。 */
  onQuestionResolved?: (id: string, reason: string) => void;
}

const isPermissionRequest = (value: unknown): value is PermissionRequest => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as { id?: unknown; version?: unknown };
  return typeof candidate.id === "string" && candidate.id.length > 0;
};

/**
 * 处理 ACP 会话流里的控制事件：它们不参与正文累积，需要在进入
 * transformMessage 之前分流。返回 true 表示事件已消费。
 *
 * ACP 回合有两条到达路径（发起请求的 SSE 与可重连的 session bus），两条都
 * 必须经过这里，否则权限卡/提问卡会因为其中一条提前 return 而永远不出现。
 */
export function createAcpControlEventRouter(
  handlers: AcpControlEventHandlers,
): (event: string | null, data: string) => boolean {
  return (event, data) => {
    if (
      event !== "chat_permission" &&
      event !== "chat_question" &&
      event !== "chat_question_resolved"
    ) {
      return false;
    }
    try {
      const parsed = JSON.parse(data) as unknown;
      if (event === "chat_permission" && isPermissionRequest(parsed)) {
        handlers.onPermission(parsed);
      } else if (event === "chat_question" && isElicitationQuestionPayload(parsed)) {
        handlers.onQuestion?.(parsed);
      } else if (event === "chat_question_resolved") {
        const resolved = parsed as { id?: unknown; reason?: unknown };
        if (typeof resolved.id === "string" && resolved.id.length > 0) {
          handlers.onQuestionResolved?.(
            resolved.id,
            typeof resolved.reason === "string" ? resolved.reason : "",
          );
        }
      }
    } catch {
      // 畸形的控制事件同样消费掉：交给 transformMessage 只会生成空气泡。
    }
    return true;
  };
}

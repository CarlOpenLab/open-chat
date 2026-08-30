/**
 * 看板会话状态：按任务生命周期把会话归入五列。
 *
 * 真实信号推导（优先级从高到低，与 Chat.vue 的运行状态一一对应）：
 *   1. busyStates（Agent 正在执行本轮）       → running
 *   2. pendingPermission（等待权限确认）      → permission
 *   3. queuedMessages（消息已入队）           → queued
 *   4. 出错 / 手动停止后未继续                → stopped
 *   5. 未发过消息的空会话                      → idle（待开始）
 *   6. 其余                                   → done
 *
 * 手动拖拽 / 抽屉改列写入 statusOverride，仅覆盖「无真实活动」时的归列；
 * 任何真实活动信号出现时自动推导重新生效。再次发送消息会清掉覆盖值
 * （见 Chat.vue sendMessageNow），避免旧拖拽永久劫持后续状态。
 */

export type SessionStatus = "running" | "queued" | "permission" | "idle" | "done" | "stopped";

export const SESSION_STATUS_ORDER: SessionStatus[] = [
  "running",
  "queued",
  "permission",
  "idle",
  "done",
  "stopped",
];

export const SESSION_STATUS_META: Record<SessionStatus, { name: string; hint: string }> = {
  running: { name: "运行中", hint: "Agent 正在执行" },
  queued: { name: "排队中", hint: "消息已入队" },
  permission: { name: "待操作", hint: "需要你确认权限" },
  idle: { name: "待开始", hint: "会话尚未开始" },
  done: { name: "已完成", hint: "本轮任务结束" },
  stopped: { name: "已终止", hint: "出错或手动停止" },
};

export interface SessionStatusInput {
  key?: string | number;
  /** 手动覆盖的状态；拖拽 / 抽屉改列时写入。 */
  statusOverride?: SessionStatus;
  /** 持久化的失败标记：出错或手动停止后未继续。由 Chat.vue 在 error/abort 时写入，成功发送时清除。 */
  lastError?: string | null;
  messages?: unknown;
}

export interface SessionStatusSignals {
  /** 运行中会话表：key → 任务开始时间。 */
  busyStates: Record<string, { startedAt: number }>;
  /** 等待权限确认的会话 key 集合。 */
  permissionKeys: ReadonlySet<string>;
  /** 出错或手动停止、且尚未恢复的会话 key 集合。 */
  stoppedKeys: ReadonlySet<string>;
}

const hasQueuedMessages = (conversation: unknown): boolean => {
  if (!conversation || typeof conversation !== "object") return false;
  if (!("queuedMessages" in conversation)) return false;
  const queue = conversation.queuedMessages;
  return Array.isArray(queue) && queue.length > 0;
};

/** 全新会话（从未发过消息）：无任何运行信号时归为「待开始」而非「已完成」。 */
const hasNoMessages = (conversation: unknown): boolean => {
  if (!conversation || typeof conversation !== "object") return true;
  const obj = conversation as Record<string, unknown>;
  const messages = obj.messages;
  if (Array.isArray(messages) && messages.length > 0) return false;
  // 本地不再持久化消息内容：已同步到网关的会话（有 providerSessionId）刷新后
  // 内容由接口恢复，不应归为「待开始」。
  return !(typeof obj.providerSessionId === "string" && obj.providerSessionId.trim().length > 0);
};

/**
 * 持久错误判断：lastError 字段或消息中的 chatError。
 * - 优先以 lastError 为准（新数据，精确反映最新一轮是否失败）
 * - 兼容旧数据：无 lastError 时仅检查最后一条 assistant 消息是否含 chatError，避免历史错误导致永久已终止
 */
export function hasPersistedError(conversation: unknown): boolean {
  if (!conversation || typeof conversation !== "object") return false;
  const obj = conversation as Record<string, unknown>;
  if ("lastError" in obj) {
    const lastError = obj.lastError;
    if (typeof lastError === "string" && lastError.trim().length > 0) return true;
    if (lastError === "" || lastError === null) return false;
  }
  if (!("messages" in obj)) return false;
  const messages = obj.messages;
  if (!Array.isArray(messages) || messages.length === 0) return false;
  const reversed = [...messages].reverse();
  const lastAssistant = reversed.find((item) => {
    if (!item || typeof item !== "object" || !("message" in item)) return false;
    const message = item.message;
    if (!message || typeof message !== "object" || !("role" in message)) return false;
    const role = message.role;
    return role === "assistant";
  });
  if (!lastAssistant || typeof lastAssistant !== "object") return false;
  if ("message" in lastAssistant) {
    const message = lastAssistant.message;
    if (message && typeof message === "object" && "chatError" in message) {
      const chatError = message.chatError;
      if (typeof chatError === "string" && chatError.trim()) return true;
    }
  }
  if ("extraInfo" in lastAssistant) {
    const extraInfo = lastAssistant.extraInfo;
    if (extraInfo && typeof extraInfo === "object" && "chatError" in extraInfo) {
      const chatError = extraInfo.chatError;
      if (typeof chatError === "string" && chatError.trim()) return true;
    }
  }
  if ("status" in lastAssistant && lastAssistant.status === "error") return true;
  return false;
}

const conversationKeyOf = (conversation: SessionStatusInput): string =>
  String(conversation.key ?? "");

/**
 * 自动推导 + 覆盖合并。真实活动信号（运行 / 权限 / 队列）永远压过覆盖值：
 * 拖拽只决定空闲会话的归列，不能掩盖正在发生的任务状态。
 * 持久错误（lastError / 消息中的 chatError）视为真实活动，优先于手动覆盖，以保证出错会话自动归入已终止。
 */
export function deriveBoardStatus(
  conversation: SessionStatusInput & { queuedMessages?: unknown },
  signals: SessionStatusSignals,
): SessionStatus {
  const key = conversationKeyOf(conversation);
  if (signals.busyStates[key]) return "running";
  if (signals.permissionKeys.has(key)) return "permission";
  if (hasQueuedMessages(conversation)) return "queued";
  if (hasPersistedError(conversation)) return "stopped";
  if (conversation.statusOverride) return conversation.statusOverride;
  if (signals.stoppedKeys.has(key)) return "stopped";
  // 新建会话未发过消息：显示「待开始」，不误标为已完成
  if (hasNoMessages(conversation)) return "idle";
  return "done";
}

/**
 * 持久错误判断：lastError 字段或消息中的 chatError。
 * - 优先以 lastError 为准（新数据，精确反映最新一轮是否失败）
 * - 兼容旧数据：无 lastError 时仅检查最后一条 assistant 消息是否含 chatError，避免历史错误导致永久误判
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

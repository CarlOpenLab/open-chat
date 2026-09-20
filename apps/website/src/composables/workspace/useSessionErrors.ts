import type { DefaultMessageInfo, XModelMessage } from "@antdv-next/x-sdk";
import type { Ref } from "vue";
import type { WebSearchSourceItem } from "../../services/ai";
import { WEB_SEARCHING_MARKER } from "../../services/OpenChatProvider";
import type { OpenChatConversation } from "../useChatPersistence";

/** 会话运行的错误态：只需要读出 errorText（运行表由容器持有）。 */
export interface SessionRunErrorLike {
  errorText?: string | null;
}

export interface UseSessionErrorsDeps {
  conversationList: Ref<OpenChatConversation[]>;
  currentConversationKey: Ref<string>;
  /** 流式期间累积的搜索来源：当前会话一份 + 按会话 key 的映射。 */
  pendingSearchSources: Ref<WebSearchSourceItem[] | null>;
  pendingSearchSourcesMap: Map<string, WebSearchSourceItem[]>;
  activeSessionRuns: Map<string, SessionRunErrorLike>;
  persistMessageTimings: (
    conversationKey: string,
    source: DefaultMessageInfo<XModelMessage>[],
  ) => DefaultMessageInfo<XModelMessage>[];
  schedulePersistState: () => void;
}

/**
 * 会话错误态与搜索来源归属：写/清 lastError（含最后一条 assistant 上的
 * chatError）、推导错误文案、把流式搜索来源挂到最后一条 assistant 消息。
 */
export function useSessionErrors(deps: UseSessionErrorsDeps) {
  /** Attach sources received mid-stream to the assistant message that produced them. */
  const attachPendingSearchSources = (conversationKey?: string) => {
    const targetKey = conversationKey || deps.currentConversationKey.value;
    if (!targetKey) return;
    const sources = deps.pendingSearchSourcesMap.get(targetKey) ?? deps.pendingSearchSources.value;
    deps.pendingSearchSourcesMap.delete(targetKey);
    deps.pendingSearchSources.value = null;
    if (!sources || sources.length === 0) return;
    const conv = deps.conversationList.value.find((item) => String(item.key) === targetKey);
    if (!conv || !conv.messages?.length) return;
    const msgs = [...conv.messages];
    const lastAssistantIdx = msgs.map((m) => m.message.role).lastIndexOf("assistant");
    if (lastAssistantIdx !== -1) {
      const target = msgs[lastAssistantIdx];
      msgs[lastAssistantIdx] = {
        ...target,
        extraInfo: { ...target.extraInfo, webSearchResults: sources },
      };
      conv.messages = deps.persistMessageTimings(targetKey, msgs);
      deps.schedulePersistState();
    }
  };

  const setConversationLastError = (conversationKey: string, errorMessage: string) => {
    const conv = deps.conversationList.value.find((item) => String(item.key) === conversationKey);
    if (!conv) return;
    conv.lastError = errorMessage.trim() ? errorMessage.trim().slice(0, 2000) : "请求失败";
    if (conv.statusOverride) conv.statusOverride = "";
    // 确保抽屉打开时能看到与聊天一致的红色错误条：给最后一条 assistant 消息补 chatError
    if (conv.messages?.length) {
      const lastAssistant = [...conv.messages]
        .reverse()
        .find((item) => item.message.role === "assistant");
      if (lastAssistant) {
        const msg = lastAssistant.message as unknown as Record<string, unknown>;
        const extra = (lastAssistant.extraInfo as Record<string, unknown> | undefined) ?? {};
        if (typeof msg.chatError !== "string" || !msg.chatError) {
          msg.chatError = conv.lastError;
        }
        if (typeof extra.chatError !== "string" || !extra.chatError) {
          lastAssistant.extraInfo = { ...extra, chatError: conv.lastError };
        }
      }
    }
    conv.updatedAt = Date.now();
    deps.schedulePersistState();
  };

  const clearConversationLastError = (conversationKey: string) => {
    const conv = deps.conversationList.value.find((item) => String(item.key) === conversationKey);
    if (!conv) return;
    const hadError = Boolean(conv.lastError);
    if ("lastError" in conv) delete conv.lastError;
    // 同步清理最后一条 assistant 消息上的 chatError，避免历史错误导致 hasPersistedError 误判
    if (conv.messages?.length) {
      const lastAssistant = [...conv.messages].reverse().find((item) => {
        if (!item || typeof item !== "object" || !("message" in item)) return false;
        const message = item.message;
        if (!message || typeof message !== "object" || !("role" in message)) return false;
        const role = message.role;
        return role === "assistant";
      });
      if (lastAssistant && typeof lastAssistant === "object") {
        let changed = false;
        if ("message" in lastAssistant) {
          const message = lastAssistant.message;
          if (message && typeof message === "object" && "chatError" in message) {
            const chatError = message.chatError;
            if (typeof chatError === "string" && chatError.trim()) {
              delete (message as Record<string, unknown>).chatError;
              changed = true;
            }
          }
        }
        if ("extraInfo" in lastAssistant) {
          const extraInfo = lastAssistant.extraInfo;
          if (extraInfo && typeof extraInfo === "object" && "chatError" in extraInfo) {
            const chatError = extraInfo.chatError;
            if (typeof chatError === "string" && chatError.trim()) {
              const nextExtra = { ...(extraInfo as Record<string, unknown>) };
              delete nextExtra.chatError;
              lastAssistant.extraInfo = Object.keys(nextExtra).length
                ? (nextExtra as never)
                : undefined;
              changed = true;
            }
          }
        }
        if (hadError || changed) deps.schedulePersistState();
        return;
      }
    }
    if (hadError) deps.schedulePersistState();
  };

  const getConversationErrorMessage = (key: string): string => {
    const run = deps.activeSessionRuns.get(key);
    if (run?.errorText) return run.errorText;
    const conv = deps.conversationList.value.find((item) => String(item.key) === key);
    if (conv?.messages?.length) {
      const lastAssistant = [...conv.messages]
        .reverse()
        .find((item) => item.message.role === "assistant");
      if (lastAssistant) {
        const msg = lastAssistant.message as unknown as { chatError?: unknown; content?: unknown };
        if (typeof msg.chatError === "string" && msg.chatError.trim()) return msg.chatError.trim();
        const extraInfo = lastAssistant.extraInfo as { chatError?: unknown } | undefined;
        if (extraInfo && typeof extraInfo.chatError === "string" && extraInfo.chatError.trim()) {
          return extraInfo.chatError.trim();
        }
        if (typeof msg.content === "string" && msg.content.trim()) {
          const text = msg.content.trim();
          if (text !== WEB_SEARCHING_MARKER && text.length > 0) return text.slice(0, 2000);
        }
      }
    }
    return run?.errorText || "请求失败";
  };

  return {
    attachPendingSearchSources,
    setConversationLastError,
    clearConversationLastError,
    getConversationErrorMessage,
  };
}

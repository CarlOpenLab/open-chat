import type { ConversationItemType } from "@antdv-next/x";
import type { DefaultMessageInfo, XModelMessage } from "@antdv-next/x-sdk";
import { message } from "antdv-next";
import { onBeforeUnmount, watch, type Ref } from "vue";
import type { AssistantConversationSnapshot } from "../features/assistant-market/types";
import {
  clearChatState,
  normalizePersistedChatState,
  saveChatState,
  type PersistedChatState,
  type PersistedConversation,
} from "../services/chatStorage";
import { isA2UISubmissionContextMessage, type A2UISubmission } from "../utils/a2ui";
import type { WorkspaceFileDraft } from "../utils/fileWorkspace";

export interface OpenChatConversation extends ConversationItemType {
  messages?: DefaultMessageInfo<XModelMessage>[];
  a2uiSubmissions?: A2UISubmission[];
  workspaceDrafts?: WorkspaceFileDraft[];
  systemPrompt?: string;
  assistant?: AssistantConversationSnapshot;
}

export const getMessagePreview = (content: string, maxLength: number = 20): string => {
  const normalized = content.replace(/\s+/g, " ").trim();
  if (!normalized) return "新对话";
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
};

interface UseChatPersistenceOptions {
  conversationList: Ref<OpenChatConversation[]>;
  currentConversationKey: Ref<string>;
  currentModel: Ref<string>;
  showWelcome: Ref<boolean>;
  isHydrating: Ref<boolean>;
  activeRequestConversationKey: Ref<string>;
  isRequesting: Ref<boolean>;
  setMessages: (messages: DefaultMessageInfo<XModelMessage>[]) => void;
  reconcileCurrentModel: () => void;
}

/**
 * 会话持久化：负责本地聊天记录的防抖保存、恢复、导入导出与清空。
 */
export function useChatPersistence(options: UseChatPersistenceOptions) {
  const {
    conversationList,
    currentConversationKey,
    currentModel,
    showWelcome,
    isHydrating,
    activeRequestConversationKey,
    isRequesting,
    setMessages,
    reconcileCurrentModel,
  } = options;

  let persistTimer: ReturnType<typeof setTimeout> | null = null;

  const toPersistedConversations = (list: OpenChatConversation[]): PersistedConversation[] => {
    return list
      .filter((conversation) => {
        const messages = Array.isArray(conversation.messages) ? conversation.messages : [];
        return messages.length > 0;
      })
      .map((conversation, index) => {
        const normalizedLabel =
          typeof conversation.label === "string" && conversation.label.trim()
            ? conversation.label
            : "新对话";
        const normalizedGroup =
          typeof conversation.group === "string" ? conversation.group : "今天";

        const messages = Array.isArray(conversation.messages) ? conversation.messages : [];
        const normalizedMessages = messages.map((item, messageIndex) => {
          const fallbackId = `${Date.now()}-${index}-${messageIndex}`;
          return {
            id: item.id ?? fallbackId,
            status: item.status,
            message:
              typeof item.message === "object" && item.message !== null
                ? { ...item.message }
                : ({ role: "assistant", content: String(item.message ?? "") } as XModelMessage),
            ...(item.extraInfo ? { extraInfo: item.extraInfo } : {}),
          };
        });

        return {
          key: String(conversation.key),
          label: normalizedLabel,
          group: normalizedGroup,
          ...(typeof conversation.updatedAt === "number"
            ? { updatedAt: conversation.updatedAt }
            : {}),
          messages: normalizedMessages,
          a2uiSubmissions: Array.isArray(conversation.a2uiSubmissions)
            ? conversation.a2uiSubmissions
            : [],
          workspaceDrafts: Array.isArray(conversation.workspaceDrafts)
            ? conversation.workspaceDrafts
            : [],
          systemPrompt:
            typeof conversation.systemPrompt === "string" ? conversation.systemPrompt : "",
          ...(conversation.assistant ? { assistant: conversation.assistant } : {}),
        };
      });
  };

  const resetToDraftConversation = () => {
    activeRequestConversationKey.value = "";
    conversationList.value = [];
    currentConversationKey.value = "";
    showWelcome.value = true;
  };

  const applyPersistedState = (persistedState: PersistedChatState) => {
    conversationList.value = persistedState.conversationList.map((conv) => {
      if (conv.label === "默认对话") {
        if (conv.messages?.length) {
          const firstUserMessage = conv.messages.find(
            (m) =>
              m.message.role === "user" && !isA2UISubmissionContextMessage(m.message, m.extraInfo),
          );
          if (firstUserMessage && typeof firstUserMessage.message.content === "string") {
            // 注：PersistedConversation 的 Omit + 索引签名使 key 丢失已知类型，
            // 显式重申 key（值与展开结果一致），无运行时差异。
            return {
              ...conv,
              key: conv.key,
              label: getMessagePreview(firstUserMessage.message.content),
            };
          }
        }
        return { ...conv, key: conv.key, label: "新对话" };
      }
      return {
        ...conv,
        key: String(conv.key),
        label: typeof conv.label === "string" && conv.label.trim() ? conv.label : "新对话",
      };
    });
    currentModel.value = persistedState.currentModel;
    reconcileCurrentModel();

    // 导入后保持草稿态，历史会话保留在侧栏供手动打开
    currentConversationKey.value = "";
    setMessages([]);
    showWelcome.value = true;
  };

  const schedulePersistState = () => {
    if (isHydrating.value) return;

    if (persistTimer) {
      clearTimeout(persistTimer);
    }

    persistTimer = setTimeout(() => {
      const state = {
        version: 2 as const,
        currentConversationKey: currentConversationKey.value,
        currentModel: currentModel.value,
        conversationList: toPersistedConversations(conversationList.value),
      };
      void saveChatState(state);
    }, 250);
  };

  const handleClearLocalHistory = async () => {
    const confirmed = window.confirm("确定清空本地聊天记录吗？此操作不可恢复。");
    if (!confirmed) return;

    if (isRequesting.value) {
      message.warning("回答生成中，请先手动停止后再清空历史");
      return;
    }

    await clearChatState();
    resetToDraftConversation();
  };

  const handleExportLocalHistory = () => {
    const state: PersistedChatState = {
      version: 2,
      currentConversationKey: currentConversationKey.value,
      currentModel: currentModel.value,
      conversationList: toPersistedConversations(conversationList.value),
    };
    const payload = JSON.stringify(state, null, 2);
    const blob = new Blob([payload], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const link = document.createElement("a");
    link.href = url;
    link.download = `open-chat-logs-${timestamp}.json`;
    link.click();
    URL.revokeObjectURL(url);
    message.success("日志导出成功");
  };

  const handleImportLocalHistory = async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".json")) {
      message.error("仅支持导入 JSON 日志文件");
      return;
    }

    const shouldOverwrite = window.confirm("导入会覆盖当前本地聊天记录，是否继续？");
    if (!shouldOverwrite) return;

    try {
      const text = await file.text();
      const raw = JSON.parse(text) as unknown;
      const importedState = normalizePersistedChatState(raw);

      if (!importedState) {
        message.error("日志文件格式不正确，导入失败");
        return;
      }

      if (isRequesting.value) {
        message.warning("回答生成中，请先手动停止后再导入日志");
        return;
      }

      applyPersistedState(importedState);
      await saveChatState({
        ...importedState,
        currentConversationKey: "",
        conversationList: toPersistedConversations(conversationList.value),
      });
      message.success(`日志导入成功，共 ${conversationList.value.length} 条会话`);
    } catch (error) {
      console.error("Failed to import chat history:", error);
      message.error("日志导入失败，请检查文件内容");
    }
  };

  // 监听模型变化，持久化选择（model 通过 onRequest 按请求传入，无需重建 provider）
  watch(currentModel, () => {
    schedulePersistState();
  });

  watch(
    [conversationList, currentConversationKey],
    () => {
      schedulePersistState();
    },
    { deep: true },
  );

  onBeforeUnmount(() => {
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
  });

  return {
    toPersistedConversations,
    resetToDraftConversation,
    applyPersistedState,
    schedulePersistState,
    handleClearLocalHistory,
    handleExportLocalHistory,
    handleImportLocalHistory,
  };
}

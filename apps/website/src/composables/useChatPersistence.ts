import type { ConversationItemType } from "@antdv-next/x";
import type { DefaultMessageInfo, XModelMessage } from "@antdv-next/x-sdk";
import { message } from "antdv-next";
import { onBeforeUnmount, watch, type Ref } from "vue";
import {
  clearChatState,
  saveChatState,
  type PersistedChatState,
  type PersistedConversation,
  type QueuedChatMessage,
} from "../services/chatStorage";
import { isHiddenModelMessage } from "../services/transcript";
import type { WorkspaceFileDraft } from "../utils/fileWorkspace";

export interface OpenChatConversation extends ConversationItemType {
  /** 会话所属兼容层供应商；历史数据缺省时归入 API。 */
  agentId?: string;
  /** 创建会话时使用的模型；历史数据缺省时由当前模型补齐。 */
  modelId?: string;
  messages?: DefaultMessageInfo<XModelMessage>[];
  workspaceDrafts?: WorkspaceFileDraft[];
  queuedMessages?: QueuedChatMessage[];
  queuePaused?: boolean;
  systemPrompt?: string;
  projectPath?: string;
  /** 看板手动归列的覆盖状态；缺省时按运行信号自动推导。 */
  statusOverride?: string;
  /** 出错或手动停止的持久标记，用于看板已终止归类。 */
  lastError?: string;
}

export const getMessagePreview = (content: string, maxLength: number = 20): string => {
  const withoutThink = content
    .replace(/<think\b[^>]*>[\s\S]*?(?:<\/think\s*>|$)/gi, "")
    .replace(/<\/?think(?:\s+[^>]*)?\s*>/gi, "");
  const normalized = withoutThink.replace(/\s+/g, " ").trim();
  if (!normalized && /<think\b/i.test(content)) return "思考中...";
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
  /** 会话被重置为草稿态（清空历史后）时同步 URL */
  onResetToDraft?: () => void;
}

/**
 * 会话持久化：负责本地聊天记录的防抖保存、恢复、导出与清空。
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
    onResetToDraft,
  } = options;

  let persistTimer: ReturnType<typeof setTimeout> | null = null;

  const toPersistedConversations = (list: OpenChatConversation[]): PersistedConversation[] => {
    return list
      .filter((conversation) =>
        // 侧栏/任务抽屉中的会话都是用户明确创建的（含未发过消息的新会话，
        // 如任务「新建会话」），全部持久化，刷新后不丢失。
        Boolean(String(conversation.key ?? "").trim()),
      )
      .map((conversation) => {
        const normalizedLabel =
          typeof conversation.label === "string" && conversation.label.trim()
            ? conversation.label
            : "新对话";
        const normalizedGroup =
          typeof conversation.group === "string" ? conversation.group : "今天";

        // 消息内容不落本地：会话内容由网关按 sessionId 拉取（refreshAcpSession
        // → loadAcpSession）。这里只持久化会话索引与关键元数据，避免长回合内容
        // 反复全量写入 IndexedDB（旧实现单会话可膨胀到数 MB、刷新恢复还占内存）。
        return {
          key: String(conversation.key),
          label: normalizedLabel,
          group: normalizedGroup,
          ...(typeof conversation.updatedAt === "number"
            ? { updatedAt: conversation.updatedAt }
            : {}),
          workspaceDrafts: Array.isArray(conversation.workspaceDrafts)
            ? conversation.workspaceDrafts
            : [],
          queuedMessages: Array.isArray(conversation.queuedMessages)
            ? conversation.queuedMessages
            : [],
          ...(conversation.queuePaused ? { queuePaused: true } : {}),
          systemPrompt:
            typeof conversation.systemPrompt === "string" ? conversation.systemPrompt : "",
          ...(typeof conversation.projectPath === "string" && conversation.projectPath.trim()
            ? { projectPath: conversation.projectPath.trim() }
            : {}),
          ...(typeof conversation.providerSessionId === "string" &&
          conversation.providerSessionId.trim()
            ? { providerSessionId: conversation.providerSessionId.trim() }
            : {}),
          ...(typeof conversation.statusOverride === "string" && conversation.statusOverride
            ? { statusOverride: conversation.statusOverride }
            : {}),
          ...(typeof conversation.lastError === "string" && conversation.lastError.trim()
            ? { lastError: conversation.lastError.trim() }
            : {}),
          agentId:
            typeof conversation.agentId === "string" && conversation.agentId
              ? conversation.agentId
              : "api",
          modelId:
            typeof conversation.modelId === "string" && conversation.modelId
              ? conversation.modelId
              : currentModel.value,
        };
      });
  };
  const resetToDraftConversation = () => {
    activeRequestConversationKey.value = "";
    conversationList.value = [];
    currentConversationKey.value = "";
    showWelcome.value = true;
    notifyResetToDraft();
  };

  /**
   * 兼容旧数据：早期「任务新建会话」未写入 updatedAt（已修复）。会话 key 内嵌
   * 创建时间戳（`acp:{agentId}:{ts}-{rand}` / `{ts}-{rand}`），据此回填，
   * 保证抽屉内按创建时间排序并显示时间戳，而不是落在列表末尾。
   */
  const creationTimestampFromKey = (key: string): number | undefined => {
    const part =
      String(key ?? "")
        .split(":")
        .pop() ?? "";
    const match = part.match(/^(\d+)/);
    return match ? Number(match[1]) : undefined;
  };

  const applyPersistedState = (persistedState: PersistedChatState) => {
    conversationList.value = persistedState.conversationList.map((conv) => {
      const normalizedUpdatedAt =
        typeof conv.updatedAt === "number" && Number.isFinite(conv.updatedAt)
          ? conv.updatedAt
          : creationTimestampFromKey(String(conv.key));
      const withUpdatedAt = {
        ...conv,
        ...(normalizedUpdatedAt ? { updatedAt: normalizedUpdatedAt } : {}),
      };
      if (conv.label === "默认对话") {
        if (conv.messages?.length) {
          const firstUserMessage = conv.messages.find(
            (m) => m.message.role === "user" && !isHiddenModelMessage(m.message, m.extraInfo),
          );
          if (firstUserMessage && typeof firstUserMessage.message.content === "string") {
            // 注：PersistedConversation 的 Omit + 索引签名使 key 丢失已知类型，
            // 显式重申 key（值与展开结果一致），无运行时差异。
            return {
              ...withUpdatedAt,
              key: conv.key,
              label: getMessagePreview(firstUserMessage.message.content),
            };
          }
        }
        return { ...withUpdatedAt, key: conv.key, label: "新对话" };
      }
      return {
        ...withUpdatedAt,
        key: String(conv.key),
        agentId: typeof conv.agentId === "string" && conv.agentId ? conv.agentId : "api",
        modelId:
          typeof conv.modelId === "string" && conv.modelId ? conv.modelId : currentModel.value,
        ...(typeof conv.projectPath === "string" && conv.projectPath.trim()
          ? { projectPath: conv.projectPath.trim() }
          : {}),
        ...(typeof conv.providerSessionId === "string" && conv.providerSessionId.trim()
          ? { providerSessionId: conv.providerSessionId.trim() }
          : {}),
        label: typeof conv.label === "string" && conv.label.trim() ? conv.label : "新对话",
      };
    });
    currentModel.value = persistedState.currentModel;
    reconcileCurrentModel();

    // 恢复后保持草稿态，历史会话保留在侧栏供手动打开
    currentConversationKey.value = "";
    setMessages([]);
    showWelcome.value = true;
    notifyResetToDraft();
  };

  /**
   * 重置为草稿态时同步 URL。挂载恢复期间跳过：此时 URL 尚未就绪，
   * onMounted 会按初始 URL 恢复会话。
   */
  const notifyResetToDraft = () => {
    if (isHydrating.value) return;
    onResetToDraft?.();
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
    // 轻量索引导出：仅含本地会话 id 与供应商会话路径，不含消息内容
    const conversations = conversationList.value.map((conversation) => {
      const messages = Array.isArray(conversation.messages) ? conversation.messages : [];
      return {
        key: String(conversation.key),
        label:
          typeof conversation.label === "string" && conversation.label.trim()
            ? conversation.label.trim()
            : "新对话",
        group: typeof conversation.group === "string" ? conversation.group : "今天",
        agentId:
          typeof conversation.agentId === "string" && conversation.agentId
            ? conversation.agentId
            : "api",
        modelId:
          typeof conversation.modelId === "string" && conversation.modelId
            ? conversation.modelId
            : currentModel.value,
        ...(typeof conversation.providerSessionId === "string" &&
        conversation.providerSessionId.trim()
          ? { providerSessionId: conversation.providerSessionId.trim() }
          : {}),
        ...(typeof conversation.projectPath === "string" && conversation.projectPath.trim()
          ? { projectPath: conversation.projectPath.trim() }
          : {}),
        ...(typeof conversation.updatedAt === "number"
          ? { updatedAt: conversation.updatedAt }
          : {}),
        messageCount: messages.length,
      };
    });

    const payload = JSON.stringify(
      {
        version: 1 as const,
        exportedAt: new Date().toISOString(),
        conversations,
      },
      null,
      2,
    );
    const blob = new Blob([payload], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const link = document.createElement("a");
    link.href = url;
    link.download = `open-chat-index-${timestamp}.json`;
    link.click();
    URL.revokeObjectURL(url);
    message.success(`索引导出成功，共 ${conversations.length} 条会话`);
  };

  // 监听模型变化，持久化选择（model 通过 onRequest 按请求传入，无需重建 provider）
  watch(currentModel, () => {
    schedulePersistState();
  });

  watch(
    [conversationList, currentConversationKey],
    () => {
      // 流式期间每个 chunk 都会替换 messages（触发 deep watch），若每 250ms
      // 全量深拷贝+序列化+写 IndexedDB，长回合会把写入队列与内存双双打爆。
      // 回合运行期间跳过，回合结束时 finalizeSessionRun 会落一次持久化。
      if (!isRequesting.value) schedulePersistState();
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
  };
}

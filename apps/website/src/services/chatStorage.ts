import type { ConversationItemType } from "@antdv-next/x";
import type { DefaultMessageInfo, XModelMessage } from "@antdv-next/x-sdk";
import { isValidWorkspaceFileDraft, type WorkspaceFileDraft } from "../utils/fileWorkspace";
import { deleteLocalValue, readLocalValue, writeLocalValue } from "./localDatabase";
import type { UploadedAttachment } from "./ai";

const CHAT_STATE_KEY = "chat-state-v1";

export interface QueuedChatMessage {
  id: string;
  content: string;
  createdAt: number;
  attachments?: UploadedAttachment[];
}

export interface PersistedConversation extends Omit<ConversationItemType, "messages"> {
  /** 看板手动归列的覆盖状态（sessionStatus.SessionStatus）。 */
  statusOverride?: string;
  /** 出错或手动停止的持久标记，用于看板已终止归类与刷新后保留。 */
  lastError?: string;
  agentId?: string;
  modelId?: string;
  /**
   * 本地不再持久化消息内容：AI 会话内容由网关按 sessionId 拉取
   * （loadAcpSession），IndexedDB 只保存会话索引与关键元数据。
   * 读取旧数据时兼容保留 messages（normalizePersistedChatState）。
   */
  messages?: DefaultMessageInfo<XModelMessage>[];
  workspaceDrafts?: WorkspaceFileDraft[];
  queuedMessages?: QueuedChatMessage[];
  queuePaused?: boolean;
  systemPrompt?: string;
  projectPath?: string;
  providerSessionId?: string;
}

function normalizeQueuedMessage(value: unknown): QueuedChatMessage | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<QueuedChatMessage>;
  const attachments = Array.isArray(item.attachments)
    ? item.attachments.flatMap((attachment) => {
        if (!attachment || typeof attachment !== "object") return [];
        const candidate = attachment as Partial<UploadedAttachment>;
        if (
          typeof candidate.reference !== "string" ||
          !candidate.reference.trim() ||
          typeof candidate.name !== "string" ||
          !candidate.name.trim()
        ) {
          return [];
        }
        return [
          {
            reference: candidate.reference.trim(),
            name: candidate.name.trim(),
            isImage: candidate.isImage === true,
          },
        ];
      })
    : [];
  const content = typeof item.content === "string" ? item.content.trim() : "";
  if (!content && attachments.length === 0) return null;
  return {
    id:
      typeof item.id === "string" && item.id.trim()
        ? item.id.trim()
        : `queued-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    content,
    createdAt:
      typeof item.createdAt === "number" && Number.isFinite(item.createdAt)
        ? item.createdAt
        : Date.now(),
    ...(attachments.length ? { attachments } : {}),
  };
}

export interface PersistedChatState {
  version: 2;
  currentConversationKey: string;
  currentModel: string;
  conversationList: PersistedConversation[];
}

interface PersistedChatStateInput {
  version: 1 | 2;
  currentConversationKey: string | number;
  currentModel: string;
  conversationList: PersistedConversation[];
}

function isValidPersistedState(value: unknown): value is PersistedChatStateInput {
  if (!value || typeof value !== "object") return false;

  const state = value as Partial<PersistedChatStateInput>;
  const validCurrentConversationKey =
    typeof state.currentConversationKey === "string" ||
    typeof state.currentConversationKey === "number";

  return (
    (state.version === 1 || state.version === 2) &&
    validCurrentConversationKey &&
    typeof state.currentModel === "string" &&
    Array.isArray(state.conversationList)
  );
}

export function normalizePersistedChatState(value: unknown): PersistedChatState | null {
  if (!isValidPersistedState(value)) return null;

  return {
    version: 2,
    currentConversationKey: String(value.currentConversationKey),
    currentModel: value.currentModel,
    conversationList: value.conversationList.map((conversation) => {
      const {
        assistant: _assistant,
        systemPrompt,
        projectPath,
        providerSessionId,
        queuedMessages,
        queuePaused,
        ...persistedConversation
      } = conversation;
      const normalizedQueue = Array.isArray(queuedMessages)
        ? queuedMessages.flatMap((item) => {
            const normalized = normalizeQueuedMessage(item);
            return normalized ? [normalized] : [];
          })
        : [];
      // lastError 需要严格为非空字符串，兼容旧数据的消息扫描由 sessionStatus.hasPersistedError 兜底
      const rawLastError = conversation.lastError;
      const normalizedLastError =
        typeof rawLastError === "string" && rawLastError.trim().length > 0
          ? rawLastError.trim()
          : undefined;
      return {
        ...persistedConversation,
        ...(typeof conversation.modelId === "string" && conversation.modelId
          ? { modelId: conversation.modelId }
          : {}),
        ...(Array.isArray(conversation.workspaceDrafts)
          ? { workspaceDrafts: conversation.workspaceDrafts.filter(isValidWorkspaceFileDraft) }
          : {}),
        ...(normalizedQueue.length ? { queuedMessages: normalizedQueue } : {}),
        ...(queuePaused === true && normalizedQueue.length ? { queuePaused: true } : {}),
        ...(typeof systemPrompt === "string" ? { systemPrompt } : {}),
        ...(typeof projectPath === "string" && projectPath.trim()
          ? { projectPath: projectPath.trim() }
          : {}),
        ...(typeof providerSessionId === "string" && providerSessionId.trim()
          ? { providerSessionId: providerSessionId.trim() }
          : {}),
        ...(normalizedLastError ? { lastError: normalizedLastError } : {}),
      };
    }),
  };
}

export async function loadChatState(): Promise<PersistedChatState | null> {
  if (typeof window === "undefined" || !("indexedDB" in window)) {
    return null;
  }

  try {
    const raw = await readLocalValue<unknown>(CHAT_STATE_KEY);
    return normalizePersistedChatState(raw);
  } catch (error) {
    console.error("Failed to load chat state from IndexedDB:", error);
    return null;
  }
}

export async function saveChatState(state: PersistedChatState): Promise<void> {
  if (typeof window === "undefined" || !("indexedDB" in window)) {
    return;
  }

  try {
    await writeLocalValue(CHAT_STATE_KEY, state);
  } catch (error) {
    console.error("Failed to save chat state to IndexedDB:", error);
  }
}

export async function clearChatState(): Promise<void> {
  if (typeof window === "undefined" || !("indexedDB" in window)) {
    return;
  }

  try {
    await deleteLocalValue(CHAT_STATE_KEY);
  } catch (error) {
    console.error("Failed to clear chat state from IndexedDB:", error);
  }
}

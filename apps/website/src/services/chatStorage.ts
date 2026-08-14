import type { ConversationItemType } from "@antdv-next/x";
import type { DefaultMessageInfo, XModelMessage } from "@antdv-next/x-sdk";
import {
  isAssistantConversationSnapshot,
  type AssistantConversationSnapshot,
} from "../features/assistant-market/types";
import { isValidA2UISubmission, type A2UISubmission } from "../utils/a2ui";
import { isValidWorkspaceFileDraft, type WorkspaceFileDraft } from "../utils/fileWorkspace";
import { deleteLocalValue, readLocalValue, writeLocalValue } from "./localDatabase";

const CHAT_STATE_KEY = "chat-state-v1";

export interface PersistedConversation extends Omit<ConversationItemType, "messages"> {
  agentId?: string;
  messages: DefaultMessageInfo<XModelMessage>[];
  a2uiSubmissions?: A2UISubmission[];
  workspaceDrafts?: WorkspaceFileDraft[];
  systemPrompt?: string;
  assistant?: AssistantConversationSnapshot;
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
      const { assistant, systemPrompt, ...persistedConversation } = conversation;
      return {
        ...persistedConversation,
        a2uiSubmissions: Array.isArray(conversation.a2uiSubmissions)
          ? conversation.a2uiSubmissions.filter(isValidA2UISubmission)
          : [],
        ...(Array.isArray(conversation.workspaceDrafts)
          ? { workspaceDrafts: conversation.workspaceDrafts.filter(isValidWorkspaceFileDraft) }
          : {}),
        ...(typeof systemPrompt === "string" ? { systemPrompt } : {}),
        ...(isAssistantConversationSnapshot(assistant) ? { assistant } : {}),
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

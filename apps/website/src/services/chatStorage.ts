import type { ConversationItemType } from "@antdv-next/x";
import type { DefaultMessageInfo, XModelMessage } from "@antdv-next/x-sdk";
import { isValidA2UISubmission, type A2UISubmission } from "../utils/a2ui";

const DB_NAME = "open-chat";
const DB_VERSION = 1;
const STORE_NAME = "app-state";
const CHAT_STATE_KEY = "chat-state-v1";

export interface PersistedConversation extends Omit<ConversationItemType, "messages"> {
  messages: DefaultMessageInfo<XModelMessage>[];
  a2uiSubmissions?: A2UISubmission[];
  systemPrompt?: string;
}

export interface PersistedChatState {
  version: 2;
  currentConversationKey: string;
  currentModel: string;
  conversationList: PersistedConversation[];
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      reject(request.error ?? new Error("Failed to open IndexedDB"));
    };
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  callback: (store: IDBObjectStore) => IDBRequest,
): Promise<T | undefined> {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode);
    const store = transaction.objectStore(STORE_NAME);
    const request = callback(store);

    request.onsuccess = () => {
      resolve(request.result as T | undefined);
    };

    request.onerror = () => {
      reject(request.error ?? new Error("IndexedDB request failed"));
    };

    transaction.oncomplete = () => {
      db.close();
    };

    transaction.onerror = () => {
      reject(transaction.error ?? new Error("IndexedDB transaction failed"));
      db.close();
    };
  });
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
      const { systemPrompt, ...persistedConversation } = conversation;
      return {
        ...persistedConversation,
        a2uiSubmissions: Array.isArray(conversation.a2uiSubmissions)
          ? conversation.a2uiSubmissions.filter(isValidA2UISubmission)
          : [],
        ...(typeof systemPrompt === "string" ? { systemPrompt } : {}),
      };
    }),
  };
}

export async function loadChatState(): Promise<PersistedChatState | null> {
  if (typeof window === "undefined" || !("indexedDB" in window)) {
    return null;
  }

  try {
    const raw = await withStore<unknown>("readonly", (store) => store.get(CHAT_STATE_KEY));
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
    // Remove Vue proxies / non-serializable fields before writing into IndexedDB.
    const plainState = JSON.parse(JSON.stringify(state)) as PersistedChatState;
    await withStore<void>("readwrite", (store) => store.put(plainState, CHAT_STATE_KEY));
  } catch (error) {
    console.error("Failed to save chat state to IndexedDB:", error);
  }
}

export async function clearChatState(): Promise<void> {
  if (typeof window === "undefined" || !("indexedDB" in window)) {
    return;
  }

  try {
    await withStore<void>("readwrite", (store) => store.delete(CHAT_STATE_KEY));
  } catch (error) {
    console.error("Failed to clear chat state from IndexedDB:", error);
  }
}

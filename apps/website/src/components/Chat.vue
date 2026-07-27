<script setup lang="ts">
import type { BubbleItemType, ConversationsProps } from "@antdv-next/x";
import type { DefaultMessageInfo } from "@antdv-next/x-sdk";
import type { XModelMessage, XModelResponse } from "@antdv-next/x-sdk";
import { XRequest, useXChat } from "@antdv-next/x-sdk";
import { message } from "antdv-next";
import { computed, ref, watch, onMounted, onBeforeUnmount } from "vue";
import { API_BASE_URL, GATEWAY_API_KEY, type WebSearchSourceItem } from "../services/ai";
import {
  OpenChatProvider,
  WEB_SEARCHING_MARKER,
  type OpenChatParams,
} from "../services/OpenChatProvider";
import {
  A2UI_SUBMISSION_MESSAGE_KIND,
  appendA2UISurfaceIdContext,
  createA2UISubmission,
  formatA2UISubmissionAsUserMessage,
  isA2UISubmissionContextMessage,
  type A2UIActionPayload,
} from "../utils/a2ui";
import { collectFileWorkspaceState, type EditableWorkspaceFile } from "../utils/fileWorkspace";
import { FILE_WORKSPACE_SYSTEM_PROMPT } from "../prompts/fileWorkspace";
import {
  createAssistantConversationSnapshot,
  getAssistantById,
} from "../features/assistant-market/catalog";
import type { AssistantConversationSnapshot } from "../features/assistant-market/types";
import { loadChatState } from "../services/chatStorage";
import { useChatModels } from "../composables/useChatModels";
import {
  getMessagePreview,
  useChatPersistence,
  type OpenChatConversation,
} from "../composables/useChatPersistence";
import ChatSidebar from "./chat/ChatSidebar.vue";
import ChatHeader from "./chat/ChatHeader.vue";
import ChatMessages from "./chat/ChatMessages.vue";
import ChatInput from "./chat/ChatInput.vue";
import FileWorkspace from "./chat/FileWorkspace.vue";
import DeleteConversationModal from "./chat/DeleteConversationModal.vue";
import AssistantCenterModal from "./chat/AssistantCenterModal.vue";

interface Props {
  dark: boolean;
}

interface Emits {
  (e: "navigate", path: string): void;
  (e: "toggleTheme"): void;
}

defineProps<Props>();
const emit = defineEmits<Emits>();

// ============ 响应式状态 ============

const content = ref("");
const conversationsOpen = ref(true);
const deleteOpen = ref(false);
const currentConversationKey = ref<string>("");
const thinkingEnabled = ref(true);
const fileModeEnabled = ref(false);
const workspaceOpen = ref(false);
const selectedWorkspacePath = ref<string[]>([]);
const searchEnabled = ref(false);
const pendingSearchSources = ref<WebSearchSourceItem[] | null>(null);
const pendingA2UISurfaceId = ref("");
const showWelcome = ref(true);
const isHydrating = ref(true);
const activeRequestConversationKey = ref<string>("");
const draftAssistant = ref<AssistantConversationSnapshot | null>(null);
const assistantCenterOpen = ref(false);
const assistantCenterView = ref<"market" | "installed">("market");

const assistantFromLocation = () => {
  const assistantId = new URLSearchParams(window.location.search).get("assistant");
  const definition = assistantId ? getAssistantById(assistantId) : undefined;
  return definition ? createAssistantConversationSnapshot(definition) : null;
};

draftAssistant.value = assistantFromLocation();
const initialStarterId = new URLSearchParams(window.location.search).get("starter");
const initialStarterPrompt = draftAssistant.value?.starterPrompts.find(
  (prompt) => prompt.id === initialStarterId,
);
if (initialStarterPrompt) content.value = initialStarterPrompt.prompt;

const createNewConversation = (
  systemPrompt: string = "",
  assistant: AssistantConversationSnapshot | null = null,
): OpenChatConversation => {
  const key = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const initialContent = assistant?.initialAssistantMessage?.trim();
  const initialMessages: DefaultMessageInfo<XModelMessage>[] = initialContent
    ? [
        {
          id: `initial-assistant-${key}`,
          status: "local",
          message: {
            content: initialContent,
            openChatLocalOnly: true,
            role: "assistant",
          },
          extraInfo: { kind: "initial-assistant-message" },
        },
      ]
    : [];

  return {
    key,
    label: initialMessages.length > 0 && assistant ? assistant.name : "新对话",
    group: "今天",
    messages: initialMessages,
    a2uiSubmissions: [],
    workspaceDrafts: [],
    systemPrompt,
    ...(assistant ? { assistant } : {}),
  };
};

const conversationList = ref<OpenChatConversation[]>([]);

// ============ 模型加载 ============

const {
  currentModel,
  searchAvailable,
  modelDropdownItems,
  currentModelLabel,
  reconcileCurrentModel,
  loadModels,
} = useChatModels();

loadModels();

// ============ 对话管理 ============

const getCurrentConversation = (): OpenChatConversation | undefined => {
  return conversationList.value.find((c) => c.key === currentConversationKey.value);
};

const activeAssistant = computed<AssistantConversationSnapshot | null>(() => {
  const conversation = getCurrentConversation();
  return conversation ? (conversation.assistant ?? null) : draftAssistant.value;
});
const activeStarterPrompts = computed(() => activeAssistant.value?.starterPrompts ?? []);

watch(
  activeAssistant,
  (assistant) => {
    if (assistant?.capabilities.includes("files")) {
      fileModeEnabled.value = true;
      workspaceOpen.value = true;
    }
  },
  { immediate: true },
);

watch(
  [activeAssistant, searchAvailable],
  ([assistant, canSearch]) => {
    if (assistant?.capabilities.includes("web-search") && canSearch) {
      searchEnabled.value = true;
    }
  },
  { immediate: true },
);

const isInDraftMode = computed(() => !currentConversationKey.value);
const currentConversationTitle = computed(() => {
  const conversation = getCurrentConversation();
  return typeof conversation?.label === "string" && conversation.label.trim()
    ? conversation.label
    : "新对话";
});
const currentConversationMessages = computed<DefaultMessageInfo<XModelMessage>[]>(() => {
  const conv = getCurrentConversation();
  return conv?.messages ?? [];
});

/** Maps an assistant message id to the web-search sources attached to it.
 * Sources are stored on the assistant message's `extraInfo.webSearchResults`. */
const searchResultsByMessageId = computed<Record<string, WebSearchSourceItem[]>>(() => {
  const map: Record<string, WebSearchSourceItem[]> = {};
  for (const msg of currentConversationMessages.value) {
    if (msg.message.role !== "assistant") continue;
    const results = (msg.extraInfo as { webSearchResults?: unknown } | undefined)?.webSearchResults;
    if (Array.isArray(results) && results.length > 0) {
      map[String(msg.id)] = results as WebSearchSourceItem[];
    }
  }
  return map;
});
const currentA2UISubmissions = computed(() => getCurrentConversation()?.a2uiSubmissions ?? []);
const currentFileWorkspace = computed(() =>
  collectFileWorkspaceState(
    currentConversationMessages.value.map(({ id, message }) => ({
      id,
      role: message.role,
      content: message.content,
    })),
  ),
);
const editableWorkspaceFiles = computed<EditableWorkspaceFile[]>(() => {
  const drafts = getCurrentConversation()?.workspaceDrafts ?? [];
  return currentFileWorkspace.value.files.map((file) => {
    const draft = drafts.find((item) => item.path === file.path);
    const content = draft?.content ?? file.content;
    return {
      ...file,
      content,
      originalContent: file.content,
      dirty: content !== file.content,
      hasIncomingChange: Boolean(
        draft && draft.baseContent !== file.content && draft.content !== file.content,
      ),
    };
  });
});
const workspaceAvailable = computed(
  () => fileModeEnabled.value || currentFileWorkspace.value.hasWorkspace,
);

const updateConversationMessages = (
  conversationKey: string,
  newMessages: DefaultMessageInfo<XModelMessage>[],
) => {
  if (!conversationKey) return;
  const conv = conversationList.value.find((c) => c.key === conversationKey);
  if (!conv) return;

  conv.messages = newMessages;

  // 如果有消息，更新对话标题为首条用户消息摘要
  if (newMessages.length > 0 && conv.label === "新对话") {
    const firstUserMessage = newMessages.find(
      (m) => m.message.role === "user" && !isA2UISubmissionContextMessage(m.message, m.extraInfo),
    );
    if (firstUserMessage) {
      const contentStr =
        typeof firstUserMessage.message.content === "string"
          ? firstUserMessage.message.content
          : "";
      conv.label = getMessagePreview(contentStr);
    }
  }
};

const handleNewConversation = () => {
  // 草稿态下重复点击只提示，不重复创建
  if (isInDraftMode.value) {
    if (draftAssistant.value) {
      draftAssistant.value = null;
      content.value = "";
      window.history.replaceState({}, "", "/chat");
      message.success("已切换到普通新对话");
      return;
    }
    showWelcome.value = true;
    message.info("当前已经是新对话");
    return;
  }

  currentConversationKey.value = "";
  draftAssistant.value = null;
  window.history.replaceState({}, "", "/chat");
  showWelcome.value = true;
};

const openAssistantCenter = (nextView: "market" | "installed" = "market") => {
  assistantCenterView.value = nextView;
  assistantCenterOpen.value = true;
  if (window.matchMedia("(max-width: 767px)").matches) closeSidebar();
};

const handleAssistantUse = (assistant: AssistantConversationSnapshot, starterPrompt?: string) => {
  // A conversation keeps the assistant version it was created with. Selecting
  // another assistant therefore starts a clean draft while keeping Chat in place.
  if (currentConversationKey.value) {
    currentConversationKey.value = "";
    setMessages([]);
  }
  draftAssistant.value = assistant;
  content.value = starterPrompt ?? "";
  showWelcome.value = !materializeInitialAssistantConversation(assistant);
  fileModeEnabled.value = assistant.capabilities.includes("files");
  workspaceOpen.value = fileModeEnabled.value;
  searchEnabled.value = assistant.capabilities.includes("web-search") && searchAvailable.value;
  assistantCenterOpen.value = false;
  window.history.replaceState({}, "", "/chat");
  message.success(`已切换到「${assistant.name}」`);
};

const handleActiveChange: ConversationsProps["onActiveChange"] = (key) => {
  currentConversationKey.value = key;
  const conv = getCurrentConversation();
  if (conv) {
    showWelcome.value = conv.messages.length === 0;
  }
  if (window.matchMedia("(max-width: 767px)").matches) {
    closeSidebar();
  }
};

const handleSidebarToggle = () => {
  conversationsOpen.value = !conversationsOpen.value;
};

const closeSidebar = () => {
  conversationsOpen.value = false;
};

// ============ XChat 配置 ============

const createProvider = () => {
  return new OpenChatProvider({
    request: XRequest<OpenChatParams, XModelResponse>(`${API_BASE_URL}/api/chat/completions`, {
      manual: true,
      params: { stream: true } as OpenChatParams,
      headers: GATEWAY_API_KEY ? { Authorization: `Bearer ${GATEWAY_API_KEY}` } : undefined,
      streamTimeout: 60000,
    }),
  });
};

const provider = createProvider();
provider.onWebSearchSources = (sources) => {
  // A single request may run several search rounds; accumulate every round's
  // sources (with re-keyed indices to keep them unique) so the Sources UI
  // shows all results instead of only the last round.
  const prev = pendingSearchSources.value ?? [];
  pendingSearchSources.value = [
    ...prev,
    ...sources.map((source, index) => ({
      ...source,
      key: String(prev.length + index),
    })),
  ];
};

const getInitialMessages = (): DefaultMessageInfo<XModelMessage>[] => {
  const conv = getCurrentConversation();
  return conv?.messages || [];
};

const { onRequest, messages, setMessages, isRequesting, abort, onReload } = useXChat<
  XModelMessage,
  XModelMessage,
  OpenChatParams,
  XModelResponse
>({
  provider: provider,
  defaultMessages: getInitialMessages,
  requestFallback: (_, { error, errorInfo, messageInfo }) => {
    if (error.name === "AbortError") {
      const existing =
        typeof messageInfo?.message?.content === "string" ? messageInfo.message.content : "";
      return {
        content: existing && existing !== WEB_SEARCHING_MARKER ? existing : "请求已中止",
        role: "assistant",
      };
    }
    return {
      content: errorInfo?.error?.message || "请求失败，请重试！",
      role: "assistant",
    };
  },
  requestPlaceholder: () => ({ content: "请稍候...", role: "assistant" }),
});

// ============ 会话持久化 ============

const { applyPersistedState, schedulePersistState, handleExportLocalHistory } = useChatPersistence({
  conversationList,
  currentConversationKey,
  currentModel,
  showWelcome,
  isHydrating,
  activeRequestConversationKey,
  isRequesting,
  setMessages,
  reconcileCurrentModel,
});

const materializeInitialAssistantConversation = (
  assistant: AssistantConversationSnapshot,
): boolean => {
  if (!assistant.initialAssistantMessage?.trim()) return false;

  const conversation = createNewConversation(assistant.renderedSystemPrompt, assistant);
  conversationList.value.unshift(conversation);
  currentConversationKey.value = String(conversation.key);
  setMessages(conversation.messages);
  showWelcome.value = false;
  schedulePersistState();
  return true;
};

/** Attach sources received mid-stream to the assistant message that produced them. */
const attachPendingSearchSources = () => {
  const sources = pendingSearchSources.value;
  pendingSearchSources.value = null;
  if (!sources || sources.length === 0) return;
  setMessages((msgs) => {
    const lastAssistant = [...msgs].reverse().find((m) => m.message.role === "assistant");
    if (!lastAssistant) return msgs;
    return msgs.map((m) =>
      m.id === lastAssistant.id
        ? { ...m, extraInfo: { ...m.extraInfo, webSearchResults: sources } }
        : m,
    );
  });
};

watch(isRequesting, (requesting) => {
  if (!requesting) {
    attachPendingSearchSources();
    activeRequestConversationKey.value = "";
    pendingA2UISurfaceId.value = "";
  }
});

// 监听消息变化，同步到对话列表
watch(
  messages,
  (newMessages) => {
    const conversationWriteKey = activeRequestConversationKey.value || currentConversationKey.value;
    updateConversationMessages(conversationWriteKey, newMessages);
    schedulePersistState();
  },
  { deep: true },
);

watch(
  currentFileWorkspace,
  (workspace, previousWorkspace) => {
    const selected = selectedWorkspacePath.value.join("/");
    if (!workspace.files.some((file) => file.path === selected)) {
      selectedWorkspacePath.value = workspace.files[0]?.path.split("/") ?? [];
    }
    const hasNewRevision = workspace.files.some((file) => {
      const previousFile = previousWorkspace?.files.find((item) => item.path === file.path);
      return previousFile && previousFile.ownerMessageId !== file.ownerMessageId;
    });
    if (
      workspace.hasWorkspace &&
      (!previousWorkspace?.hasWorkspace ||
        workspace.files.length > previousWorkspace.files.length ||
        hasNewRevision ||
        (workspace.pending && !previousWorkspace.pending))
    ) {
      workspaceOpen.value = true;
    }
  },
  { deep: true },
);

const handleWorkspaceKeydown = (event: KeyboardEvent) => {
  if (event.key === "Escape") {
    workspaceOpen.value = false;
    deleteOpen.value = false;
  }
  if ((event.metaKey || event.ctrlKey) && event.key === "/") {
    event.preventDefault();
    document.querySelector<HTMLTextAreaElement>(".chat-layout textarea")?.focus();
  }
};

onMounted(async () => {
  window.addEventListener("keydown", handleWorkspaceKeydown);
  if (window.matchMedia("(max-width: 767px)").matches) {
    conversationsOpen.value = false;
  }

  const persistedState = await loadChatState();

  if (persistedState && persistedState.conversationList.length > 0) {
    applyPersistedState(persistedState);
  } else {
    conversationList.value = [];
    currentConversationKey.value = "";
    showWelcome.value = true;
  }

  isHydrating.value = false;
  if (draftAssistant.value) {
    materializeInitialAssistantConversation(draftAssistant.value);
  }
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", handleWorkspaceKeydown);
});

// ============ 消息转换 ============

const bubbleItems = computed<BubbleItemType[]>(() => {
  return currentConversationMessages.value
    .filter(
      ({ message: modelMessage, extraInfo }) =>
        !isA2UISubmissionContextMessage(modelMessage, extraInfo),
    )
    .map(({ id, message: modelMessage, status }) => ({
      key: id,
      role: modelMessage.role,
      status,
      loading: status === "loading",
      content: typeof modelMessage.content === "string" ? modelMessage.content : "",
    }));
});

// ============ 事件处理 ============

const handlePromptClick = (info: { data: { key?: string; description?: string } }) => {
  const prompt = typeof info.data.description === "string" ? info.data.description : "";
  if (isRequesting.value || !prompt) return;

  showWelcome.value = false;
  if (info.data.key === "ticket-branch" && !activeAssistant.value) {
    const definition = getAssistantById("official-ticket-branch");
    if (definition) {
      const assistant = createAssistantConversationSnapshot(definition);
      draftAssistant.value = assistant;
      if (materializeInitialAssistantConversation(assistant)) return;
    }
  }
  handleSubmit(prompt);
};

const handleCancel = () => {
  abort();
};

const handleChange = (value: string) => {
  content.value = value;
};

const getRequestSystemPrompt = (baseSystemPrompt: string) => {
  const composedPrompt = [
    baseSystemPrompt.trim(),
    fileModeEnabled.value ? FILE_WORKSPACE_SYSTEM_PROMPT : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  return appendA2UISurfaceIdContext(
    composedPrompt,
    currentConversationMessages.value.map(({ message: modelMessage, status }) => ({
      content: modelMessage.content,
      role: modelMessage.role,
      status,
    })),
  );
};

const handleSubmit = (
  nextContent: string,
  options: {
    extraInfo?: Record<string, unknown>;
    systemPrompt?: string;
    assistant?: AssistantConversationSnapshot;
  } = {},
) => {
  if (!nextContent || !nextContent.trim()) return;
  if (isRequesting.value) return;

  // 草稿态首次发送时，才创建真实会话并写入侧栏
  if (isInDraftMode.value) {
    const assistant = options.assistant ?? draftAssistant.value;
    const newConversation = createNewConversation(
      options.systemPrompt ?? assistant?.renderedSystemPrompt ?? "",
      assistant,
    );
    conversationList.value.unshift(newConversation);
    currentConversationKey.value = String(newConversation.key);
  }

  const conversation = getCurrentConversation();
  if (!conversation) return;
  if (options.systemPrompt !== undefined) {
    conversation.systemPrompt = options.systemPrompt.trim();
  }
  if (options.assistant) {
    conversation.assistant = options.assistant;
    conversation.systemPrompt = options.assistant.renderedSystemPrompt;
  }

  setMessages(currentConversationMessages.value);
  activeRequestConversationKey.value = currentConversationKey.value;

  showWelcome.value = false;
  onRequest(
    {
      messages: [{ role: "user", content: nextContent }],
      model: currentModel.value,
      systemPrompt: getRequestSystemPrompt(
        conversation.assistant?.renderedSystemPrompt ?? conversation.systemPrompt ?? "",
      ),
      enable_thinking: thinkingEnabled.value,
      thinking: { type: thinkingEnabled.value ? "enabled" : "disabled" },
      ...(searchEnabled.value ? { web_search: true } : {}),
    },
    options.extraInfo ? { extraInfo: options.extraInfo } : undefined,
  );
  // 清空输入框
  setTimeout(() => {
    content.value = "";
  }, 0);
};

const handleA2UIAction = (payload: A2UIActionPayload) => {
  if (isRequesting.value) {
    message.warning("回答生成中，请稍后再操作界面");
    return;
  }

  const conversation = getCurrentConversation();
  if (!conversation) {
    message.error("当前对话不存在，无法提交表单");
    return;
  }
  const duplicate = (conversation.a2uiSubmissions ?? []).some(
    (submission) =>
      submission.surfaceId === payload.surfaceId &&
      submission.surfaceRevision === payload.surfaceRevision &&
      submission.action.name === payload.name,
  );
  if (duplicate) {
    message.info("这份表单已经提交");
    return;
  }

  const submission = createA2UISubmission(payload, currentConversationKey.value);
  conversation.a2uiSubmissions = [...(conversation.a2uiSubmissions ?? []), submission];
  pendingA2UISurfaceId.value = payload.surfaceId;
  schedulePersistState();
  handleSubmit(formatA2UISubmissionAsUserMessage(submission), {
    extraInfo: {
      hidden: true,
      kind: A2UI_SUBMISSION_MESSAGE_KIND,
      submissionId: submission.submissionId,
    },
  });
};

const handleModelChange = (key: string) => {
  currentModel.value = key;
};

const handleThinkingChange = (value: boolean) => {
  thinkingEnabled.value = value;
};

const handleFileModeChange = (value: boolean) => {
  fileModeEnabled.value = value;
  if (value) workspaceOpen.value = true;
  else if (!currentFileWorkspace.value.hasWorkspace) workspaceOpen.value = false;
};

const handleWorkspaceFileChange = (payload: { path: string; content: string }) => {
  const conversation = getCurrentConversation();
  const sourceFile = currentFileWorkspace.value.files.find((file) => file.path === payload.path);
  if (!conversation || !sourceFile || sourceFile.status === "streaming") return;

  const drafts = conversation.workspaceDrafts ?? [];
  const existing = drafts.find((draft) => draft.path === payload.path);
  if (payload.content === sourceFile.content) {
    conversation.workspaceDrafts = drafts.filter((draft) => draft.path !== payload.path);
  } else {
    conversation.workspaceDrafts = [
      ...drafts.filter((draft) => draft.path !== payload.path),
      {
        path: payload.path,
        baseContent: existing?.baseContent ?? sourceFile.content,
        content: payload.content,
        updatedAt: Date.now(),
      },
    ];
  }
  schedulePersistState();
};

const clearWorkspaceDraft = (path: string, successMessage: string) => {
  const conversation = getCurrentConversation();
  if (!conversation) return;
  conversation.workspaceDrafts = (conversation.workspaceDrafts ?? []).filter(
    (draft) => draft.path !== path,
  );
  schedulePersistState();
  message.success(successMessage);
};

const handleSearchChange = (value: boolean) => {
  if (value && !searchAvailable.value) {
    message.warning("未配置联网搜索能力");
    return;
  }
  searchEnabled.value = value;
};

const handleReloadMessage = (messageId: string | number) => {
  const lastAssistantMessage = [...currentConversationMessages.value]
    .reverse()
    .find(({ message: modelMessage }) => modelMessage.role === "assistant");

  if (
    !lastAssistantMessage ||
    lastAssistantMessage.status !== "success" ||
    String(lastAssistantMessage.id) !== String(messageId)
  ) {
    message.warning("只能重新生成最后一条回答");
    return;
  }

  setMessages(currentConversationMessages.value);
  const currentConversation = getCurrentConversation();
  const baseSystemPrompt =
    currentConversation?.assistant?.renderedSystemPrompt ?? currentConversation?.systemPrompt ?? "";
  onReload(messageId, {
    model: currentModel.value,
    systemPrompt: getRequestSystemPrompt(baseSystemPrompt),
    ...(searchEnabled.value ? { web_search: true } : {}),
  });
};

const handleRenameConversation = (title: string) => {
  const conversation = getCurrentConversation();
  if (!conversation) return;
  conversation.label = title;
  schedulePersistState();
};

const handlePinConversation = (conversationKey: string = currentConversationKey.value) => {
  const conversation = conversationList.value.find((item) => String(item.key) === conversationKey);
  if (!conversation) return;
  conversation.group = conversation.group === "置顶" ? "今天" : "置顶";
  schedulePersistState();
  message.success(conversation.group === "置顶" ? "对话已置顶" : "已取消置顶");
};

const resetAfterRemovingConversation = () => {
  setMessages([]);
  currentConversationKey.value = "";
  showWelcome.value = true;
  schedulePersistState();
};

const handleArchiveConversation = (conversationKey: string = currentConversationKey.value) => {
  if (!conversationKey) return;
  conversationList.value = conversationList.value.filter(
    (conversation) => String(conversation.key) !== conversationKey,
  );
  if (conversationKey === currentConversationKey.value) {
    resetAfterRemovingConversation();
  } else {
    schedulePersistState();
  }
  message.success("对话已归档");
};

const handleDeleteConversation = (conversationKey: string = currentConversationKey.value) => {
  if (!conversationKey) return;
  conversationList.value = conversationList.value.filter(
    (conversation) => String(conversation.key) !== conversationKey,
  );
  deleteOpen.value = false;
  if (conversationKey === currentConversationKey.value) {
    resetAfterRemovingConversation();
  } else {
    schedulePersistState();
  }
  message.success("对话已删除");
};

const handleSidebarRename = (conversationKey: string, title: string) => {
  const conversation = conversationList.value.find((item) => String(item.key) === conversationKey);
  if (!conversation) return;
  conversation.label = title;
  schedulePersistState();
  message.success("对话名称已更新");
};
</script>

<template>
  <div
    class="chat-layout relative flex h-screen min-h-[100dvh] overflow-hidden bg-brand-background text-brand-foreground selection:bg-brand-surface-subtle selection:text-brand-foreground"
  >
    <a class="skip-link" href="#chat-content">跳到消息内容</a>
    <button
      v-if="conversationsOpen"
      class="sidebar-backdrop absolute inset-0 z-backdrop border-0 bg-[rgba(9,9,11,0.4)]"
      type="button"
      aria-label="关闭对话侧栏"
      @click="closeSidebar"
    ></button>
    <ChatSidebar
      :open="conversationsOpen"
      :dark="dark"
      :conversation-list="conversationList"
      :current-key="currentConversationKey"
      @home="emit('navigate', '/')"
      @toggle-sidebar="handleSidebarToggle"
      @toggle-theme="emit('toggleTheme')"
      @new-conversation="handleNewConversation"
      @assistants="openAssistantCenter('market')"
      @installed-assistants="openAssistantCenter('installed')"
      @active-change="handleActiveChange"
      @rename="handleSidebarRename"
      @pin="handlePinConversation"
      @archive="handleArchiveConversation"
      @delete="handleDeleteConversation"
    />

    <div class="chat-main flex min-w-0 flex-1 flex-col overflow-hidden bg-brand-workspace">
      <ChatHeader
        :title="currentConversationTitle"
        :sidebar-open="conversationsOpen"
        :workspace-available="workspaceAvailable"
        :workspace-open="workspaceOpen"
        :syncing="isRequesting"
        :assistant-name="activeAssistant?.name"
        :assistant-version="activeAssistant?.version"
        @toggle-sidebar="handleSidebarToggle"
        @toggle-workspace="workspaceOpen = !workspaceOpen"
        @export="handleExportLocalHistory"
        @rename="handleRenameConversation"
        @pin="handlePinConversation"
        @archive="handleArchiveConversation"
        @delete="deleteOpen = true"
      />

      <ChatMessages
        :show-welcome="showWelcome && currentConversationMessages.length === 0"
        :bubble-items="bubbleItems"
        :dark="dark"
        :conversation-key="currentConversationKey"
        :a2ui-pending-surface-id="pendingA2UISurfaceId"
        :a2ui-submissions="currentA2UISubmissions"
        :search-results-by-message-id="searchResultsByMessageId"
        @a2ui-action="handleA2UIAction"
        @reload="handleReloadMessage"
      />

      <ChatInput
        v-model="content"
        :loading="isRequesting"
        :current-model="currentModel"
        :current-model-label="currentModelLabel"
        :model-items="modelDropdownItems ?? []"
        :thinking-enabled="thinkingEnabled"
        :file-mode-enabled="fileModeEnabled"
        :search-enabled="searchEnabled"
        :search-available="searchAvailable"
        :show-starter-prompts="showWelcome && currentConversationMessages.length === 0"
        :starter-prompts="activeStarterPrompts"
        :assistant-name="activeAssistant?.name"
        @change="handleChange"
        @cancel="handleCancel"
        @submit="handleSubmit"
        @model-change="handleModelChange"
        @thinking-change="handleThinkingChange"
        @file-mode-change="handleFileModeChange"
        @search-change="handleSearchChange"
        @prompt-click="handlePromptClick"
        @assistant-select="openAssistantCenter('market')"
      />
    </div>

    <FileWorkspace
      :open="workspaceOpen"
      :files="editableWorkspaceFiles"
      :pending="
        isRequesting &&
        fileModeEnabled &&
        (currentFileWorkspace.pending || currentFileWorkspace.files.length === 0)
      "
      :dark="dark"
      :selected-path="selectedWorkspacePath"
      @close="workspaceOpen = false"
      @update:selected-path="selectedWorkspacePath = $event"
      @file-change="handleWorkspaceFileChange"
      @reset-file="clearWorkspaceDraft($event, '已恢复 AI 版本')"
      @accept-incoming="clearWorkspaceDraft($event, '已采用 AI 新版本')"
    />

    <DeleteConversationModal v-model:open="deleteOpen" @confirm="handleDeleteConversation" />
    <AssistantCenterModal
      :open="assistantCenterOpen"
      :dark="dark"
      :initial-view="assistantCenterView"
      @close="assistantCenterOpen = false"
      @use="handleAssistantUse"
    />
  </div>
</template>

<style scoped>
/* 767px 为非常规断点（与脚本中 matchMedia 保持一致），display 切换整体保留在 CSS 中 */
.sidebar-backdrop {
  display: none;
}

@media (max-width: 767px) {
  .sidebar-backdrop {
    display: block;
  }

  .chat-main {
    width: 100%;
  }
}
</style>

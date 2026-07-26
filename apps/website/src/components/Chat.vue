<script setup lang="ts">
import type { BubbleItemType, ConversationItemType, ConversationsProps } from "@antdv-next/x";
import type { DefaultMessageInfo } from "@antdv-next/x-sdk";
import type { XModelMessage, XModelResponse } from "@antdv-next/x-sdk";
import { XRequest, useXChat } from "@antdv-next/x-sdk";
import { Copy, Trash2 } from "@lucide/vue";
import { Button, Input, Modal, Switch, message, type MenuProps } from "antdv-next";
import { computed, ref, watch, onMounted, onBeforeUnmount } from "vue";
import {
  aiService,
  API_BASE_URL,
  GATEWAY_API_KEY,
  type ModelsProvider,
  type WebSearchSourceItem,
} from "../services/ai";
import {
  OpenChatProvider,
  WEB_SEARCHING_MARKER,
  createTicketBranchSystemPrompt,
  type OpenChatParams,
} from "../services/OpenChatProvider";
import {
  A2UI_SUBMISSION_MESSAGE_KIND,
  createA2UISubmission,
  formatA2UISubmissionAsUserMessage,
  isA2UISubmissionContextMessage,
  type A2UIActionPayload,
  type A2UISubmission,
} from "../utils/a2ui";
import {
  FILE_WORKSPACE_SYSTEM_PROMPT,
  collectFileWorkspaceState,
  type EditableWorkspaceFile,
  type WorkspaceFileDraft,
} from "../utils/fileWorkspace";
import {
  clearChatState,
  loadChatState,
  normalizePersistedChatState,
  saveChatState,
  type PersistedChatState,
  type PersistedConversation,
} from "../services/chatStorage";
import ChatSidebar from "./chat/ChatSidebar.vue";
import ChatHeader from "./chat/ChatHeader.vue";
import ChatMessages from "./chat/ChatMessages.vue";
import ChatInput from "./chat/ChatInput.vue";
import FileWorkspace from "./chat/FileWorkspace.vue";

interface Props {
  dark: boolean;
}

interface Emits {
  (e: "navigate", path: string): void;
  (e: "toggleTheme"): void;
}

interface OpenChatConversation extends ConversationItemType {
  a2uiSubmissions?: A2UISubmission[];
  workspaceDrafts?: WorkspaceFileDraft[];
  systemPrompt?: string;
}

defineProps<Props>();
const emit = defineEmits<Emits>();

// ============ 响应式状态 ============

const models = ref<ModelsProvider[]>([]);
const defaultModelId = ref("");
const content = ref("");
const conversationsOpen = ref(true);
const shareOpen = ref(false);
const deleteOpen = ref(false);
const allowSharedCopy = ref(true);
const currentConversationKey = ref<string>("");
const currentModel = ref("");
const thinkingEnabled = ref(true);
const fileModeEnabled = ref(false);
const workspaceOpen = ref(false);
const selectedWorkspacePath = ref<string[]>([]);
const searchEnabled = ref(false);
const searchAvailable = ref(false);
const pendingSearchSources = ref<WebSearchSourceItem[] | null>(null);
const pendingA2UISurfaceId = ref("");
const showWelcome = ref(true);
const isHydrating = ref(true);
const activeRequestConversationKey = ref<string>("");
let persistTimer: ReturnType<typeof setTimeout> | null = null;

const getMessagePreview = (content: string, maxLength: number = 20): string => {
  const normalized = content.replace(/\s+/g, " ").trim();
  if (!normalized) return "新对话";
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
};

const createNewConversation = (systemPrompt: string = ""): OpenChatConversation => ({
  key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  label: "新对话",
  group: "今天",
  messages: [],
  a2uiSubmissions: [],
  workspaceDrafts: [],
  systemPrompt,
});

const conversationList = ref<OpenChatConversation[]>([]);

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
      const normalizedGroup = typeof conversation.group === "string" ? conversation.group : "今天";

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
        messages: normalizedMessages,
        a2uiSubmissions: Array.isArray(conversation.a2uiSubmissions)
          ? conversation.a2uiSubmissions
          : [],
        workspaceDrafts: Array.isArray(conversation.workspaceDrafts)
          ? conversation.workspaceDrafts
          : [],
        systemPrompt:
          typeof conversation.systemPrompt === "string" ? conversation.systemPrompt : "",
      };
    });
};

// ============ 计算属性 ============

const allModelIds = computed(() =>
  models.value.flatMap((provider) => provider.models.map((model) => model.id)),
);

const modelById = computed<Record<string, { id: string; name: string; provider: string }>>(() => {
  const map: Record<string, { id: string; name: string; provider: string }> = {};
  for (const provider of models.value) {
    for (const model of provider.models) {
      map[model.id] = {
        id: model.id,
        name: model.name || model.id,
        provider: provider.name,
      };
    }
  }
  return map;
});

const modelOptions = computed(() =>
  models.value.flatMap((provider) =>
    provider.models.map((model) => ({
      label: model.name || model.id,
      value: model.id,
    })),
  ),
);

const modelDropdownItems = computed<MenuProps["items"]>(() => {
  return modelOptions.value.map((opt) => ({
    key: opt.value,
    label: opt.label,
  }));
});

const currentModelLabel = computed(
  () => modelById.value[currentModel.value]?.name || currentModel.value || "选择模型",
);

function reconcileCurrentModel() {
  if (allModelIds.value.length === 0) return;
  if (!currentModel.value || !allModelIds.value.includes(currentModel.value)) {
    // Only trust defaultModelId when it actually maps to a configured model;
    // otherwise fall back to the first available model so a stale or mistyped
    // `default_model` in providers.toml can't silently break every request.
    currentModel.value = allModelIds.value.includes(defaultModelId.value)
      ? defaultModelId.value
      : allModelIds.value[0];
  }
}

// ============ 对话管理 ============

const getCurrentConversation = (): OpenChatConversation | undefined => {
  return conversationList.value.find((c) => c.key === currentConversationKey.value);
};

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
    showWelcome.value = true;
    message.info("当前已经是新对话");
    return;
  }

  currentConversationKey.value = "";
  showWelcome.value = true;
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
          return { ...conv, label: getMessagePreview(firstUserMessage.message.content) };
        }
      }
      return { ...conv, label: "新对话" };
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

// ============ 模型加载 ============

const loadModels = async () => {
  try {
    const data = await aiService.getModels();
    models.value = data.providers;
    defaultModelId.value = data.defaultModel;
    searchAvailable.value = !!data.search?.enabled;
    reconcileCurrentModel();
  } catch (e) {
    console.error("Failed to load models:", e);
  }
};

loadModels();

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

// 监听模型变化，持久化选择（model 通过 onRequest 按请求传入，无需重建 provider）
watch(currentModel, () => {
  schedulePersistState();
});

watch(models, () => reconcileCurrentModel());

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
  [conversationList, currentConversationKey],
  () => {
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
    shareOpen.value = false;
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
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", handleWorkspaceKeydown);
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
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
  handleSubmit(prompt, {
    systemPrompt: info.data.key === "ticket-branch" ? createTicketBranchSystemPrompt() : "",
  });
};

const handleCancel = () => {
  abort();
};

const handleChange = (value: string) => {
  content.value = value;
};

const getRequestSystemPrompt = (baseSystemPrompt: string) =>
  [baseSystemPrompt.trim(), fileModeEnabled.value ? FILE_WORKSPACE_SYSTEM_PROMPT : ""]
    .filter(Boolean)
    .join("\n\n");

const handleSubmit = (
  nextContent: string,
  options: { extraInfo?: Record<string, unknown>; systemPrompt?: string } = {},
) => {
  if (!nextContent || !nextContent.trim()) return;
  if (isRequesting.value) return;

  // 草稿态首次发送时，才创建真实会话并写入侧栏
  if (isInDraftMode.value) {
    const newConversation = createNewConversation(options.systemPrompt);
    conversationList.value.unshift(newConversation);
    currentConversationKey.value = String(newConversation.key);
  }

  const conversation = getCurrentConversation();
  if (!conversation) return;
  if (options.systemPrompt !== undefined) {
    conversation.systemPrompt = options.systemPrompt.trim();
  }

  setMessages(currentConversationMessages.value);
  activeRequestConversationKey.value = currentConversationKey.value;

  showWelcome.value = false;
  onRequest(
    {
      messages: [{ role: "user", content: nextContent }],
      model: currentModel.value,
      systemPrompt: getRequestSystemPrompt(conversation.systemPrompt ?? ""),
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
  const baseSystemPrompt = getCurrentConversation()?.systemPrompt ?? "";
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

const copyShareLink = async () => {
  try {
    await navigator.clipboard.writeText("https://openchat.dev/share/current");
    message.success("分享链接已复制");
  } catch {
    message.warning("无法访问剪贴板，请手动复制");
  }
};
</script>

<template>
  <div class="chat-layout">
    <a class="skip-link" href="#chat-content">跳到消息内容</a>
    <button
      v-if="conversationsOpen"
      class="sidebar-backdrop"
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
      @active-change="handleActiveChange"
      @rename="handleSidebarRename"
      @pin="handlePinConversation"
      @archive="handleArchiveConversation"
      @delete="handleDeleteConversation"
    />

    <div class="chat-main">
      <ChatHeader
        :title="currentConversationTitle"
        :sidebar-open="conversationsOpen"
        :workspace-available="workspaceAvailable"
        :workspace-open="workspaceOpen"
        :syncing="isRequesting"
        @toggle-sidebar="handleSidebarToggle"
        @toggle-workspace="workspaceOpen = !workspaceOpen"
        @share="shareOpen = true"
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
        @change="handleChange"
        @cancel="handleCancel"
        @submit="handleSubmit"
        @model-change="handleModelChange"
        @thinking-change="handleThinkingChange"
        @file-mode-change="handleFileModeChange"
        @search-change="handleSearchChange"
        @prompt-click="handlePromptClick"
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

    <Modal
      v-model:open="shareOpen"
      :footer="null"
      centered
      :width="470"
      wrap-class-name="share-dialog-wrap"
    >
      <div class="share-dialog-content">
        <header>
          <h2>分享这段对话</h2>
          <p>拥有链接的人可以查看当前内容。</p>
        </header>
        <label
          ><span>公开链接</span
          ><Input readonly value="https://openchat.dev/share/current"
            ><template #suffix
              ><Button size="small" @click="copyShareLink"><Copy />复制</Button></template
            ></Input
          ></label
        >
        <div class="permission-row">
          <span><strong>允许继续对话</strong><small>访客可以从分享内容创建副本</small></span
          ><Switch v-model:checked="allowSharedCopy" />
        </div>
        <footer>
          <Button @click="shareOpen = false">取消</Button
          ><Button
            type="primary"
            @click="
              shareOpen = false;
              message.success('分享设置已保存');
            "
            >完成</Button
          >
        </footer>
      </div>
    </Modal>

    <Modal
      v-model:open="deleteOpen"
      :footer="null"
      centered
      :width="410"
      wrap-class-name="delete-dialog-wrap"
    >
      <div class="delete-dialog-content">
        <span><Trash2 /></span>
        <h2>删除这段对话？</h2>
        <p>删除后无法恢复，对话中的消息和本地记录都会被移除。</p>
        <footer>
          <Button @click="deleteOpen = false">取消</Button
          ><Button danger type="primary" @click="handleDeleteConversation">删除对话</Button>
        </footer>
      </div>
    </Modal>
  </div>
</template>

<style scoped>
.chat-layout {
  position: relative;
  display: flex;
  min-height: 100dvh;
  height: 100vh;
  overflow: hidden;
  background: var(--brand-background);
  color: var(--brand-foreground);
}

.chat-layout::selection {
  background: var(--brand-surface-subtle);
  color: var(--brand-foreground);
}

.sidebar-backdrop {
  display: none;
}

.chat-main {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  overflow: hidden;
  background: var(--brand-workspace);
}

.share-dialog-content > header h2 {
  margin: 0;
  font-size: 16px;
}
.share-dialog-content > header p {
  margin: 5px 0 0;
  color: var(--brand-muted);
  font-size: 11px;
}
.share-dialog-content > label {
  display: flex;
  flex-direction: column;
  gap: 7px;
  margin-top: 22px;
  font-size: 10px;
  font-weight: 600;
}
.share-dialog-content > label :deep(.ant-input-affix-wrapper) {
  min-height: 42px;
  margin-top: 7px;
}
.share-dialog-content > label :deep(.ant-btn) {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.share-dialog-content > label :deep(svg) {
  width: 12px;
  height: 12px;
}
.permission-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 34px;
  align-items: center;
  gap: 14px;
  min-height: 62px;
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid var(--brand-border);
}
.permission-row > span {
  display: flex;
  flex-direction: column;
}
.permission-row :deep(.ant-switch) {
  position: relative;
  min-width: 44px;
}
.permission-row :deep(.ant-switch)::after {
  position: absolute;
  inset: -11px 0;
  content: "";
}
.permission-row strong {
  font-size: 10px;
}
.permission-row small {
  color: var(--brand-muted);
  font-size: 9px;
}
.share-dialog-content > footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 22px;
}
:global(.share-dialog-wrap .ant-modal-content) {
  padding: 20px;
  border: 1px solid var(--brand-border);
  border-radius: 8px;
}
:global(.share-dialog-wrap .ant-modal-close) {
  top: 13px;
  right: 13px;
}
.delete-dialog-content > span {
  display: grid;
  width: 38px;
  height: 38px;
  place-items: center;
  margin-bottom: 14px;
  border-radius: 6px;
  background: var(--brand-danger-subtle);
  color: var(--brand-danger);
}
.delete-dialog-content > span :deep(svg) {
  width: 17px;
  height: 17px;
}
.delete-dialog-content h2 {
  margin: 0;
  font-size: 16px;
}
.delete-dialog-content p {
  margin: 5px 0 0;
  color: var(--brand-muted);
  font-size: 11px;
  line-height: 1.6;
}
.delete-dialog-content footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 22px;
}
:global(.delete-dialog-wrap .ant-modal-content) {
  padding: 20px;
  border: 1px solid var(--brand-border);
  border-radius: 8px;
}

@media (max-width: 767px) {
  .sidebar-backdrop {
    position: absolute;
    z-index: var(--z-backdrop);
    inset: 0;
    display: block;
    border: 0;
    background: rgba(9, 9, 11, 0.4);
  }

  .chat-main {
    width: 100%;
  }
}

@media (max-width: 560px) {
  :global(.share-dialog-wrap .ant-modal) {
    max-width: 100%;
    margin: 0;
    padding-bottom: 0;
    top: auto;
  }
  :global(.share-dialog-wrap .ant-modal-wrap) {
    display: flex;
    align-items: flex-end;
  }
  :global(.share-dialog-wrap .ant-modal-content),
  :global(.delete-dialog-wrap .ant-modal-content) {
    border-width: 1px 0 0;
    border-radius: 8px 8px 0 0;
  }
  :global(.delete-dialog-wrap .ant-modal) {
    max-width: 100%;
    margin: 0;
    padding-bottom: 0;
    top: auto;
  }
}
</style>

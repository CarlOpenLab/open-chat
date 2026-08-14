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
  type PermissionRequest,
} from "../services/OpenChatProvider";
import {
  A2UI_SUBMISSION_MESSAGE_KIND,
  appendA2UISurfaceIdContext,
  createA2UISubmission,
  formatA2UISubmissionAsUserMessage,
  isA2UISubmissionContextMessage,
  type A2UIActionPayload,
} from "../utils/a2ui";
import {
  collectFileWorkspaceState,
  collectWorkspaceDiffStats,
  type EditableWorkspaceFile,
} from "../utils/fileWorkspace";
import { FILE_WORKSPACE_SYSTEM_PROMPT } from "../prompts/fileWorkspace";
import {
  createAssistantConversationSnapshot,
  getAssistantById,
} from "../features/assistant-market/catalog";
import type { AssistantConversationSnapshot } from "../features/assistant-market/types";
import { loadChatState } from "../services/chatStorage";
import {
  API_AGENT,
  flattenAcpSelectOptions,
  loadAcpAgents,
  loadAcpSession,
  setAcpSessionConfig,
  type AcpSessionState,
  type AgentView,
} from "../services/acp";
import { useChatModels, type ModelCatalogEntry } from "../composables/useChatModels";
import {
  getMessagePreview,
  useChatPersistence,
  type OpenChatConversation,
} from "../composables/useChatPersistence";
import ChatSidebar from "./chat/ChatSidebar.vue";
import ChatHeader from "./chat/ChatHeader.vue";
import ChatMessages from "./chat/ChatMessages.vue";
import ChatInput from "./chat/ChatInput.vue";
import RightPanel from "./chat/RightPanel.vue";
import CommandPalette from "./chat/CommandPalette.vue";
import SettingsDialog from "./chat/SettingsDialog.vue";
import DeleteConversationModal from "./chat/DeleteConversationModal.vue";
import PermissionRequestModal from "./chat/PermissionRequestModal.vue";
import AssistantCenterModal from "./chat/AssistantCenterModal.vue";

interface Props {
  dark: boolean;
  /** 主题模式：跟随系统 / 浅色 / 深色 */
  themeMode?: "system" | "light" | "dark";
}

interface Emits {
  (e: "toggleTheme"): void;
  (e: "themeModeChange", mode: "system" | "light" | "dark"): void;
}

withDefaults(defineProps<Props>(), { themeMode: "system" });
const emit = defineEmits<Emits>();

// ============ 响应式状态 ============

const content = ref("");
const conversationsOpen = ref(true);
const rightPanelOpen = ref(false);
const deleteOpen = ref(false);
const currentConversationKey = ref<string>("");
const thinkingEnabled = ref(true);
const fileModeEnabled = ref(false);
const selectedWorkspacePath = ref<string[]>([]);
const searchEnabled = ref(false);
const pendingSearchSources = ref<WebSearchSourceItem[] | null>(null);
const pendingA2UISurfaceId = ref("");
const showWelcome = ref(true);
const isHydrating = ref(true);
const activeRequestConversationKey = ref<string>("");
/** 请求开始时间，供侧栏「工作中」条目计时 */
const requestStartedAt = ref(0);
const draftAssistant = ref<AssistantConversationSnapshot | null>(null);
const assistantCenterOpen = ref(false);
const assistantCenterView = ref<"market" | "installed">("market");
const commandPaletteOpen = ref(false);
const settingsOpen = ref(false);
const agents = ref<AgentView[]>([API_AGENT]);
const activeAgentId = ref("api");
const acpSession = ref<AcpSessionState | null>(null);
const acpSessionLoading = ref(false);
const draftConversationKey = ref("");

// 面板尺寸（sidebar 180–420，right panel 280–1000）
/** 默认 sidebar 252，拖拽区间 SIDEBAR_MIN/MAX_WIDTH = 180 / 420 */
const sidebarWidth = ref(252);
const rightPanelWidth = ref(420);
const resizing = ref<"sidebar" | "right-panel" | null>(null);

// 会话历史导航（◀ ▶）
const historyBack = ref<string[]>([]);
const historyForward = ref<string[]>([]);
const historyLocked = ref(false);

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
  preferredKey: string = "",
): OpenChatConversation => {
  const key = preferredKey || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
    updatedAt: Date.now(),
    messages: initialMessages,
    a2uiSubmissions: [],
    workspaceDrafts: [],
    systemPrompt,
    agentId: activeAgentId.value,
    ...(assistant ? { assistant } : {}),
  };
};

const conversationList = ref<OpenChatConversation[]>([]);
const visibleConversationList = computed(() =>
  conversationList.value.filter(
    (conversation) => (conversation.agentId || "api") === activeAgentId.value,
  ),
);
const activeAgent = computed(
  () => agents.value.find((agent) => agent.id === activeAgentId.value) ?? API_AGENT,
);
const isAcpAgent = computed(() => activeAgent.value.kind === "acp");

// ============ 模型加载 ============

const {
  currentModel,
  searchAvailable,
  modelCatalog,
  currentModelLabel,
  reconcileCurrentModel,
  getForwardProvider,
  loadModels,
} = useChatModels();

loadModels();

const activeAcpModelOption = computed(() =>
  acpSession.value?.configOptions.find(
    (option) =>
      option.type === "select" &&
      (option.category === "model" ||
        option.id.toLowerCase() === "model" ||
        option.name.toLowerCase() === "model"),
  ),
);
const acpModelCatalog = computed<ModelCatalogEntry[]>(() => {
  const option = activeAcpModelOption.value;
  if (!option || option.type !== "select") return [];
  return [
    {
      providerId: activeAgent.value.id,
      providerName: activeAgent.value.name,
      models: flattenAcpSelectOptions(option.options).map((model) => ({
        id: model.value,
        name: model.name || model.value,
      })),
    },
  ];
});
const inputModelCatalog = computed(() =>
  isAcpAgent.value ? acpModelCatalog.value : modelCatalog.value,
);
const inputCurrentModel = computed(() => {
  const option = activeAcpModelOption.value;
  return isAcpAgent.value && option?.type === "select" ? option.currentValue : currentModel.value;
});
const inputCurrentModelLabel = computed(() => {
  if (!isAcpAgent.value) return currentModelLabel.value;
  const option = activeAcpModelOption.value;
  if (!option || option.type !== "select") {
    return acpSessionLoading.value ? "读取模型..." : "由 Agent 决定";
  }
  const selected = flattenAcpSelectOptions(option.options).find(
    (model) => model.value === option.currentValue,
  );
  return selected?.name || option.currentValue;
});

const ensureDraftConversationKey = (): string => {
  if (!draftConversationKey.value) {
    draftConversationKey.value = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
  return draftConversationKey.value;
};

let acpSessionLoadSequence = 0;
const refreshAcpSession = async () => {
  const sequence = ++acpSessionLoadSequence;
  if (!isAcpAgent.value || !activeAgent.value.available || isHydrating.value) {
    acpSession.value = null;
    acpSessionLoading.value = false;
    return;
  }
  const conversationId = currentConversationKey.value || ensureDraftConversationKey();
  acpSessionLoading.value = true;
  try {
    const session = await loadAcpSession(activeAgentId.value, conversationId);
    if (sequence === acpSessionLoadSequence) acpSession.value = session;
  } catch (error) {
    if (sequence !== acpSessionLoadSequence) return;
    acpSession.value = null;
    console.error("Failed to load agent session options:", error);
    message.error(error instanceof Error ? error.message : "Agent 模型配置加载失败");
  } finally {
    if (sequence === acpSessionLoadSequence) acpSessionLoading.value = false;
  }
};

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
      rightPanelOpen.value = true;
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

/** Maps an assistant message id to the web-search sources attached to it. */
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
/** 顶栏 `+N -M`：本地草稿相对 AI 版本的真实增删行数 */
const workspaceDiffStats = computed(() => collectWorkspaceDiffStats(editableWorkspaceFiles.value));

const updateConversationMessages = (
  conversationKey: string,
  newMessages: DefaultMessageInfo<XModelMessage>[],
) => {
  if (!conversationKey) return;
  const conv = conversationList.value.find((c) => c.key === conversationKey);
  if (!conv) return;

  conv.messages = newMessages;
  conv.updatedAt = Date.now();

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
  historyBack.value = [];
  historyForward.value = [];
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
  rightPanelOpen.value = fileModeEnabled.value;
  searchEnabled.value = assistant.capabilities.includes("web-search") && searchAvailable.value;
  assistantCenterOpen.value = false;
  window.history.replaceState({}, "", "/chat");
  message.success(`已切换到「${assistant.name}」`);
};

const pushHistory = (key: string) => {
  if (historyLocked.value) return;
  historyBack.value.push(key);
  historyForward.value = [];
};

const handleActiveChange: ConversationsProps["onActiveChange"] = (key) => {
  if (String(key) !== currentConversationKey.value) {
    pushHistory(currentConversationKey.value || "");
  }
  currentConversationKey.value = key;
  const conv = getCurrentConversation();
  if (conv) {
    showWelcome.value = conv.messages.length === 0;
  }
  if (window.matchMedia("(max-width: 767px)").matches) {
    closeSidebar();
  }
};

const handleNavigateBack = () => {
  if (historyBack.value.length === 0) return;
  historyLocked.value = true;
  historyForward.value.push(currentConversationKey.value);
  const prev = historyBack.value.pop() ?? "";
  currentConversationKey.value = prev;
  const conv = getCurrentConversation();
  showWelcome.value = conv ? conv.messages.length === 0 : true;
  historyLocked.value = false;
};

const handleNavigateForward = () => {
  if (historyForward.value.length === 0) return;
  historyLocked.value = true;
  historyBack.value.push(currentConversationKey.value);
  const next = historyForward.value.pop() ?? "";
  currentConversationKey.value = next;
  const conv = getCurrentConversation();
  showWelcome.value = conv ? conv.messages.length === 0 : true;
  historyLocked.value = false;
};

const handleSidebarToggle = () => {
  conversationsOpen.value = !conversationsOpen.value;
};

const handleAgentChange = (agentId: string) => {
  if (agentId === activeAgentId.value) return;
  if (isRequesting.value) {
    message.warning("请先停止当前 Agent 任务再切换供应商");
    return;
  }
  const next = agents.value.find((agent) => agent.id === agentId);
  if (!next) return;
  draftConversationKey.value = "";
  acpSession.value = null;
  activeAgentId.value = next.id;
  localStorage.setItem("open-chat-agent", next.id);
  currentConversationKey.value = "";
  setMessages([]);
  showWelcome.value = true;
  historyBack.value = [];
  historyForward.value = [];
  draftAssistant.value = null;
  if (!next.available) {
    message.warning(next.adapterHint || `${next.name} 当前不可用，请检查本地 CLI 安装与登录状态`);
  }
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
      // 权限询问期间模型回合暂停，前端可能长时间无流数据；调大避免被 streamTimeout 提前掐断。
      streamTimeout: 10 * 60 * 1000,
    }),
  });
};

const provider = createProvider();
const pendingPermission = ref<PermissionRequest | null>(null);
provider.onPermissionRequest = (request) => {
  pendingPermission.value = request;
};
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

const {
  applyPersistedState,
  schedulePersistState,
  handleExportLocalHistory,
  handleImportLocalHistory,
  handleClearLocalHistory,
} = useChatPersistence({
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
  if (requesting) {
    requestStartedAt.value = Date.now();
    return;
  }
  attachPendingSearchSources();
  activeRequestConversationKey.value = "";
  pendingA2UISurfaceId.value = "";
  pendingPermission.value = null;
  requestStartedAt.value = 0;
});

watch([activeAgentId, currentConversationKey, isHydrating], () => {
  void refreshAcpSession();
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
      rightPanelOpen.value = true;
    }
  },
  { deep: true },
);

const handleWorkspaceKeydown = (event: KeyboardEvent) => {
  if (event.key === "Escape") {
    commandPaletteOpen.value = false;
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
    rightPanelOpen.value = false;
  }

  const [persistedState, loadedAgents] = await Promise.all([
    loadChatState(),
    loadAcpAgents().catch((error) => {
      console.error("Failed to load local agents:", error);
      return [API_AGENT];
    }),
  ]);
  agents.value = loadedAgents;
  const storedAgentId = localStorage.getItem("open-chat-agent") || "";
  const storedAgent = loadedAgents.find((agent) => agent.id === storedAgentId);
  const firstAvailableAcp = loadedAgents.find((agent) => agent.kind === "acp" && agent.available);
  activeAgentId.value = storedAgent?.id ?? firstAvailableAcp?.id ?? "api";

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
  window.removeEventListener("mousemove", handleResizeMove);
  window.removeEventListener("mouseup", handleResizeEnd);
});

// ============ 面板拖拽调整宽度 ============

const handleResizeStart = (target: "sidebar" | "right-panel") => (event: MouseEvent) => {
  event.preventDefault();
  resizing.value = target;
  window.addEventListener("mousemove", handleResizeMove);
  window.addEventListener("mouseup", handleResizeEnd);
};

const handleResizeMove = (event: MouseEvent) => {
  if (resizing.value === "sidebar") {
    sidebarWidth.value = Math.min(420, Math.max(180, event.clientX));
  } else if (resizing.value === "right-panel") {
    rightPanelWidth.value = Math.min(1000, Math.max(280, window.innerWidth - event.clientX));
  }
};

const handleResizeEnd = () => {
  resizing.value = null;
  window.removeEventListener("mousemove", handleResizeMove);
  window.removeEventListener("mouseup", handleResizeEnd);
};

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
      // 工具调用 / 上游错误 / 重试提示：由 OpenChatProvider 累积在消息对象上。
      extraInfo: {
        toolCalls: Array.isArray(modelMessage.toolCalls) ? modelMessage.toolCalls : undefined,
        chatError: typeof modelMessage.chatError === "string" ? modelMessage.chatError : undefined,
        chatNotices: Array.isArray(modelMessage.chatNotices) ? modelMessage.chatNotices : undefined,
        agentPlan:
          modelMessage.agentPlan && typeof modelMessage.agentPlan === "object"
            ? modelMessage.agentPlan
            : undefined,
      },
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

/** 回复 opencode 权限询问：允许一次 / 始终允许 / 拒绝。 */
const handlePermissionResponse = async (response: "once" | "always" | "reject"): Promise<void> => {
  const permission = pendingPermission.value;
  if (!permission) return;
  const conversationId = activeRequestConversationKey.value || currentConversationKey.value;
  if (!conversationId) return;

  const responseText = response === "reject" ? "reject" : response === "always" ? "always" : "once";
  try {
    const res = await fetch(`${API_BASE_URL}/api/chat/permission`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(GATEWAY_API_KEY ? { Authorization: `Bearer ${GATEWAY_API_KEY}` } : {}),
      },
      body: JSON.stringify({
        conversationId,
        permissionId: permission.id,
        response: responseText,
        version: permission.version,
        agentId: permission.agentId,
      }),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      throw new Error(data.error?.message || `权限回复失败（HTTP ${res.status}）`);
    }
    // 回复成功后由 opencode 侧 session.replied 事件结束本轮权限等待。
    pendingPermission.value = null;
  } catch (err) {
    message.error(err instanceof Error ? err.message : "权限回复失败，请重试");
  }
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
  if (!activeAgent.value.available) {
    message.warning(
      activeAgent.value.adapterHint ||
        `${activeAgent.value.name} 当前不可用，请检查本地 CLI 安装与登录状态`,
    );
    return;
  }

  // 草稿态首次发送时，才创建真实会话并写入侧栏
  if (isInDraftMode.value) {
    const assistant = options.assistant ?? draftAssistant.value;
    const newConversation = createNewConversation(
      options.systemPrompt ?? assistant?.renderedSystemPrompt ?? "",
      assistant,
      isAcpAgent.value ? ensureDraftConversationKey() : "",
    );
    conversationList.value.unshift(newConversation);
    currentConversationKey.value = String(newConversation.key);
    draftConversationKey.value = "";
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
  const forwardProvider = getForwardProvider(currentModel.value);
  onRequest(
    {
      messages: [{ role: "user", content: nextContent }],
      model: inputCurrentModel.value,
      systemPrompt: getRequestSystemPrompt(
        conversation.assistant?.renderedSystemPrompt ?? conversation.systemPrompt ?? "",
      ),
      enable_thinking: thinkingEnabled.value,
      thinking: { type: thinkingEnabled.value ? "enabled" : "disabled" },
      // 本地 opencode（服务端 AI）：按会话复用长会话，无需转发目标。
      conversationId: String(conversation.key),
      ...(isAcpAgent.value ? { acpAgentId: activeAgentId.value } : {}),
      // 手动配置的服务商：随请求携带转发目标（baseUrl / apiKey / api）
      ...(!isAcpAgent.value && forwardProvider ? { provider: forwardProvider } : {}),
      ...(!isAcpAgent.value && searchEnabled.value ? { web_search: true } : {}),
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

const handleModelChange = async (key: string) => {
  if (!isAcpAgent.value) {
    currentModel.value = key;
    return;
  }
  if (isRequesting.value || acpSessionLoading.value) return;
  const session = acpSession.value;
  const option = activeAcpModelOption.value;
  if (!session || !option || option.type !== "select") return;

  acpSessionLoading.value = true;
  try {
    acpSession.value = await setAcpSessionConfig(
      activeAgentId.value,
      session.conversationId,
      option.id,
      key,
    );
    message.success(`已切换到 ${inputCurrentModelLabel.value}`);
  } catch (error) {
    message.error(error instanceof Error ? error.message : "Agent 模型切换失败");
  } finally {
    acpSessionLoading.value = false;
  }
};

const handleThinkingChange = (value: boolean) => {
  thinkingEnabled.value = value;
};

const handleFileModeChange = (value: boolean) => {
  fileModeEnabled.value = value;
  if (value) rightPanelOpen.value = true;
  else if (!currentFileWorkspace.value.hasWorkspace) rightPanelOpen.value = false;
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
  const forwardProvider = getForwardProvider(currentModel.value);
  onReload(messageId, {
    model: inputCurrentModel.value,
    systemPrompt: getRequestSystemPrompt(baseSystemPrompt),
    // 本地 opencode：复用同一会话长会话
    conversationId: String(currentConversation?.key ?? ""),
    ...(isAcpAgent.value ? { acpAgentId: activeAgentId.value } : {}),
    // 手动配置的服务商：随请求携带转发目标（baseUrl / apiKey / api）
    ...(!isAcpAgent.value && forwardProvider ? { provider: forwardProvider } : {}),
    ...(!isAcpAgent.value && searchEnabled.value ? { web_search: true } : {}),
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
  historyBack.value = [];
  historyForward.value = [];
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

// ============ 命令面板 / 设置 ============

const handleCommandPaletteSelectConversation = (key: string) => {
  handleActiveChange(key);
};
</script>

<template>
  <div
    class="chat-app chat-layout relative flex h-screen min-h-[100dvh] overflow-hidden bg-brand-background text-brand-foreground selection:bg-brand-surface-subtle selection:text-brand-foreground"
  >
    <a class="skip-link" href="#chat-content">跳到消息内容</a>

    <!-- 移动端侧栏遮罩 -->
    <button
      v-if="conversationsOpen"
      class="sidebar-backdrop absolute inset-0 z-backdrop border-0 bg-[rgba(9,9,11,0.4)]"
      type="button"
      aria-label="关闭对话侧栏"
      @click="closeSidebar"
    ></button>

    <!-- 左侧栏：可拖拽宽度，收起 / 展开有滑动动画 -->
    <div
      class="sidebar-shell relative flex h-full flex-none"
      :class="{
        'sidebar-shell-open': conversationsOpen,
        'sidebar-shell-resizing': resizing === 'sidebar',
      }"
      :style="{ width: (conversationsOpen ? sidebarWidth : 0) + 'px' }"
    >
      <!-- 收起动画期间内容保持固定宽度，从右侧被裁掉而不是被压扁换行 -->
      <div class="sidebar-clip h-full w-full overflow-hidden">
        <div class="h-full" :style="{ width: sidebarWidth + 'px' }">
          <ChatSidebar
            :open="conversationsOpen"
            :conversation-list="visibleConversationList"
            :current-key="currentConversationKey"
            :can-go-back="historyBack.length > 0"
            :can-go-forward="historyForward.length > 0"
            :busy-key="isRequesting ? activeRequestConversationKey : ''"
            :busy-since="requestStartedAt"
            :dark="dark"
            :agents="agents"
            :active-agent-id="activeAgentId"
            @toggle-sidebar="handleSidebarToggle"
            @toggle-theme="emit('toggleTheme')"
            @new-conversation="handleNewConversation"
            @open-search="commandPaletteOpen = true"
            @open-assistant-center="openAssistantCenter('market')"
            @open-settings="settingsOpen = true"
            @navigate-back="handleNavigateBack"
            @navigate-forward="handleNavigateForward"
            @active-change="handleActiveChange"
            @rename="handleSidebarRename"
            @pin="handlePinConversation"
            @archive="handleArchiveConversation"
            @delete="handleDeleteConversation"
            @agent-change="handleAgentChange"
          />
        </div>
      </div>
      <button
        v-if="conversationsOpen"
        type="button"
        class="absolute top-0 right-[-3px] z-10 h-full w-[6px] cursor-col-resize border-0 bg-transparent p-0 hover:bg-brand-resize"
        :class="{ 'bg-brand-resize': resizing === 'sidebar' }"
        aria-label="调整侧边栏宽度"
        @mousedown="handleResizeStart('sidebar')"
      ></button>
    </div>

    <!-- 主区 -->
    <div class="chat-main flex min-w-0 flex-1 flex-col overflow-hidden bg-brand-workspace">
      <ChatHeader
        :title="currentConversationTitle"
        :sidebar-open="conversationsOpen"
        :right-panel-open="rightPanelOpen"
        :right-panel-available="workspaceAvailable"
        :syncing="isRequesting"
        :assistant-name="activeAssistant?.name"
        :assistant-version="activeAssistant?.version"
        :can-go-back="historyBack.length > 0"
        :can-go-forward="historyForward.length > 0"
        :diff-added="workspaceDiffStats.added"
        :diff-removed="workspaceDiffStats.removed"
        :agent-name="activeAgent.name"
        :agent-available="activeAgent.available"
        :agent-protocol="activeAgent.protocol"
        :agent-kind="activeAgent.kind"
        @toggle-sidebar="handleSidebarToggle"
        @toggle-right-panel="rightPanelOpen = !rightPanelOpen"
        @navigate-back="handleNavigateBack"
        @navigate-forward="handleNavigateForward"
        @export="handleExportLocalHistory"
        @rename="handleRenameConversation"
        @pin="handlePinConversation"
        @archive="handleArchiveConversation"
        @delete="deleteOpen = true"
      />

      <!-- 消息区 -->
      <div class="relative min-h-0 flex-1 overflow-hidden">
        <ChatMessages
          :show-welcome="showWelcome && currentConversationMessages.length === 0"
          :bubble-items="bubbleItems"
          :dark="dark"
          :conversation-key="currentConversationKey"
          :starter-prompts="activeStarterPrompts"
          :a2ui-pending-surface-id="pendingA2UISurfaceId"
          :a2ui-submissions="currentA2UISubmissions"
          :search-results-by-message-id="searchResultsByMessageId"
          @a2ui-action="handleA2UIAction"
          @reload="handleReloadMessage"
          @prompt-click="handlePromptClick"
        />
      </div>

      <ChatInput
        v-model="content"
        :loading="isRequesting"
        :current-model="inputCurrentModel"
        :current-model-label="inputCurrentModelLabel"
        :model-catalog="inputModelCatalog"
        :thinking-enabled="thinkingEnabled"
        :file-mode-enabled="fileModeEnabled"
        :search-enabled="searchEnabled"
        :search-available="searchAvailable"
        :assistant-name="activeAssistant?.name"
        :agent-mode="isAcpAgent"
        :agent-name="activeAgent.name"
        :agent-available="activeAgent.available"
        :agent-protocol="activeAgent.protocol"
        :agent-configuring="acpSessionLoading"
        @change="handleChange"
        @cancel="handleCancel"
        @submit="handleSubmit"
        @model-change="handleModelChange"
        @thinking-change="handleThinkingChange"
        @file-mode-change="handleFileModeChange"
        @search-change="handleSearchChange"
        @assistant-select="openAssistantCenter('market')"
      />
    </div>

    <!-- 右侧面板：可拖拽宽度 -->
    <div
      v-if="rightPanelOpen"
      class="right-panel-shell relative flex h-full flex-none"
      :class="{ 'right-panel-shell-open': rightPanelOpen }"
      :style="{ width: rightPanelWidth + 'px' }"
    >
      <button
        type="button"
        class="absolute top-0 left-[-3px] z-10 h-full w-[6px] cursor-col-resize border-0 bg-transparent p-0 hover:bg-brand-resize"
        :class="{ 'bg-brand-resize': resizing === 'right-panel' }"
        aria-label="调整右侧面板宽度"
        @mousedown="handleResizeStart('right-panel')"
      ></button>
      <RightPanel
        :open="true"
        :dark="dark"
        :files="editableWorkspaceFiles"
        :workspace-pending="
          isRequesting &&
          fileModeEnabled &&
          (currentFileWorkspace.pending || currentFileWorkspace.files.length === 0)
        "
        :selected-path="selectedWorkspacePath"
        @update:open="rightPanelOpen = $event"
        @update:selected-path="selectedWorkspacePath = $event"
        @file-change="handleWorkspaceFileChange"
        @reset-file="clearWorkspaceDraft($event, '已恢复 AI 版本')"
        @accept-incoming="clearWorkspaceDraft($event, '已采用 AI 新版本')"
      />
    </div>

    <DeleteConversationModal v-model:open="deleteOpen" @confirm="handleDeleteConversation" />
    <PermissionRequestModal
      :open="!!pendingPermission"
      :request="pendingPermission"
      @allow="handlePermissionResponse($event)"
    />
    <AssistantCenterModal
      :open="assistantCenterOpen"
      :dark="dark"
      :initial-view="assistantCenterView"
      @close="assistantCenterOpen = false"
      @use="handleAssistantUse"
    />

    <CommandPalette
      :open="commandPaletteOpen"
      :conversation-list="visibleConversationList"
      :dark="dark"
      @update:open="commandPaletteOpen = $event"
      @new-conversation="handleNewConversation"
      @open-assistant-center="openAssistantCenter('market')"
      @open-settings="settingsOpen = true"
      @toggle-theme="emit('toggleTheme')"
      @toggle-sidebar="handleSidebarToggle"
      @toggle-right-panel="rightPanelOpen = !rightPanelOpen"
      @export-history="handleExportLocalHistory"
      @clear-history="handleClearLocalHistory"
      @select-conversation="handleCommandPaletteSelectConversation"
    />

    <SettingsDialog
      :open="settingsOpen"
      :dark="dark"
      :theme-mode="themeMode"
      @update:open="settingsOpen = $event"
      @theme-mode-change="emit('themeModeChange', $event)"
      @export-history="handleExportLocalHistory"
      @import-history="handleImportLocalHistory"
      @clear-history="handleClearLocalHistory"
    />
  </div>
</template>

<style scoped>
/* 767px 为非常规断点（与脚本中 matchMedia 保持一致），display 切换整体保留在 CSS 中 */
.sidebar-backdrop {
  display: none;
}

/* 桌面端收起 / 展开：宽度过渡；拖拽调宽时禁掉过渡，否则手柄跟不上鼠标 */
.chat-layout > .sidebar-shell {
  transition: width 240ms cubic-bezier(0.2, 0, 0, 1);
}
.chat-layout > .sidebar-shell.sidebar-shell-resizing {
  transition: none;
}

@media (max-width: 767px) {
  .sidebar-backdrop {
    display: block;
  }

  .chat-main {
    width: 100%;
  }

  /* 移动端侧栏变为覆盖式抽屉；宽度压住行内样式，收起时才有完整的滑出动画 */
  .chat-layout > .sidebar-shell {
    position: fixed;
    z-index: var(--z-sidebar);
    top: 0;
    bottom: 0;
    left: 0;
    width: min(300px, 86vw) !important;
    height: 100dvh;
    box-shadow: 18px 0 46px rgba(9, 9, 11, 0.18);
    transition: transform 220ms ease;
    transform: translateX(-104%);
  }
  .chat-layout > .sidebar-shell.sidebar-shell-open {
    transform: translateX(0);
  }
  /* 抽屉宽度由 shell 决定，内层固定宽度只服务于桌面端裁切动画 */
  .chat-layout > .sidebar-shell .sidebar-clip > div {
    width: 100% !important;
  }

  /* 移动端右侧面板同样覆盖 */
  .chat-layout > .right-panel-shell {
    position: fixed;
    z-index: var(--z-sidebar);
    top: 0;
    right: 0;
    bottom: 0;
    height: 100dvh;
    box-shadow: -18px 0 46px rgba(9, 9, 11, 0.18);
    transition: transform 220ms ease;
    transform: translateX(104%);
  }
  .chat-layout > .right-panel-shell.right-panel-shell-open {
    transform: translateX(0);
  }
}
</style>

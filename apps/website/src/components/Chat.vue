<script setup lang="ts">
import type { ConversationsProps } from "@antdv-next/x";
import type { DefaultMessageInfo } from "@antdv-next/x-sdk";
import type { XModelMessage, XModelResponse } from "@antdv-next/x-sdk";
import { XRequest, useXChat } from "@antdv-next/x-sdk";
import { message } from "antdv-next";
import { computed, ref, watch, onMounted, onBeforeUnmount } from "vue";
import {
  API_BASE_URL,
  GATEWAY_API_KEY,
  aiService,
  type UploadedAttachment,
  type WebSearchSourceItem,
} from "../services/ai";
import {
  OpenChatProvider,
  WEB_SEARCHING_MARKER,
  type AcpRunStateNotice,
  type OpenChatParams,
  type PermissionRequest,
} from "../services/OpenChatProvider";
import {
  A2UI_SUBMISSION_MESSAGE_KIND,
  appendA2UISurfaceIdContext,
  createA2UISubmission,
  formatA2UISubmissionAsUserMessage,
  type A2UIActionPayload,
} from "../utils/a2ui";
import {
  collectFileWorkspaceState,
  collectWorkspaceDiffStats,
  type EditableWorkspaceFile,
} from "../utils/fileWorkspace";
import { FILE_WORKSPACE_SYSTEM_PROMPT } from "../prompts/fileWorkspace";
import { loadChatState } from "../services/chatStorage";
import {
  API_AGENT,
  cancelAcpTurn,
  flattenAcpSelectOptions,
  loadAcpAgents,
  loadAcpProviderSessions,
  loadAcpSession,
  loadOpenChatSessions,
  setAcpSessionConfig,
  subscribeAcpSessionStream,
  type AcpSessionState,
  type AgentView,
  type OpenChatSessionView,
} from "../services/acp";
import {
  appendTranscriptMessageToModelMessages,
  modelMessagesToBubbleItems,
  transcriptHistoryToModelMessages,
  type TranscriptMessage,
} from "../services/transcript";
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
/**
 * Render the outgoing message before the XChat store has emitted its first
 * snapshot. The store remains the source of truth; this is only a short-lived
 * visual bridge and is de-duplicated by optimisticId once the real item lands.
 */
const optimisticMessage = ref<{
  conversationKey: string;
  id: string;
  message: XModelMessage;
  extraInfo: Record<string, unknown>;
} | null>(null);
const conversationsOpen = ref(true);
const rightPanelOpen = ref(false);
const deleteOpen = ref(false);
const currentConversationKey = ref<string>("");
const thinkingEnabled = ref(true);
const workMode = ref<"build" | "plan">("build");
const permissionMode = ref<"supervised" | "auto" | "full">("full");
const fileModeEnabled = ref(false);
const projectPath = ref("");
const draftProjectPath = ref("");
const defaultProjectPath = ref("");
const PROJECT_PATH_HISTORY_KEY = "open-chat-project-paths-v1";
const projectPathHistory = ref<Record<string, string[]>>({});
const selectedWorkspacePath = ref<string[]>([]);
const pendingSearchSources = ref<WebSearchSourceItem[] | null>(null);
const pendingA2UISurfaceId = ref("");
const showWelcome = ref(true);
const isHydrating = ref(true);
const activeRequestConversationKey = ref<string>("");
/** 请求开始时间，供侧栏「工作中」条目计时 */
const requestStartedAt = ref(0);
const turnTimingStarts = new Map<string, number>();
const turnTimingValues = new Map<string, { startedAtMs?: number; durationMs: number }>();

interface MessageTimingExtraInfo {
  turnStartedAtMs?: unknown;
  turnDurationMs?: unknown;
}

const messageTimingKey = (conversationKey: string, messageId: string | number): string =>
  `${conversationKey}::${String(messageId)}`;

const timingExtraInfo = (extraInfo: Record<string, unknown> | undefined): MessageTimingExtraInfo =>
  extraInfo ?? {};

/**
 * Keep turn timing on the exact assistant message that produced it. The
 * conversation key scopes identical provider message ids across sessions.
 */
const persistMessageTimings = (
  conversationKey: string,
  source: DefaultMessageInfo<XModelMessage>[],
): DefaultMessageInfo<XModelMessage>[] => {
  if (!conversationKey) return source;
  const now = Date.now();
  let changed = false;
  const next = source.map((item) => {
    if (item.message.role !== "assistant") return item;

    if (item.id === undefined || item.id === null || String(item.id) === "") return item;
    const key = messageTimingKey(conversationKey, item.id);
    const streaming = item.status === "loading" || item.status === "updating";
    const extraInfo = item.extraInfo as Record<string, unknown> | undefined;
    const timing = timingExtraInfo(extraInfo);

    if (streaming) {
      if (!turnTimingStarts.has(key)) turnTimingStarts.set(key, now);
      turnTimingValues.delete(key);
      if ("turnStartedAtMs" in timing || "turnDurationMs" in timing) {
        const { turnStartedAtMs: _startedAt, turnDurationMs: _duration, ...rest } = timing;
        changed = true;
        return {
          ...item,
          extraInfo: Object.keys(rest).length ? rest : undefined,
        };
      }
      return item;
    }

    const startedAtMs = turnTimingStarts.get(key);
    const persistedDuration =
      typeof timing.turnDurationMs === "number" && timing.turnDurationMs > 0
        ? timing.turnDurationMs
        : undefined;
    if (persistedDuration) {
      turnTimingValues.set(key, {
        startedAtMs:
          typeof timing.turnStartedAtMs === "number" ? timing.turnStartedAtMs : undefined,
        durationMs: persistedDuration,
      });
      return item;
    }

    if (!startedAtMs) {
      const cachedTiming = turnTimingValues.get(key);
      if (!cachedTiming) return item;

      changed = true;
      return {
        ...item,
        extraInfo: {
          ...extraInfo,
          ...(cachedTiming.startedAtMs !== undefined
            ? { turnStartedAtMs: cachedTiming.startedAtMs }
            : {}),
          turnDurationMs: cachedTiming.durationMs,
        },
      };
    }

    turnTimingStarts.delete(key);
    const durationMs = Math.max(1, now - startedAtMs);
    turnTimingValues.set(key, { startedAtMs, durationMs });
    changed = true;
    return {
      ...item,
      extraInfo: {
        ...extraInfo,
        turnStartedAtMs: startedAtMs,
        turnDurationMs: durationMs,
      },
    };
  });
  return changed ? next : source;
};
const commandPaletteOpen = ref(false);
const settingsOpen = ref(false);
const agents = ref<AgentView[]>([API_AGENT]);
const activeAgentId = ref("api");
const acpSession = ref<AcpSessionState | null>(null);
const acpSessionLoading = ref(false);
/** ACP 会话运行状态（running / idle / requires_action），由服务端 activeRuns 推导经 /api/acp/session 返回。 */
const acpRunState = ref<AcpRunStateNotice | null>(null);
/** 会话实时输出订阅（多标签 / 刷新恢复后观看运行中的回合）。 */
const acpStreamController = ref<AbortController | null>(null);
let acpStreamMessageSeq = 0;
const openChatSessions = ref<OpenChatSessionView[]>([]);
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

// ============ URL 会话路由 ============
// URL 格式：/chat/{agentId}/{sessionId}，sessionId 优先用供应商真实会话 id（ACP），
// 其次用本地会话 key。复制链接即可直达对应供应商的会话。

const safeDecode = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

/** 将当前打开的会话同步到 URL（push 记历史 / replace 原地替换）。 */
const syncConversationRoute = (mode: "push" | "replace") => {
  const conversation = getCurrentConversation();
  const sessionPart = conversation?.providerSessionId?.trim() || currentConversationKey.value || "";
  const path = sessionPart
    ? `/chat/${encodeURIComponent(activeAgentId.value)}/${encodeURIComponent(sessionPart)}`
    : `/chat/${encodeURIComponent(activeAgentId.value)}`;
  window.history[mode === "push" ? "pushState" : "replaceState"]({}, "", path);
};

const parseChatRoute = (path: string): { agentId: string; sessionId: string } | null => {
  const match = path.match(/^\/chat(?:\/([^/]+)(?:\/([^/]+))?)?\/?$/);
  if (!match) return null;
  return {
    agentId: match[1] ? safeDecode(match[1]) : "",
    sessionId: match[2] ? safeDecode(match[2]) : "",
  };
};

const createNewConversation = (
  systemPrompt: string = "",
  preferredKey: string = "",
  modelId: string = "",
): OpenChatConversation => {
  const key = preferredKey || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  return {
    key,
    label: "新对话",
    group: "今天",
    updatedAt: Date.now(),
    messages: [],
    a2uiSubmissions: [],
    workspaceDrafts: [],
    systemPrompt,
    agentId: activeAgentId.value,
    modelId,
  };
};

const conversationList = ref<OpenChatConversation[]>([]);
const activeAgent = computed(
  () => agents.value.find((agent) => agent.id === activeAgentId.value) ?? API_AGENT,
);
const isAcpAgent = computed(() => activeAgent.value.kind === "acp");
const usesAcpProtocol = computed(() => activeAgent.value.protocol === "ACP");
// pi / omp（Oh My Pi）走原生 RPC，无权限事件，权限固定为完全访问。
const isPiAgent = computed(() => {
  const id = activeAgent.value.id.toLowerCase();
  const name = activeAgent.value.name.toLowerCase();
  return id === "pi" || id === "omp" || name === "pi" || name === "oh my pi";
});
const effectivePermissionMode = computed(() => (isPiAgent.value ? "full" : permissionMode.value));

const loadProjectPathHistory = () => {
  if (typeof window === "undefined") return;
  try {
    const stored = JSON.parse(localStorage.getItem(PROJECT_PATH_HISTORY_KEY) || "null") as unknown;
    if (!stored || typeof stored !== "object") return;
    const normalized: Record<string, string[]> = {};
    for (const [agentId, paths] of Object.entries(stored)) {
      if (!Array.isArray(paths)) continue;
      const unique = [...new Set(paths.filter((path): path is string => typeof path === "string"))]
        .map((path) => path.trim())
        .filter(Boolean)
        .slice(0, 20);
      if (unique.length) normalized[agentId] = unique;
    }
    projectPathHistory.value = normalized;
  } catch {
    projectPathHistory.value = {};
  }
};

const saveProjectPathHistory = () => {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(PROJECT_PATH_HISTORY_KEY, JSON.stringify(projectPathHistory.value));
  } catch {
    // Local storage may be unavailable in private browsing; the in-memory list still works.
  }
};

const rememberProjectPath = (value: string, agentId = activeAgentId.value) => {
  const path = normalizeProjectPath(value);
  if (!path) return;
  const previous = projectPathHistory.value[agentId] ?? [];
  const paths = [path, ...previous.filter((item) => item !== path)].slice(0, 20);
  projectPathHistory.value = { ...projectPathHistory.value, [agentId]: paths };
  saveProjectPathHistory();
};

const projectPathOptions = computed(() => {
  const paths = (projectPathHistory.value[activeAgentId.value] ?? []).filter((path) =>
    normalizeProjectPath(path),
  );
  const current = normalizeProjectPath(projectPath.value);
  return current && !paths.includes(current) ? [current, ...paths] : paths;
});

const normalizeProjectPath = (value: string | undefined): string => {
  const path = value?.trim() ?? "";
  return path && path === defaultProjectPath.value ? "" : path;
};

const lastProjectPath = () => {
  const paths = projectPathHistory.value[activeAgentId.value] ?? [];
  return paths.map(normalizeProjectPath).find(Boolean) ?? "";
};

loadProjectPathHistory();

const resetPermissionForAgentSwitch = () => {
  permissionMode.value = "full";
};

// ============ 模型加载 ============

const {
  currentModel,
  modelCatalog,
  currentModelLabel,
  reconcileCurrentModel,
  getForwardProvider,
  isLocalModel,
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
const projectPathEnabled = computed(() => isAcpAgent.value || isLocalModel(currentModel.value));

const selectedHistoryModel = computed(() =>
  isAcpAgent.value
    ? activeAcpModelOption.value?.type === "select"
      ? activeAcpModelOption.value.currentValue
      : ""
    : currentModel.value,
);
const visibleConversationList = computed(() =>
  conversationList.value.filter((conversation) => {
    if ((conversation.agentId || "api") !== activeAgentId.value) return false;
    return (
      !selectedHistoryModel.value ||
      !conversation.modelId ||
      conversation.modelId === selectedHistoryModel.value
    );
  }),
);

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
  const conversation = conversationList.value.find((item) => String(item.key) === conversationId);
  const sessionProjectPath = conversation?.projectPath ?? projectPath.value;
  acpSessionLoading.value = true;
  try {
    const session = await loadAcpSession(
      activeAgentId.value,
      conversationId,
      sessionProjectPath,
      isAcpAgent.value ? conversation?.providerSessionId : "",
    );
    if (sequence !== acpSessionLoadSequence) return;
    acpSession.value = session;
    // 以服务端 activeRuns 为准；若回合恰在本次加载后结束，轮询（pollAcpRunState）兜底纠正。
    // native（pi/omp）的 running 由流事件活跃度推断（touchNativeStreamActivity），不在此设置。
    if (usesAcpProtocol.value) {
      acpRunState.value = session.running ? { state: "running" } : null;
    }
    if (conversation && conversation.agentId === activeAgentId.value) {
      if (
        isAcpAgent.value &&
        (usesAcpProtocol.value || session.sessionId !== session.conversationId)
      ) {
        conversation.providerSessionId = session.sessionId;
      }
      if (Array.isArray(session.history) && session.history.length > 0) {
        conversation.messages = transcriptHistoryToModelMessages(session.history);
        if (String(conversation.key) === currentConversationKey.value && !isRequesting.value) {
          setMessages(conversation.messages);
        }
        showWelcome.value = false;
      }
      schedulePersistState();
    }
    // native（pi/omp）：服务端 entry 已就绪后再启动文件尾随流，避免 404 竞态
    if (!usesAcpProtocol.value) startAcpLiveStream();
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

  draftProjectPath.value = lastProjectPath();
  currentConversationKey.value = "";
  projectPath.value = draftProjectPath.value;
  syncConversationRoute("replace");
  showWelcome.value = true;
  historyBack.value = [];
  historyForward.value = [];
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
  syncConversationRoute("push");
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

const handleAgentChange = (agentId: string) => {
  if (agentId === activeAgentId.value) return;
  if (isRequesting.value) {
    message.warning("请先停止当前 Agent 任务再切换供应商");
    return;
  }
  const next = agents.value.find((agent) => agent.id === agentId);
  if (!next) return;
  resetPermissionForAgentSwitch();
  draftConversationKey.value = "";
  acpSession.value = null;
  draftProjectPath.value = "";
  activeAgentId.value = next.id;
  localStorage.setItem("open-chat-agent", next.id);
  currentConversationKey.value = "";
  projectPath.value = "";
  setMessages([]);
  showWelcome.value = true;
  historyBack.value = [];
  historyForward.value = [];
  syncConversationRoute("replace");
  if (!next.available) {
    message.warning(next.adapterHint || `${next.name} 当前不可用，请检查本地 CLI 安装与登录状态`);
  }
  if (next.kind === "acp" && next.available) {
    void syncProviderConversations(next.id);
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
provider.onProviderSession = ({ agentId, sessionId }) => {
  const conversation = getCurrentConversation();
  if (!conversation || (agentId && agentId !== activeAgentId.value)) return;
  conversation.providerSessionId = sessionId;
  schedulePersistState();
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
  // Keep a visible assistant row mounted while the gateway is preparing the
  // first event, so the outgoing message transitions directly into feedback.
  requestPlaceholder: () => ({ content: "", role: "assistant" }),
});

/** 输入区忙碌态：本地请求进行中，或 Open Chat 网关中的会话在跑（多标签 / 刷新恢复）。 */
const inputBusy = computed(
  () =>
    isRequesting.value ||
    Boolean(currentOpenChatRun.value) ||
    (usesAcpProtocol.value && acpRunState.value?.state === "running"),
);

const sessionMatchesConversation = (
  session: OpenChatSessionView,
  conversation: OpenChatConversation,
): boolean =>
  session.agentId === (conversation.agentId || "api") &&
  (session.conversationId === String(conversation.key) ||
    Boolean(
      conversation.providerSessionId &&
      session.sessionId &&
      conversation.providerSessionId === session.sessionId,
    ));

const markConversationRunIdle = (conversationKey: string) => {
  const conversation = conversationList.value.find((item) => String(item.key) === conversationKey);
  openChatSessions.value = openChatSessions.value.map((session) =>
    session.running &&
    (session.conversationId === conversationKey ||
      (conversation != null && sessionMatchesConversation(session, conversation)))
      ? { ...session, running: false }
      : session,
  );
};

const currentOpenChatRun = computed(() => {
  const conversation = getCurrentConversation();
  if (!conversation) return undefined;
  return openChatSessions.value.find(
    (session) => session.running && sessionMatchesConversation(session, conversation),
  );
});

const conversationBusyStates = computed<Record<string, { startedAt: number }>>(() => {
  const states: Record<string, { startedAt: number }> = {};
  for (const conversation of conversationList.value) {
    const run = openChatSessions.value.find(
      (session) => session.running && sessionMatchesConversation(session, conversation),
    );
    if (run) states[String(conversation.key)] = { startedAt: run.startedAt ?? run.lastUsed };
  }
  if (isRequesting.value && activeRequestConversationKey.value) {
    states[activeRequestConversationKey.value] = {
      startedAt: requestStartedAt.value || Date.now(),
    };
  }
  return states;
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
  onResetToDraft: () => syncConversationRoute("replace"),
});

/**
 * Provider session listing supplies provider-owned metadata. IndexedDB keeps the
 * stable UI key and cached transcript, including sessions missing temporarily
 * from a provider response, so selecting a session can render its local snapshot
 * before the provider history arrives.
 */
const syncProviderConversations = async (agentId: string, pollSequence?: number): Promise<void> => {
  const agent = agents.value.find((item) => item.id === agentId);
  if (!agent || agent.kind !== "acp" || !agent.available) return;
  try {
    const result = await loadAcpProviderSessions(agentId);
    if (
      pollSequence !== undefined &&
      (pollSequence !== sessionPollSequence || agentId !== activeAgentId.value)
    ) {
      return;
    }
    if (!result.supported) return;
    let changed = false;
    for (const providerSession of result.sessions) {
      const existing = conversationList.value.find(
        (item) => item.agentId === agentId && item.providerSessionId === providerSession.sessionId,
      );
      const updatedAt = providerSession.updatedAt
        ? Date.parse(providerSession.updatedAt)
        : Number.NaN;
      if (existing) {
        if (
          providerSession.title?.trim() &&
          (!String(existing.label ?? "").trim() || existing.label === "新对话")
        ) {
          existing.label = providerSession.title.trim();
          changed = true;
        }
        const providerProjectPath = normalizeProjectPath(providerSession.cwd);
        if (existing.projectPath !== providerProjectPath) {
          existing.projectPath = providerProjectPath;
          changed = true;
        }
        if (Number.isFinite(updatedAt) && existing.updatedAt !== updatedAt) {
          existing.updatedAt = updatedAt;
          changed = true;
        }
        continue;
      }
      conversationList.value.push({
        key: `acp:${agentId}:${providerSession.sessionId}`,
        label: providerSession.title?.trim() || "新对话",
        group: "今天",
        updatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now(),
        messages: [],
        a2uiSubmissions: [],
        workspaceDrafts: [],
        systemPrompt: "",
        agentId,
        providerSessionId: providerSession.sessionId,
        projectPath: normalizeProjectPath(providerSession.cwd),
      });
      changed = true;
    }
    if (changed) schedulePersistState();
  } catch (error) {
    console.error(`Failed to load ${agentId} provider sessions:`, error);
  }
};

let sessionPollTimer: ReturnType<typeof setTimeout> | null = null;
let sessionPollController: AbortController | null = null;
let sessionPollSequence = 0;

const stopSessionPolling = () => {
  if (sessionPollTimer !== null) {
    clearTimeout(sessionPollTimer);
    sessionPollTimer = null;
  }
  sessionPollController?.abort();
  sessionPollController = null;
};

const reconcileRunningConversations = (sessions: OpenChatSessionView[]) => {
  let changed = false;
  for (const session of sessions) {
    if (!session.running) continue;
    const exact = conversationList.value.find(
      (conversation) =>
        conversation.agentId === session.agentId &&
        String(conversation.key) === session.conversationId,
    );
    const existing =
      exact ??
      conversationList.value.find(
        (conversation) =>
          sessionMatchesConversation(session, conversation) ||
          (conversation.agentId === session.agentId &&
            conversation.providerSessionId === session.sessionId),
      );
    if (existing) {
      // Provider polling can discover a new provider id before the run-state
      // response arrives. Keep the gateway conversation key used by the run
      // registry and remove that temporary provider-only duplicate.
      if (exact && session.sessionId) {
        for (let index = conversationList.value.length - 1; index >= 0; index -= 1) {
          const candidate = conversationList.value[index];
          if (
            candidate !== exact &&
            candidate.agentId === session.agentId &&
            candidate.providerSessionId === session.sessionId
          ) {
            conversationList.value.splice(index, 1);
            changed = true;
          }
        }
      }
      if (session.sessionId && existing.providerSessionId !== session.sessionId) {
        existing.providerSessionId = session.sessionId;
        changed = true;
      }
      const sessionProjectPath = normalizeProjectPath(session.projectPath);
      if (sessionProjectPath && existing.projectPath !== sessionProjectPath) {
        existing.projectPath = sessionProjectPath;
        changed = true;
      }
      continue;
    }
    conversationList.value.push({
      key: session.conversationId,
      label: "新对话",
      group: "今天",
      updatedAt: session.lastUsed,
      messages: [],
      a2uiSubmissions: [],
      workspaceDrafts: [],
      systemPrompt: "",
      agentId: session.agentId,
      providerSessionId: session.sessionId,
      ...(normalizeProjectPath(session.projectPath)
        ? { projectPath: normalizeProjectPath(session.projectPath) }
        : {}),
    });
    changed = true;
  }
  if (changed) schedulePersistState();
};

const scheduleSessionPoll = (delayMs: number) => {
  if (sessionPollTimer !== null) clearTimeout(sessionPollTimer);
  sessionPollTimer = setTimeout(() => {
    sessionPollTimer = null;
    void pollSessionLists();
  }, delayMs);
};

const pollSessionLists = async () => {
  if (isHydrating.value || document.visibilityState === "hidden") return;
  const agent = activeAgent.value;
  if (agent.kind !== "acp" || !agent.available) {
    openChatSessions.value = [];
    return;
  }

  const sequence = ++sessionPollSequence;
  const agentId = agent.id;
  const controller = new AbortController();
  sessionPollController = controller;
  try {
    // Provider-owned sessions are synchronized on startup, agent changes, and
    // route restores. Do not repeat that expensive listing on every run-state
    // poll; the run registry is enough to track an active turn.
    const openChatResult = await loadOpenChatSessions(agentId, controller.signal)
      .then((sessions) => ({ status: "fulfilled" as const, value: sessions }))
      .catch((reason: unknown) => ({ status: "rejected" as const, reason }));
    if (sequence !== sessionPollSequence || agentId !== activeAgentId.value) return;

    if (openChatResult.status === "fulfilled") {
      const sessions = openChatResult.value;
      openChatSessions.value = sessions;
      reconcileRunningConversations(sessions);
      const selectedConversation = getCurrentConversation();
      const selectedRun = selectedConversation
        ? sessions.find(
            (session) =>
              session.running && sessionMatchesConversation(session, selectedConversation),
          )
        : undefined;
      if (!isRequesting.value) {
        acpRunState.value = selectedRun ? { state: "running" } : null;
      }
    } else if ((openChatResult.reason as Error)?.name !== "AbortError") {
      console.error("Failed to poll Open Chat session state:", openChatResult.reason);
    }
  } catch (error) {
    console.error("Failed to poll session lists:", error);
  } finally {
    if (sequence === sessionPollSequence) {
      sessionPollController = null;
      const hasRunningSession = openChatSessions.value.some((session) => session.running);
      // Idle pages need a one-shot refresh only. Keep polling while a gateway
      // turn is active so a second tab can still receive its live transcript.
      if (hasRunningSession || isRequesting.value) scheduleSessionPoll(2_000);
    }
  }
};

const restartSessionPolling = () => {
  stopSessionPolling();
  sessionPollSequence += 1;
  if (!isHydrating.value && document.visibilityState !== "hidden") {
    scheduleSessionPoll(0);
  }
};

const handleVisibilityChange = () => {
  if (document.visibilityState === "hidden") stopSessionPolling();
  else restartSessionPolling();
};

/**
 * 按 URL 恢复对应供应商与会话：直接打开复制的链接、或浏览器前进/后退时调用。
 * 非 chat 路由返回 false，不干扰页面切换。
 */
const restoreRouteConversation = async (
  path: string = window.location.pathname,
): Promise<boolean> => {
  const route = parseChatRoute(path);
  if (!route) return false;
  const { agentId: routeAgentId, sessionId: routeSessionId } = route;

  // 1) 供应商：URL 指定优先，其次上次记忆，最后第一个可用 ACP / API
  const routeAgent = routeAgentId
    ? agents.value.find((agent) => agent.id === routeAgentId)
    : undefined;
  const targetAgent =
    routeAgent ??
    agents.value.find((agent) => agent.id === localStorage.getItem("open-chat-agent")) ??
    agents.value.find((agent) => agent.kind === "acp" && agent.available) ??
    agents.value[0] ??
    API_AGENT;

  if (targetAgent.id !== activeAgentId.value) {
    resetPermissionForAgentSwitch();
    acpSession.value = null;
    draftConversationKey.value = "";
    draftProjectPath.value = "";
    activeAgentId.value = targetAgent.id;
    localStorage.setItem("open-chat-agent", targetAgent.id);
    if (targetAgent.kind === "acp" && targetAgent.available) {
      // 同步目标供应商的会话列表，让 URL 里的 provider session 出现在侧栏
      await syncProviderConversations(targetAgent.id);
    }
  }

  // 2) 会话：精确 key → ACP 重建 key → providerSessionId 匹配；找不到则落到草稿
  if (!routeSessionId) {
    draftProjectPath.value = "";
    currentConversationKey.value = "";
    setMessages([]);
    showWelcome.value = true;
    return true;
  }
  const candidateKeys = routeSessionId.startsWith("acp:")
    ? [routeSessionId]
    : [routeSessionId, `acp:${targetAgent.id}:${routeSessionId}`];
  const conversation = conversationList.value.find(
    (item) =>
      candidateKeys.includes(String(item.key)) ||
      (item.agentId === targetAgent.id && item.providerSessionId === routeSessionId),
  );
  if (conversation) {
    if (conversation.agentId && conversation.agentId !== activeAgentId.value) {
      resetPermissionForAgentSwitch();
      acpSession.value = null;
      draftProjectPath.value = "";
      activeAgentId.value = conversation.agentId;
      localStorage.setItem("open-chat-agent", conversation.agentId);
    }
    currentConversationKey.value = String(conversation.key);
    showWelcome.value = (conversation.messages?.length ?? 0) === 0;
    return true;
  }
  // 本地找不到：落到目标供应商的草稿态（ACP 会话会在下次 syncProviderConversations 后出现）
  draftProjectPath.value = "";
  currentConversationKey.value = "";
  setMessages([]);
  showWelcome.value = true;
  return true;
};

const handleRoutePopState = () => {
  void restoreRouteConversation();
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
    acpRunState.value = isAcpAgent.value ? { state: "running" } : null;
    if (isAcpAgent.value) restartSessionPolling();
    return;
  }
  if (activeRequestConversationKey.value) {
    // The request SSE closing is authoritative. Clear the cached poll result
    // before the live-stream watcher runs, otherwise it can subscribe to a run
    // that the server has just removed and produce a transient 404.
    markConversationRunIdle(activeRequestConversationKey.value);
  }
  attachPendingSearchSources();
  activeRequestConversationKey.value = "";
  pendingA2UISurfaceId.value = "";
  pendingPermission.value = null;
  requestStartedAt.value = 0;
  // 请求结束：会话必然回到空闲，清掉过期的 ACP 运行状态
  acpRunState.value = null;
  if (isAcpAgent.value) restartSessionPolling();
});

// ============ 会话实时输出（Open Chat 任务事件总线） ============

/** Native turns expose protocol-level completion; ACP keeps this activity timer as a fallback. */
let nativeStreamIdleTimer: ReturnType<typeof setTimeout> | null = null;
let acpStreamConversationKey = "";
const touchNativeStreamActivity = () => {
  if (usesAcpProtocol.value) return;
  acpRunState.value = { state: "running" };
  if (nativeStreamIdleTimer) clearTimeout(nativeStreamIdleTimer);
  nativeStreamIdleTimer = setTimeout(() => {
    acpRunState.value = null;
    nativeStreamIdleTimer = null;
  }, 5000);
};

const stopAcpLiveStream = () => {
  if (nativeStreamIdleTimer) {
    clearTimeout(nativeStreamIdleTimer);
    nativeStreamIdleTimer = null;
  }
  if (acpStreamController.value) {
    acpStreamController.value.abort();
    acpStreamController.value = null;
  }
  acpStreamConversationKey = "";
};

/** 复用 OpenChatProvider.transformMessage 累积当前回合输出，与常规请求同一渲染管线。 */
const handleAcpStreamEvent = (event: string | null, data: string) => {
  if (data === "[DONE]") return;
  if (event === "snapshot") {
    try {
      const parsed = JSON.parse(data) as { messages?: TranscriptMessage[] };
      if (Array.isArray(parsed.messages)) {
        setMessages(transcriptHistoryToModelMessages(parsed.messages));
        showWelcome.value = false;
      }
    } catch (err) {
      console.error("Failed to parse ACP stream snapshot:", err);
    }
    return;
  }
  if (event === "transcript_message") {
    try {
      const parsed = JSON.parse(data) as TranscriptMessage;
      if (parsed.role === "user" || parsed.role === "assistant") {
        touchNativeStreamActivity();
        showWelcome.value = false;
        setMessages(appendTranscriptMessageToModelMessages(messages.value, parsed));
      }
    } catch (err) {
      console.error("Failed to parse transcript stream message:", err);
    }
    return;
  }
  const msgs = messages.value;
  const last = msgs[msgs.length - 1];
  const accumulating = !!last && last.message.role === "assistant";
  const origin: XModelMessage = accumulating ? last.message : { role: "assistant", content: "" };
  const next = provider.transformMessage({
    originMessage: origin,
    chunk: { event: event ?? undefined, data } as unknown as XModelResponse,
    chunks: [],
    status: "updating",
    responseHeaders: new Headers(),
  });
  if (accumulating) {
    setMessages([...msgs.slice(0, -1), { ...last, message: next }]);
  } else {
    setMessages([
      ...msgs,
      { id: `acp-stream-${++acpStreamMessageSeq}`, status: "updating", message: next },
    ]);
  }
};

/**
 * 订阅当前会话的实时输出：只订阅由网关启动并管理的当前回合。
 * CLI 自己在终端中启动的回合不通过日志轮询伪造实时事件。
 */
const startAcpLiveStream = () => {
  if (!isAcpAgent.value || !activeAgent.value.available) return;
  const conversationId = currentConversationKey.value || ensureDraftConversationKey();
  const conversation = conversationList.value.find((item) => String(item.key) === conversationId);
  if (!conversation) return;
  const selectedRun = currentOpenChatRun.value;
  const isRunning = Boolean(selectedRun) || acpRunState.value?.state === "running";
  if (!isRunning || isRequesting.value) return;
  const streamKey = `${activeAgentId.value}:${conversationId}`;
  if (acpStreamController.value && acpStreamConversationKey === streamKey) return;
  stopAcpLiveStream();
  acpStreamConversationKey = streamKey;
  const controller = subscribeAcpSessionStream(
    activeAgentId.value,
    conversationId,
    conversation.projectPath ?? projectPath.value,
    handleAcpStreamEvent,
    () => {
      if (acpStreamController.value !== controller) return;
      acpStreamController.value = null;
      acpStreamConversationKey = "";
      // End the cached run before refreshing. Otherwise a 204 caused by the
      // run finishing between poll and subscribe immediately reopens the same
      // stream and creates a tight request loop.
      markConversationRunIdle(conversationId);
      acpRunState.value = null;
      // 回合结束：服务端历史已完整，以最终状态收尾并让列表轮询纠正运行态。
      void refreshAcpSession();
      restartSessionPolling();
    },
  );
  acpStreamController.value = controller;
};

watch(
  [acpRunState, currentOpenChatRun, isRequesting, currentConversationKey, activeAgentId],
  () => {
    if (isRequesting.value) {
      stopAcpLiveStream();
      return;
    }
    if (currentOpenChatRun.value || acpRunState.value?.state === "running") {
      startAcpLiveStream();
    } else {
      stopAcpLiveStream();
    }
  },
);

watch([activeAgentId, currentConversationKey, isHydrating], () => {
  void refreshAcpSession();
});

watch(activeAgentId, () => {
  restartSessionPolling();
});

watch(currentConversationKey, (key) => {
  if (!key) {
    projectPath.value = draftProjectPath.value;
    return;
  }
  const conversationPath = normalizeProjectPath(getCurrentConversation()?.projectPath);
  projectPath.value = conversationPath;
  if (conversationPath) rememberProjectPath(conversationPath);
});

// 监听消息变化，同步到对话列表
watch(
  messages,
  (newMessages) => {
    const conversationWriteKey = activeRequestConversationKey.value || currentConversationKey.value;
    updateConversationMessages(
      conversationWriteKey,
      persistMessageTimings(conversationWriteKey, newMessages),
    );
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
  window.addEventListener("popstate", handleRoutePopState);
  document.addEventListener("visibilitychange", handleVisibilityChange);
  if (window.matchMedia("(max-width: 767px)").matches) {
    conversationsOpen.value = false;
    rightPanelOpen.value = false;
  }

  const initialChatPath = window.location.pathname;
  const [persistedState, loadedAgents, loadedDefaultProjectPath] = await Promise.all([
    loadChatState(),
    loadAcpAgents().catch((error) => {
      console.error("Failed to load local agents:", error);
      return [API_AGENT];
    }),
    aiService.getDefaultProjectPath().catch(() => ""),
  ]);
  defaultProjectPath.value = loadedDefaultProjectPath;
  if (loadedDefaultProjectPath) {
    projectPathHistory.value = Object.fromEntries(
      Object.entries(projectPathHistory.value)
        .map(([agentId, paths]) => [agentId, paths.filter((path) => normalizeProjectPath(path))])
        .filter(([, paths]) => paths.length > 0),
    );
    saveProjectPathHistory();
  }
  agents.value = loadedAgents;
  const storedAgentId = localStorage.getItem("open-chat-agent") || "";
  const storedAgent = loadedAgents.find((agent) => agent.id === storedAgentId);
  const firstAvailableAcp = loadedAgents.find((agent) => agent.kind === "acp" && agent.available);
  activeAgentId.value = storedAgent?.id ?? firstAvailableAcp?.id ?? "api";

  if (persistedState && persistedState.conversationList.length > 0) {
    applyPersistedState(persistedState);
    for (const conversation of conversationList.value) {
      conversation.projectPath = normalizeProjectPath(conversation.projectPath);
    }
  } else {
    conversationList.value = [];
    currentConversationKey.value = "";
    showWelcome.value = true;
  }

  await syncProviderConversations(activeAgentId.value);
  // URL 直达：打开复制的链接时恢复对应供应商与会话
  await restoreRouteConversation(initialChatPath);
  // Release session/config watchers only after the final route conversation
  // is known. Releasing earlier creates a throwaway draft session request.
  isHydrating.value = false;
  restartSessionPolling();
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", handleWorkspaceKeydown);
  window.removeEventListener("popstate", handleRoutePopState);
  document.removeEventListener("visibilitychange", handleVisibilityChange);
  window.removeEventListener("mousemove", handleResizeMove);
  window.removeEventListener("mouseup", handleResizeEnd);
  stopSessionPolling();
  stopAcpLiveStream();
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

const bubbleItems = computed(() => {
  const conversationMessages = currentConversationMessages.value;
  const pending = optimisticMessage.value;
  const baseItems = modelMessagesToBubbleItems(conversationMessages);

  if (!pending || pending.conversationKey !== currentConversationKey.value) {
    return baseItems;
  }

  // Once useXChat has emitted the local user item, switch back to the store
  // output so the optimistic row cannot be rendered twice.
  const storeHasPendingMessage = conversationMessages.some(
    (item) =>
      (item.extraInfo as { optimisticId?: unknown } | undefined)?.optimisticId === pending.id,
  );
  if (storeHasPendingMessage) return baseItems;

  const pendingInfo: DefaultMessageInfo<XModelMessage> = {
    id: pending.id,
    status: "local",
    message: pending.message,
    extraInfo: pending.extraInfo,
  };
  const hasStreamingAssistant = conversationMessages.some(
    (item) =>
      item.message.role === "assistant" &&
      (item.status === "loading" || item.status === "updating"),
  );
  const optimisticItems = [...conversationMessages, pendingInfo];
  // Keep the transition visually continuous even while the request store is
  // waiting to publish its placeholder row.
  if (!hasStreamingAssistant) {
    optimisticItems.push({
      id: `${pending.id}:thinking`,
      // Render through AssistantMessageContent so the waiting phase uses the
      // same "工作中" indicator as the subsequent streamed response.
      status: "updating",
      message: { role: "assistant", content: "" },
    });
  }
  return modelMessagesToBubbleItems(optimisticItems);
});

// ============ 事件处理 ============

const handlePromptClick = (info: { data: { key?: string; description?: string } }) => {
  const prompt = typeof info.data.description === "string" ? info.data.description : "";
  if (inputBusy.value || !prompt) return;

  showWelcome.value = false;
  handleSubmit(prompt);
};

const handleCancel = () => {
  // ACP：断连不再自动取消回合，停止必须先调服务端取消接口
  if (isAcpAgent.value) {
    const conversationId = activeRequestConversationKey.value || currentConversationKey.value;
    if (conversationId) void cancelAcpTurn(activeAgentId.value, conversationId);
  }
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
    /** 随消息发送的附件（已上传到网关，携带持久引用）。 */
    attachments?: UploadedAttachment[];
  } = {},
) => {
  if ((!nextContent || !nextContent.trim()) && !options.attachments?.length) return;
  if (inputBusy.value) return;
  if (!activeAgent.value.available) {
    message.warning(
      activeAgent.value.adapterHint ||
        `${activeAgent.value.name} 当前不可用，请检查本地 CLI 安装与登录状态`,
    );
    return;
  }

  // 草稿态首次发送时，才创建真实会话并写入侧栏
  if (isInDraftMode.value) {
    const newConversation = createNewConversation(
      options.systemPrompt ?? "",
      isAcpAgent.value ? ensureDraftConversationKey() : "",
      selectedHistoryModel.value,
    );
    newConversation.projectPath = projectPath.value.trim();
    if (
      isAcpAgent.value &&
      acpSession.value?.conversationId === String(newConversation.key) &&
      (usesAcpProtocol.value || acpSession.value.sessionId !== acpSession.value.conversationId)
    ) {
      newConversation.providerSessionId = acpSession.value.sessionId;
    }
    conversationList.value.unshift(newConversation);
    currentConversationKey.value = String(newConversation.key);
    draftConversationKey.value = "";
    syncConversationRoute("push");
  }

  const conversation = getCurrentConversation();
  if (!conversation) return;
  if (options.systemPrompt !== undefined) {
    conversation.systemPrompt = options.systemPrompt.trim();
  }
  // 只有真正提交新消息才改变会话排序；读取、恢复和实时回放保持原顺序。
  conversation.updatedAt = Date.now();
  setMessages(currentConversationMessages.value);
  activeRequestConversationKey.value = currentConversationKey.value;

  showWelcome.value = false;
  const isHiddenRequest = options.extraInfo?.hidden === true;
  const optimisticId = `optimistic-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const requestExtraInfo: Record<string, unknown> = {
    ...options.extraInfo,
    ...(isHiddenRequest ? {} : { optimisticId }),
  };
  if (!isHiddenRequest) {
    optimisticMessage.value = {
      conversationKey: currentConversationKey.value,
      id: optimisticId,
      message: {
        role: "user",
        content: nextContent,
        ...(options.attachments?.length ? { attachments: options.attachments } : {}),
      },
      extraInfo: requestExtraInfo,
    };
  }
  const forwardProvider = getForwardProvider(currentModel.value);
  onRequest(
    {
      messages: [
        {
          role: "user",
          content: nextContent,
          ...(options.attachments?.length ? { attachments: options.attachments } : {}),
        },
      ],
      model: inputCurrentModel.value,
      mode: workMode.value,
      permission: effectivePermissionMode.value,
      systemPrompt: getRequestSystemPrompt(conversation.systemPrompt ?? ""),
      enable_thinking: thinkingEnabled.value,
      thinking: { type: thinkingEnabled.value ? "enabled" : "disabled" },
      // 本地 opencode（服务端 AI）：按会话复用长会话，无需转发目标。
      conversationId: String(conversation.key),
      ...(isAcpAgent.value ? { acpAgentId: activeAgentId.value } : {}),
      ...(isAcpAgent.value && conversation.providerSessionId
        ? { providerSessionId: conversation.providerSessionId }
        : {}),
      ...(projectPath.value.trim() ? { projectPath: projectPath.value.trim() } : {}),
      // 手动配置的服务商：随请求携带转发目标（baseUrl / apiKey / api）
      ...(!isAcpAgent.value && forwardProvider ? { provider: forwardProvider } : {}),
    },
    { extraInfo: requestExtraInfo },
  );
  // 清空输入框
  setTimeout(() => {
    content.value = "";
  }, 0);
};

const handleProjectPathChange = (value: string) => {
  if (isRequesting.value) {
    message.warning("请先停止当前任务再切换项目目录");
    return;
  }
  const nextPath = normalizeProjectPath(value);
  projectPath.value = nextPath;
  if (!currentConversationKey.value) draftProjectPath.value = nextPath;
  if (nextPath) rememberProjectPath(nextPath);
  const conversation = getCurrentConversation();
  if (conversation) {
    conversation.projectPath = projectPath.value;
    schedulePersistState();
  }
  void refreshAcpSession();
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
  if (isRequesting.value) {
    message.warning("请先停止当前任务再切换模型");
    return;
  }
  if (!isAcpAgent.value) {
    currentModel.value = key;
    currentConversationKey.value = "";
    setMessages([]);
    showWelcome.value = true;
    historyBack.value = [];
    historyForward.value = [];
    syncConversationRoute("replace");
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
      projectPath.value,
      isAcpAgent.value ? getCurrentConversation()?.providerSessionId : "",
    );
    currentConversationKey.value = "";
    setMessages([]);
    showWelcome.value = true;
    historyBack.value = [];
    historyForward.value = [];
    syncConversationRoute("replace");
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

const handleModeChange = (value: "build" | "plan") => {
  workMode.value = value;
};

const handlePermissionChange = (value: "supervised" | "auto" | "full") => {
  if (isPiAgent.value && value !== "full") return;
  permissionMode.value = value;
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
  activeRequestConversationKey.value = currentConversationKey.value;
  const baseSystemPrompt = currentConversation?.systemPrompt ?? "";
  const forwardProvider = getForwardProvider(currentModel.value);
  onReload(messageId, {
    model: inputCurrentModel.value,
    mode: workMode.value,
    permission: effectivePermissionMode.value,
    systemPrompt: getRequestSystemPrompt(baseSystemPrompt),
    // 本地 opencode：复用同一会话长会话
    conversationId: String(currentConversation?.key ?? ""),
    ...(isAcpAgent.value ? { acpAgentId: activeAgentId.value } : {}),
    ...(isAcpAgent.value && currentConversation?.providerSessionId
      ? { providerSessionId: currentConversation.providerSessionId }
      : {}),
    ...(projectPath.value.trim() ? { projectPath: projectPath.value.trim() } : {}),
    // 手动配置的服务商：随请求携带转发目标（baseUrl / apiKey / api）
    ...(!isAcpAgent.value && forwardProvider ? { provider: forwardProvider } : {}),
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
  syncConversationRoute("replace");
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
            :busy-states="conversationBusyStates"
            :dark="dark"
            :agents="agents"
            :active-agent-id="activeAgentId"
            @toggle-sidebar="handleSidebarToggle"
            @toggle-theme="emit('toggleTheme')"
            @new-conversation="handleNewConversation"
            @open-search="commandPaletteOpen = true"
            @open-settings="settingsOpen = true"
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
        :can-go-back="historyBack.length > 0"
        :can-go-forward="historyForward.length > 0"
        :diff-added="workspaceDiffStats.added"
        :diff-removed="workspaceDiffStats.removed"
        @toggle-sidebar="handleSidebarToggle"
        @toggle-right-panel="rightPanelOpen = !rightPanelOpen"
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
        :loading="inputBusy"
        :run-state="acpRunState?.state ?? null"
        :current-model="inputCurrentModel"
        :current-model-label="inputCurrentModelLabel"
        :model-catalog="inputModelCatalog"
        :thinking-enabled="thinkingEnabled"
        :mode="workMode"
        :permission="effectivePermissionMode"
        :permission-locked="isPiAgent"
        :pending-permission="pendingPermission"
        :file-mode-enabled="fileModeEnabled"
        :project-path="projectPath"
        :project-path-options="projectPathOptions"
        :project-path-enabled="projectPathEnabled"
        :agent-mode="isAcpAgent"
        :agent-available="activeAgent.available"
        :agent-configuring="acpSessionLoading"
        @change="handleChange"
        @cancel="handleCancel"
        @submit="(value, attachments) => handleSubmit(value, { attachments })"
        @model-change="handleModelChange"
        @thinking-change="handleThinkingChange"
        @mode-change="handleModeChange"
        @permission-change="handlePermissionChange"
        @permission-response="handlePermissionResponse"
        @file-mode-change="handleFileModeChange"
        @project-path-change="handleProjectPathChange"
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

    <CommandPalette
      :open="commandPaletteOpen"
      :conversation-list="visibleConversationList"
      :dark="dark"
      @update:open="commandPaletteOpen = $event"
      @new-conversation="handleNewConversation"
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

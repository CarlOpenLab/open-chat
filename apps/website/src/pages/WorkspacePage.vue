<script setup lang="ts">
/**
 * 工作区容器（状态层）：
 * - 持有全部会话 / 任务 / 供应商状态与业务逻辑；
 * - 通过 provideWorkspace 把状态下发到 BoardPage / ChatPage 展示层；
 * - 顶部 TopTabBar 负责两种布局的切换。
 */
import type { ConversationsProps } from "@antdv-next/x";
import type { DefaultMessageInfo } from "@antdv-next/x-sdk";
import type { XModelMessage, XModelResponse } from "@antdv-next/x-sdk";
import { XRequest } from "@antdv-next/x-sdk";
import { message } from "antdv-next";
import { computed, reactive, ref, watch, onMounted, onBeforeUnmount } from "vue";
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
import { uniqueDirectoryPaths } from "../utils/projectPath";
import { FILE_WORKSPACE_SYSTEM_PROMPT } from "../prompts/fileWorkspace";
import { deriveBoardStatus, hasPersistedError, type SessionStatus } from "../utils/sessionStatus";
import { loadChatState, type QueuedChatMessage } from "../services/chatStorage";
import { useNow } from "../composables/useNow";
import {
  API_AGENT,
  cancelAcpTurn,
  flattenAcpSelectOptions,
  loadAcpAgents,
  loadAcpSession,
  setAcpSessionConfig,
  subscribeAcpSessionStream,
  type AcpSessionState,
  type AgentView,
} from "../services/acp";
import {
  appendTranscriptMessageToModelMessages,
  isHiddenModelMessage,
  transcriptHistoryToModelMessages,
  type TranscriptMessage,
} from "../services/transcript";
import { useChatModels, type ModelCatalogEntry } from "../composables/useChatModels";
import { useComposerData } from "../composables/useComposerData";
import { useMessageTimings } from "../composables/workspace/useMessageTimings";
import { useMessageView } from "../composables/workspace/useMessageView";
import { useNotifications } from "../composables/workspace/useNotifications";
import { useProjectPath } from "../composables/workspace/useProjectPath";
import { useSessionErrors } from "../composables/workspace/useSessionErrors";
import { useWorkspaceLayout } from "../composables/workspace/useWorkspaceLayout";
import {
  getMessagePreview,
  useChatPersistence,
  type OpenChatConversation,
} from "../composables/useChatPersistence";
import { useCoalescedUpdater } from "../composables/useCoalescedUpdater";
import CommandPalette from "../components/chat/CommandPalette.vue";
import DeleteConversationModal from "../components/chat/DeleteConversationModal.vue";
import SettingsDialog from "../components/chat/SettingsDialog.vue";
import TopTabBar from "../components/layout/TopTabBar.vue";
import BoardPage from "./BoardPage.vue";
import ChatPage from "./ChatPage.vue";
import { provideWorkspace, type SubmitMessageOptions, type Workspace } from "./workspace";
import {
  loadTasks,
  saveTasks,
  createTaskInput,
  updateTaskInList,
  duplicateTask,
  type Task,
} from "../services/taskStorage";
import { TASK_STATUS_META, type TaskStatus } from "../utils/taskStatus";
interface Props {
  dark: boolean;
  /** 主题模式：跟随系统 / 浅色 / 深色 */
  themeMode?: "system" | "light" | "dark";
}

interface Emits {
  (e: "toggleTheme"): void;
  (e: "themeModeChange", mode: "system" | "light" | "dark"): void;
}

const props = withDefaults(defineProps<Props>(), { themeMode: "system" });
const emit = defineEmits<Emits>();

// ============ 响应式状态 ============

const content = ref("");

/** 草稿会话在抽屉中的占位 key：不对应任何真实会话。 */
const DRAFT_BOARD_KEY = "__draft__";
/** 看板抽屉当前打开的会话；空串表示看板态（无聊天面板）。 */
const boardOpenKey = ref("");
/** 布局状态（侧栏 / 抽屉 / 浮层开关）：窄屏折叠时需要同步关闭看板抽屉。 */
const { conversationsOpen, sidebarWidth, drawerWidth, commandPaletteOpen, settingsOpen } =
  useWorkspaceLayout({ boardOpenKey });
/** 任务详情抽屉：打开的任务 id，空串表示未打开。 */
const openTaskId = ref("");
/** 任务列表（全局跨项目），与会话解耦。 */
const taskList = ref<Task[]>([]);
/** 任务列表防抖持久化：批量变更（创建/拖拽/删除）只落一次 IndexedDB。 */
let persistTasksTimer: ReturnType<typeof setTimeout> | null = null;
const schedulePersistTasks = () => {
  if (persistTasksTimer) clearTimeout(persistTasksTimer);
  persistTasksTimer = setTimeout(() => {
    persistTasksTimer = null;
    void saveTasks(taskList.value);
  }, 200);
};
/** 看板 AI 助手回合结束后调用：先 flush 挂起的本地保存，再从网关重载任务，
 *  保证看板与（可能被助手改过的）服务端状态一致。 */
const refreshTasksFromServer = async () => {
  if (persistTasksTimer) {
    clearTimeout(persistTasksTimer);
    persistTasksTimer = null;
    await saveTasks(taskList.value);
  }
  taskList.value = await loadTasks();
};
const pendingPermissions = reactive(new Map<string, PermissionRequest>());
/** 出错 / 手动停止后未恢复的会话：驱动「已终止」列。 */
const stoppedConversationKeys = ref<Set<string>>(new Set());
const boardStatusSignals = computed(
  () =>
    ({
      busyStates: conversationBusyStates.value,
      permissionKeys: new Set(pendingPermissions.keys()),
      stoppedKeys: stoppedConversationKeys.value,
    }) satisfies import("../utils/sessionStatus").SessionStatusSignals,
);
const deleteOpen = ref(false);
const deleteTargetKey = ref("");
const currentConversationKey = ref<string>("");
const thinkingEnabled = ref(true);
const workMode = ref<"build" | "plan">("build");
const permissionMode = ref<"supervised" | "auto" | "full">("full");
const fileModeEnabled = ref(false);
const pendingSearchSources = ref<WebSearchSourceItem[] | null>(null);
const showWelcome = ref(true);
const isHydrating = ref(true);
let componentUnmounted = false;
const activeRequestConversationKey = ref<string>("");
/** 请求开始时间，供侧栏「工作中」条目计时 */
const requestStartedAt = ref(0);
/**
 * Provider history often omits a transient turn.failed assistant message.
 * Keep the live message authoritative until the user explicitly acts.
 */
const failedHistoryRefreshLocks = new Set<string>();
const manuallyStoppedConversationKeys = new Set<string>();
let scheduleNextQueuedMessage: (conversationKey: string) => void = () => {};
const { persistMessageTimings } = useMessageTimings();

const agents = ref<AgentView[]>([API_AGENT]);
const activeAgentId = ref("api");
const acpSession = ref<AcpSessionState | null>(null);
const acpSessionLoading = ref(false);
/** ACP 会话运行状态（running / idle / requires_action），由服务端 activeRuns 推导经 /api/acp/session 返回。 */
const acpRunState = ref<AcpRunStateNotice | null>(null);
/** 会话实时输出订阅（多标签 / 刷新恢复后观看运行中的回合）。 */
const acpStreamController = ref<AbortController | null>(null);
let acpStreamMessageSeq = 0;
const draftConversationKey = ref("");

// 会话历史导航（◀ ▶）
const historyBack = ref<string[]>([]);
const historyForward = ref<string[]>([]);
const historyLocked = ref(false);

// ============ URL 会话路由 ============
// URL 格式：/chat/{agentId}/{sessionId}，sessionId 优先用供应商真实会话 id（ACP），
// 其次用本地会话 key。复制链接即可直达对应供应商的会话。
// 会话路由只属于对话视图：看板页不写路由，地址栏保持根路径 /。

const safeDecode = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

/** 将当前打开的会话同步到 URL（push 记历史 / replace 原地替换）。 */
const syncConversationRoute = (mode: "push" | "replace") => {
  // 看板页不写 /chat/... 路由：会话路由只属于对话视图
  if (viewMode.value !== "chat") return;
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
    workspaceDrafts: [],
    queuedMessages: [],
    queuePaused: false,
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

const {
  projectPath,
  draftProjectPath,
  defaultProjectPath,
  projectPathHistory,
  projectPathOptions,
  normalizeProjectPath,
  loadProjectPathHistory,
  saveProjectPathHistory,
  rememberProjectPath,
  lastProjectPath,
  handleProjectPathChange,
  handleProjectPathRemove,
} = useProjectPath({
  conversationList,
  currentConversationKey,
  isConversationRunning: (key) => isConversationRunning(key),
  schedulePersist: () => schedulePersistState(),
  refreshAcpSession: (force) => void refreshAcpSession(force),
  forgetFailedHistoryRefresh: (conversationKey) =>
    failedHistoryRefreshLocks.delete(conversationKey),
});

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

// ============ 每个供应商记住的默认模型 ============
// 切换供应商时，新会话默认用上次为该供应商选择的模型，而不是 CLI 自带的默认模型
// （如 codex 的 sol）。存 localStorage，仅前端偏好，不影响服务端。
const AGENT_DEFAULT_MODEL_KEY = "open-chat-agent-default-models";

const loadAgentDefaultModels = (): Record<string, string> => {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(AGENT_DEFAULT_MODEL_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const result: Record<string, string> = {};
    for (const [agentId, model] of Object.entries(parsed)) {
      if (typeof model === "string" && model) result[agentId] = model;
    }
    return result;
  } catch {
    return {};
  }
};
const agentDefaultModels = ref<Record<string, string>>(loadAgentDefaultModels());

const rememberAgentDefaultModel = (agentId: string, model: string) => {
  if (!agentId || !model) return;
  agentDefaultModels.value = { ...agentDefaultModels.value, [agentId]: model };
  try {
    localStorage.setItem(AGENT_DEFAULT_MODEL_KEY, JSON.stringify(agentDefaultModels.value));
  } catch {
    // 隐私模式下 localStorage 可能不可用，仅在内存中保留本次会话的偏好。
  }
};

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
/** 项目目录与模型/供应商解耦：始终可用，由用户显式选择 */
const projectPathEnabled = computed(() => true);

// 侧栏聚合展示：所有本地 IndexedDB 会话（全供应商聚合），不再按 activeAgent 过滤。
// 只有本地创建过的会话 id 才会出现在侧栏，避免全量拉取供应商侧历史。
const visibleConversationList = computed(() => [...conversationList.value]);

const ensureDraftConversationKey = (): string => {
  if (!draftConversationKey.value) {
    draftConversationKey.value = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
  return draftConversationKey.value;
};

let acpSessionLoadSequence = 0;

/**
 * 新会话（草稿 / 无消息且无真实会话 id）下，把该供应商记住的默认模型应用到服务端会话，
 * 避免每次切回都落到 CLI 自带的默认模型（如 codex 的 sol）。
 */
const applyAgentDefaultModel = async (
  session: AcpSessionState,
  conversationId: string,
  projectPath: string,
): Promise<AcpSessionState> => {
  const savedDefault = agentDefaultModels.value[activeAgentId.value];
  if (!savedDefault) return session;
  const option = session.configOptions.find(
    (item) =>
      item.type === "select" &&
      (item.category === "model" ||
        item.id.toLowerCase() === "model" ||
        item.name.toLowerCase() === "model"),
  );
  if (!option || option.type !== "select" || option.currentValue === savedDefault) return session;
  const available = flattenAcpSelectOptions(option.options).some(
    (model) => model.value === savedDefault,
  );
  if (!available) return session;
  try {
    return await setAcpSessionConfig(
      activeAgentId.value,
      conversationId,
      option.id,
      savedDefault,
      projectPath,
      "",
    );
  } catch (error) {
    console.warn(`应用 ${activeAgentId.value} 的默认模型失败：`, error);
    return session;
  }
};

const refreshAcpSession = async (force = false) => {
  if (
    !force &&
    currentConversationKey.value &&
    failedHistoryRefreshLocks.has(currentConversationKey.value)
  ) {
    return;
  }
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
    // A refresh may have started just before turn.failed arrived. Re-check the
    // lock after the network response so that stale history cannot win the race.
    if (!force && failedHistoryRefreshLocks.has(conversationId)) return;
    acpSession.value = session;
    // 新会话：应用该供应商记住的默认模型（如 codex 上次选的模型，而非 CLI 默认 sol）。
    // 仅在草稿 / 无消息且无真实会话 id 时应用，打开已有会话不做覆盖。
    const isFreshConversation =
      !conversation || (!conversation.messages?.length && !conversation.providerSessionId);
    if (isFreshConversation && isAcpAgent.value) {
      const sessionWithDefault = await applyAgentDefaultModel(
        session,
        conversationId,
        sessionProjectPath,
      );
      if (sequence !== acpSessionLoadSequence) return;
      acpSession.value = sessionWithDefault;
    }
    // 以服务端 activeRuns 为准；若回合恰在本次加载后结束，下次状态刷新会兜底纠正。
    // native（pi/omp）的 running 由流事件活跃度推断（touchNativeStreamActivity），不在此设置。
    if (usesAcpProtocol.value) {
      acpRunState.value = acpSession.value.running ? { state: "running" } : null;
    }
    if (conversation && conversation.agentId === activeAgentId.value) {
      if (
        isAcpAgent.value &&
        (usesAcpProtocol.value || session.sessionId !== session.conversationId)
      ) {
        conversation.providerSessionId = session.sessionId;
      }
      // 新会话（任务「新建会话」等）创建时 ACP 会话尚未加载，modelId 只能先落
      // 当前值；这里以服务端会话的真实模型为准补齐，避免残留 API 模型串到会话上。
      if (isFreshConversation && isAcpAgent.value) {
        const actualModel = inputCurrentModel.value;
        if (actualModel && actualModel !== conversation.modelId) {
          conversation.modelId = actualModel;
        }
      }
      if (Array.isArray(session.messages) && session.messages.length > 0) {
        const hasLocalError = hasPersistedError(conversation);
        if (hasLocalError) {
          const serverMessages = transcriptHistoryToModelMessages(session.messages);
          const hasServerError = hasPersistedError({
            messages: serverMessages,
            lastError: undefined,
          });
          if (hasServerError) {
            conversation.messages = serverMessages;
            if (String(conversation.key) === currentConversationKey.value && !isRequesting.value) {
              setMessages(conversation.messages);
            }
            showWelcome.value = false;
          } else if (!conversation.messages?.length) {
            conversation.messages = serverMessages;
            if (String(conversation.key) === currentConversationKey.value && !isRequesting.value) {
              setMessages(conversation.messages);
            }
            showWelcome.value = false;
          }
        } else {
          conversation.messages = transcriptHistoryToModelMessages(session.messages);
          if (String(conversation.key) === currentConversationKey.value && !isRequesting.value) {
            setMessages(conversation.messages);
          }
          showWelcome.value = false;
        }
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

const {
  browserNotificationsSupported,
  taskCompletionNotificationsEnabled,
  handleTaskCompletionNotificationsChange,
  handleTestTaskCompletionNotification,
  notifyTaskCompletion,
} = useNotifications({ conversationList });
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
const currentQueuedMessages = computed<QueuedChatMessage[]>(
  () => getCurrentConversation()?.queuedMessages ?? [],
);
const currentQueuePaused = computed(() => getCurrentConversation()?.queuePaused === true);

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
      (m) => m.message.role === "user" && !isHiddenModelMessage(m.message, m.extraInfo),
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

/** 布局视图：看板页 / 对话页（TopTabBar 切换，持久化到 localStorage）。 */
const viewMode = ref<"board" | "chat">(
  localStorage.getItem("open-chat-view") === "chat" ? "chat" : "board",
);
watch(viewMode, (mode) => {
  localStorage.setItem("open-chat-view", mode);
  // 路由跟随视图：对话视图写 /chat/...，看板视图归零到根路径
  if (mode === "chat") {
    syncConversationRoute("replace");
  } else {
    window.history.replaceState({}, "", "/");
  }
});

const resetToDraftConversation = () => {
  draftProjectPath.value = lastProjectPath();
  currentConversationKey.value = "";
  projectPath.value = draftProjectPath.value;
  syncConversationRoute("replace");
  showWelcome.value = true;
  historyBack.value = [];
  historyForward.value = [];
};

const handleNewConversation = () => {
  if (isInDraftMode.value) {
    showWelcome.value = true;
    return;
  }
  if (viewMode.value === "board") {
    // 看板主页：新任务直接以抽屉形态打开草稿会话
    boardOpenKey.value = DRAFT_BOARD_KEY;
  }
  resetToDraftConversation();
};

const pushHistory = (key: string) => {
  if (historyLocked.value) return;
  historyBack.value.push(key);
  historyForward.value = [];
};

const handleActiveChange: ConversationsProps["onActiveChange"] = (key) => {
  const targetKey = String(key);
  const targetConversation = conversationList.value.find((item) => String(item.key) === targetKey);
  // 聚合侧栏：点击不同供应商的会话时，自动切换供应商与模型
  if (targetConversation?.agentId && targetConversation.agentId !== activeAgentId.value) {
    const targetAgent = agents.value.find((agent) => agent.id === targetConversation.agentId);
    if (targetAgent) {
      resetPermissionForAgentSwitch();
      draftConversationKey.value = "";
      acpSession.value = null;
      activeAgentId.value = targetAgent.id;
      localStorage.setItem("open-chat-agent", targetAgent.id);
      if (
        targetAgent.kind !== "acp" &&
        typeof targetConversation.modelId === "string" &&
        targetConversation.modelId
      ) {
        currentModel.value = targetConversation.modelId;
        reconcileCurrentModel();
      }
    }
  } else if (
    targetConversation?.modelId &&
    !isAcpAgent.value &&
    typeof targetConversation.modelId === "string" &&
    targetConversation.modelId !== currentModel.value
  ) {
    currentModel.value = targetConversation.modelId;
    reconcileCurrentModel();
  }

  if (targetKey !== currentConversationKey.value) {
    pushHistory(currentConversationKey.value || "");
  }
  currentConversationKey.value = targetKey;
  syncConversationRoute("push");
  const conv = getCurrentConversation();
  if (conv) {
    showWelcome.value = (conv.messages?.length ?? 0) === 0;
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
  const next = agents.value.find((agent) => agent.id === agentId);
  if (!next) return;
  resetPermissionForAgentSwitch();
  draftConversationKey.value = "";
  acpSession.value = null;
  // 项目与供应商解耦：切换供应商不重置项目目录，保留当前选择供新会话复用
  activeAgentId.value = next.id;
  localStorage.setItem("open-chat-agent", next.id);
  currentConversationKey.value = "";
  showWelcome.value = true;
  historyBack.value = [];
  historyForward.value = [];
  syncConversationRoute("replace");
  if (!next.available) {
    message.warning(next.adapterHint || `${next.name} 当前不可用，请检查本地 CLI 安装与登录状态`);
  }
};

const closeSidebar = () => {
  conversationsOpen.value = false;
};

// ============ 多会话并发运行管理 (Multi-Session Run Manager) ============

interface ActiveSessionRun {
  conversationKey: string;
  agentId: string;
  modelId: string;
  startedAt: number;
  provider: OpenChatProvider;
  abort: () => void;
  outcome: "pending" | "error" | "abort" | null;
  errorText: string | null;
}

const activeSessionRuns = reactive(new Map<string, ActiveSessionRun>());
const pendingSearchSourcesMap = reactive(new Map<string, WebSearchSourceItem[]>());

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

const createSessionProvider = (convKey: string, agentId: string) => {
  const p = new OpenChatProvider({
    request: XRequest<OpenChatParams, XModelResponse>(`${API_BASE_URL}/api/chat/completions`, {
      manual: true,
      params: { stream: true } as OpenChatParams,
      headers: GATEWAY_API_KEY ? { Authorization: `Bearer ${GATEWAY_API_KEY}` } : undefined,
      streamTimeout: 10 * 60 * 1000,
    }),
  });

  // 本应用不经过 useXChat，provider 由 Chat.vue 手动驱动；
  // x-sdk 的 DeepSeekChatProvider.transformParams 用 getMessages() 组装请求
  // messages（未注入 _getMessagesFn 会抛 "not a function"）。这里把会话消息
  // 注入进去：排除 in-flight 占位（status "loading"，与 x-sdk getFilteredMessages 一致）。
  p.injectGetMessages(() => {
    const conversation = conversationList.value.find((item) => String(item.key) === convKey);
    return (conversation?.messages ?? [])
      .filter((info) => info.status !== "loading")
      .map((info) => info.message);
  });

  p.onPermissionRequest = (request) => {
    pendingPermissions.set(convKey, request);
  };
  p.onChatError = (message: string) => {
    const run = activeSessionRuns.get(convKey);
    if (run) {
      run.errorText = typeof message === "string" && message.trim() ? message.trim() : "请求失败";
      if (run.outcome === "pending") run.outcome = "error";
    }
  };
  p.onProviderSession = ({ agentId: _sessionAgentId, sessionId }) => {
    const conversation = conversationList.value.find((item) => String(item.key) === convKey);
    if (!conversation) return;
    conversation.providerSessionId = sessionId;
    schedulePersistState();
  };
  p.onWebSearchSources = (sources) => {
    const prev = pendingSearchSourcesMap.get(convKey) ?? [];
    pendingSearchSourcesMap.set(convKey, [
      ...prev,
      ...sources.map((source, index) => ({
        ...source,
        key: String(prev.length + index),
      })),
    ]);
  };

  return p;
};

const setMessages = (
  updater:
    | DefaultMessageInfo<XModelMessage>[]
    | ((current: DefaultMessageInfo<XModelMessage>[]) => DefaultMessageInfo<XModelMessage>[]),
) => {
  const conv = getCurrentConversation();
  if (!conv) return;
  const current = conv.messages || [];
  const next = typeof updater === "function" ? updater(current) : updater;
  conv.messages = persistMessageTimings(String(conv.key), next);
  schedulePersistState();
};

const isConversationRunning = (key: string): boolean => {
  if (!key) return false;
  if (activeSessionRuns.has(key)) return true;
  if (
    key === currentConversationKey.value &&
    usesAcpProtocol.value &&
    acpRunState.value?.state === "running"
  ) {
    return true;
  }
  return false;
};

const isCurrentConversationRunning = computed(() =>
  isConversationRunning(currentConversationKey.value),
);

/** 兼容旧代码与 ChatHeader 中的 syncing 标记 */
const isRequesting = isCurrentConversationRunning;

/** 当前激活会话等待审批的权限请求 */
const pendingPermission = computed(() =>
  currentConversationKey.value
    ? (pendingPermissions.get(currentConversationKey.value) ?? null)
    : null,
);

const pendingChatError = computed(() => {
  if (!currentConversationKey.value) return null;
  return activeSessionRuns.get(currentConversationKey.value)?.errorText ?? null;
});

/** 当前会话正在生成；输入仍可提交，但新消息会进入该会话专属队列 */
const inputRunning = computed(() => isConversationRunning(currentConversationKey.value));
/** 初始化期间无法可靠确定目标会话，此时才真正禁用输入。 */
const inputUnavailable = computed(() => isAcpAgent.value && isHydrating.value);
const inputBusy = computed(() => inputUnavailable.value || inputRunning.value);

const conversationBusyStates = computed<Record<string, { startedAt: number }>>(() => {
  const states: Record<string, { startedAt: number }> = {};
  for (const [key, run] of activeSessionRuns.entries()) {
    states[key] = { startedAt: run.startedAt };
  }
  return states;
});

/** 当前会话的运行起点；聊天区与侧栏共用这一份时间。 */
const currentConversationBusyState = computed(() =>
  currentConversationKey.value
    ? conversationBusyStates.value[currentConversationKey.value]
    : undefined,
);
/** 共享计时 tick：驱动任务卡片/抽屉内会话的耗时显示 */
const hasTaskBusy = computed(() => Object.keys(conversationBusyStates.value).length > 0);
const taskNowTick = useNow(hasTaskBusy);

// ============ 会话持久化 ============

const {
  applyPersistedState,
  schedulePersistState,
  handleExportLocalHistory,
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

const handleVisibilityChange = () => {
  if (document.visibilityState === "hidden") {
    stopAcpLiveStream();
    return;
  }
  // 页面重新可见时重拉当前会话：refreshAcpSession 以服务端 activeRuns 纠正
  // acpRunState，并经 watcher 重新挂接运行中回合的实时流。
  void refreshAcpSession();
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
    // 项目与供应商解耦：不清空 draftProjectPath，保留全局项目选择
    activeAgentId.value = targetAgent.id;
    localStorage.setItem("open-chat-agent", targetAgent.id);
  }

  // 2) 会话：精确 key → ACP 重建 key → providerSessionId 匹配；找不到则落到草稿
  if (!routeSessionId) {
    draftProjectPath.value = lastProjectPath();
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
      activeAgentId.value = conversation.agentId;
      localStorage.setItem("open-chat-agent", conversation.agentId);
    }
    currentConversationKey.value = String(conversation.key);
    showWelcome.value = (conversation.messages?.length ?? 0) === 0;
    return true;
  }
  // 本地找不到：仅展示本地 IndexedDB 会话，不再等待供应商侧同步创建
  draftProjectPath.value = lastProjectPath();
  currentConversationKey.value = "";
  setMessages([]);
  showWelcome.value = true;
  return true;
};

/** 浏览器前进/后退：按路由恢复会话，并让视图跟随路由（/chat/... → 对话，/ → 看板）。 */
const handleRoutePopState = () => {
  void restoreRouteConversation().then((isChatRoute) => {
    if (isChatRoute) {
      // 会话路由只属于对话视图
      if (viewMode.value !== "chat") viewMode.value = "chat";
    } else if (window.location.pathname === "/") {
      // 根路径即看板视图
      if (viewMode.value !== "board") viewMode.value = "board";
    }
  });
};

const {
  attachPendingSearchSources,
  setConversationLastError,
  clearConversationLastError,
  getConversationErrorMessage,
} = useSessionErrors({
  conversationList,
  currentConversationKey,
  pendingSearchSources,
  pendingSearchSourcesMap,
  activeSessionRuns,
  persistMessageTimings,
  schedulePersistState,
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

const finalizeAcpStreamMessages = () => {
  setMessages((current) =>
    current.map((item) =>
      item.status === "loading" || item.status === "updating"
        ? { ...item, status: "success" as const }
        : item,
    ),
  );
};

/** 复用 OpenChatProvider.transformMessage 累积当前回合输出，与常规请求同一渲染管线。 */
const handleAcpStreamEvent = (event: string | null, data: string) => {
  if (data === "[DONE]") return;
  if (event === "snapshot") {
    try {
      const parsed = JSON.parse(data) as { messages?: unknown };
      if (Array.isArray(parsed.messages)) {
        setMessages(transcriptHistoryToModelMessages(parsed.messages as TranscriptMessage[]));
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
        setMessages(
          appendTranscriptMessageToModelMessages(currentConversationMessages.value, parsed),
        );
      }
    } catch (err) {
      console.error("Failed to parse transcript stream message:", err);
    }
    return;
  }
  const msgs = currentConversationMessages.value;
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
  if (acpRunState.value?.state !== "running") return;
  if (activeSessionRuns.has(conversationId)) return;
  // acpSession 由 refreshAcpSession 异步写入：切换/新建会话后的一小段时间里它仍然
  // 指向上一个会话（acpRunState 同理）。此时用它的 conversationId 订阅会把上一个
  // 会话的流快照（整段历史消息）灌进当前会话——新建的会话直接显示上一个会话的内容。
  // 因此只订阅「已确认属于当前会话」的那条流；等刷新回来后 watcher 会再次触发。
  const loaded = acpSession.value;
  if (!loaded || loaded.conversationId !== conversationId) return;
  // 实时流注册表按网关会话 id 索引；UI key 与其一致（refreshAcpSession 返回的
  // conversationId），仅消息更新与队列状态继续使用 UI key。
  const streamConversationId = loaded.conversationId;
  const streamKey = `${activeAgentId.value}:${streamConversationId}`;
  if (acpStreamController.value && acpStreamConversationKey === streamKey) return;
  stopAcpLiveStream();
  acpStreamConversationKey = streamKey;
  const controller = subscribeAcpSessionStream(
    activeAgentId.value,
    streamConversationId,
    conversation.projectPath ?? projectPath.value,
    handleAcpStreamEvent,
    (outcome) => {
      if (acpStreamController.value !== controller) return;
      acpStreamController.value = null;
      acpStreamConversationKey = "";
      if (outcome === "disconnected") return;
      finalizeAcpStreamMessages();
      // 先清运行态再刷新，避免「刷新与订阅之间回合恰好结束」的 204 立即
      // 重开同一条流形成紧绷请求循环。
      acpRunState.value = null;
      const manuallyStopped = manuallyStoppedConversationKeys.delete(conversationId);
      if (outcome === "failed") {
        failedHistoryRefreshLocks.add(conversationId);
        // 持久化已终止：保证看板归入已终止且刷新后不消失
        const errorText = getConversationErrorMessage(conversationId);
        setConversationLastError(conversationId, errorText);
      } else if (outcome === "completed" && !manuallyStopped) {
        failedHistoryRefreshLocks.delete(conversationId);
        clearConversationLastError(conversationId);
      } else {
        if (outcome !== "failed") failedHistoryRefreshLocks.delete(conversationId);
        if (manuallyStopped) {
          setConversationLastError(conversationId, "已手动停止");
        }
      }
      // A failed retry already has its error attached to the live assistant
      // message. Do not reload history here: providers generally do not
      // persist that transient error, so a refresh would immediately hide it.
      if (outcome === "completed") void refreshAcpSession();
      if (outcome === "completed" && !manuallyStopped) {
        if (conversation.queuedMessages?.length) {
          conversation.queuePaused = false;
          schedulePersistState();
          scheduleNextQueuedMessage(conversationId);
        }
        notifyTaskCompletion({
          key: `task:${activeAgentId.value}:${conversationId}:${
            conversationBusyStates.value[conversationId]?.startedAt ?? Date.now()
          }`,
          agentId: activeAgentId.value,
          conversationKey: conversationId,
        });
      } else if (conversation.queuedMessages?.length) {
        conversation.queuePaused = true;
        schedulePersistState();
      }
    },
  );
  acpStreamController.value = controller;
};

watch([acpRunState, isRequesting, currentConversationKey, activeAgentId], () => {
  if (activeSessionRuns.has(currentConversationKey.value)) {
    stopAcpLiveStream();
    return;
  }
  if (acpRunState.value?.state === "running") {
    startAcpLiveStream();
  } else {
    stopAcpLiveStream();
  }
});

watch([activeAgentId, currentConversationKey, isHydrating], ([, key], [, previousKey]) => {
  // Selecting another conversation is an explicit user/navigation action, so
  // its provider history may become authoritative again.
  if (key && key !== previousKey) failedHistoryRefreshLocks.delete(key);
  void refreshAcpSession();
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
  componentUnmounted = false;
  window.addEventListener("keydown", handleWorkspaceKeydown);
  window.addEventListener("popstate", handleRoutePopState);
  document.addEventListener("visibilitychange", handleVisibilityChange);
  const initialChatPath = window.location.pathname;
  const [persistedState, loadedAgents, loadedDefaultProjectPath, loadedTasks] = await Promise.all([
    loadChatState(),
    loadAcpAgents().catch((error) => {
      console.error("Failed to load local agents:", error);
      return [API_AGENT];
    }),
    aiService.getDefaultProjectPath().catch(() => ""),
    loadTasks().catch(() => [] as Task[]),
  ]);
  defaultProjectPath.value = loadedDefaultProjectPath;
  if (loadedDefaultProjectPath) {
    projectPathHistory.value = uniqueDirectoryPaths(
      projectPathHistory.value.map(normalizeProjectPath),
    ).slice(0, 20);
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
  taskList.value = loadedTasks;
  // 清理悬空会话引用（会话已被删除）
  const validKeys = new Set(conversationList.value.map((c) => String(c.key)));
  let tasksChanged = false;
  for (const task of taskList.value) {
    const before = task.sessionKeys.length;
    task.sessionKeys = task.sessionKeys.filter((k) => validKeys.has(k));
    if (task.sessionKeys.length !== before) tasksChanged = true;
  }
  if (tasksChanged) void saveTasks(taskList.value);
  if (componentUnmounted) return;
  // URL 直达：打开复制的链接时恢复对应供应商与会话（仅本地会话，不再预拉供应商全量）
  await restoreRouteConversation(initialChatPath);
  if (componentUnmounted) return;
  // 会话直达链接（/chat/...）强制进入对话视图；地址栏随后与当前会话对齐
  if (parseChatRoute(initialChatPath)) {
    viewMode.value = "chat";
  }
  if (viewMode.value === "chat") {
    syncConversationRoute("replace");
  }
  // Release session/config watchers only after the final route conversation
  // is known. Releasing earlier creates a throwaway draft session request.
  isHydrating.value = false;
});

onBeforeUnmount(() => {
  componentUnmounted = true;
  window.removeEventListener("keydown", handleWorkspaceKeydown);
  window.removeEventListener("popstate", handleRoutePopState);
  document.removeEventListener("visibilitychange", handleVisibilityChange);
  stopAcpLiveStream();
  if (queuedMessageTimer) clearTimeout(queuedMessageTimer);
  // 卸载前把尚未落盘的任务变更刷进 IndexedDB
  if (persistTasksTimer) {
    clearTimeout(persistTasksTimer);
    persistTasksTimer = null;
    void saveTasks(taskList.value);
  }
});

// ============ 消息转换 ============

const { optimisticMessages, optimisticMessage, hasAcknowledgedOptimisticMessage, bubbleItems } =
  useMessageView({
    currentConversationKey,
    currentConversationMessages,
    currentConversationBusyState,
    isConversationRunning,
  });

// ============ 事件处理 ============

const handlePromptClick = (info: { data: { key?: string; description?: string } }) => {
  const prompt = typeof info.data.description === "string" ? info.data.description : "";
  if (inputBusy.value || !prompt) return;

  showWelcome.value = false;
  handleSubmit(prompt);
};

const handleCancel = () => {
  const conversationId = currentConversationKey.value;
  if (!conversationId) return;

  manuallyStoppedConversationKeys.add(conversationId);
  const conversation = conversationList.value.find((item) => String(item.key) === conversationId);
  if (conversation?.queuedMessages?.length) {
    conversation.queuePaused = true;
    schedulePersistState();
  }

  const run = activeSessionRuns.get(conversationId);
  if (run) {
    run.abort();
  }

  // ACP：断连不再自动取消回合，停止必须先调服务端取消接口
  if (isAcpAgent.value) {
    void cancelAcpTurn(activeAgentId.value, conversationId);
  }
  if (acpStreamController.value && acpStreamConversationKey.includes(conversationId)) {
    stopAcpLiveStream();
  }
};

/** 回复 opencode 权限询问：允许一次 / 始终允许 / 拒绝。 */
const handlePermissionResponse = async (response: "once" | "always" | "reject"): Promise<void> => {
  const conversationId = currentConversationKey.value;
  if (!conversationId) return;
  const permission = pendingPermissions.get(conversationId);
  if (!permission) return;

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
    pendingPermissions.delete(conversationId);
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

  return composedPrompt;
};

/**
 * 草稿态落地当前会话：需要发送或入队时若还没有会话则新建并写入侧栏，
 * 返回当前会话（草稿态创建失败时为 undefined）。
 */
const ensureActiveConversation = (systemPrompt = ""): OpenChatConversation | undefined => {
  if (isInDraftMode.value) {
    const newConversation = createNewConversation(
      systemPrompt,
      isAcpAgent.value ? ensureDraftConversationKey() : "",
      inputCurrentModel.value,
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
  return getCurrentConversation();
};

const finalizeSessionRun = (convKey: string, outcome: "success" | "error" | "abort") => {
  const run = activeSessionRuns.get(convKey);
  const startedAt = run?.startedAt ?? Date.now();
  const runAgentId = run?.agentId ?? activeAgentId.value;
  const manuallyStopped = manuallyStoppedConversationKeys.delete(convKey) || outcome === "abort";

  const conversation = conversationList.value.find((item) => String(item.key) === convKey);
  if (conversation) {
    if (outcome === "error") {
      failedHistoryRefreshLocks.add(convKey);
      const errorText = run?.errorText || getConversationErrorMessage(convKey);
      setConversationLastError(convKey, errorText);
    } else if (manuallyStopped) {
      failedHistoryRefreshLocks.delete(convKey);
      const abortText =
        run?.errorText && run.errorText !== "请求已中止" ? run.errorText : "已手动停止";
      setConversationLastError(convKey, abortText);
    } else if (outcome === "success") {
      failedHistoryRefreshLocks.delete(convKey);
      clearConversationLastError(convKey);
    }
  }

  attachPendingSearchSources(convKey);
  pendingPermissions.delete(convKey);
  optimisticMessages.delete(convKey);
  activeSessionRuns.delete(convKey);

  if (outcome === "success" && !manuallyStopped) {
    notifyTaskCompletion({
      key: `task:${runAgentId}:${convKey}:${startedAt}`,
      agentId: runAgentId,
      conversationKey: convKey,
    });
  }

  if (conversation) {
    if (conversation.queuedMessages?.length) {
      conversation.queuePaused = manuallyStopped || outcome === "error";
      schedulePersistState();
      if (!manuallyStopped && outcome === "success") {
        scheduleNextQueuedMessage(convKey);
      }
    } else if (conversation.queuePaused) {
      conversation.queuePaused = false;
      schedulePersistState();
    }
  }

  schedulePersistState();
};

// ============ 流式 chunk 合并更新 ============
// 每个 chunk 都会走 transformMessage + updateConversationMessages（触发整棵
// 消息树重渲染）。真实模型 10~30 chunk/s 尚可，快速流（如 mock 8ms/chunk）
// 一秒钟上百次全量更新会让 GC 追不上、堆内存堆积。useCoalescedUpdater 把
// 会话更新合并到 100ms 一拍：chunk 处理本身（transformMessage 增量累积）
// 仍逐 chunk 执行，仅减少对外可见的整树更新次数；流结束/出错时 flush 落盘。
//
// streamPendingOrigins：合并窗口内「已累积但尚未应用」的 target 消息。
// 窗口内每个 chunk 都基于它继续累加（见 onUpdate），批次应用后清除。
const streamPendingOrigins = new Map<string, XModelMessage>();
const { schedule: scheduleStreamMessageUpdate, flush: flushStreamMessageUpdate } =
  useCoalescedUpdater<DefaultMessageInfo<XModelMessage>[]>((convKey, msgs) => {
    streamPendingOrigins.delete(convKey);
    updateConversationMessages(convKey, persistMessageTimings(convKey, msgs));
  }, 100);

const runSessionRequest = (
  convKey: string,
  requestParams: OpenChatParams,
  extraInfo?: Record<string, unknown>,
  isReload = false,
  reloadMessageId?: string | number,
) => {
  const conv = conversationList.value.find((item) => String(item.key) === convKey);
  if (!conv) return;
  // 新回合开始：清掉上一回合可能残留的未应用 origin，避免跨回合串内容。
  streamPendingOrigins.delete(convKey);

  const runAgentId = conv.agentId || activeAgentId.value;
  const sessionProvider = createSessionProvider(convKey, runAgentId);
  const now = Date.now();

  const assistantMsgId = reloadMessageId
    ? String(reloadMessageId)
    : `msg-${now}-${Math.random().toString(36).slice(2, 8)}`;

  if (isReload && reloadMessageId) {
    conv.messages = (conv.messages || []).map((m) =>
      String(m.id) === String(reloadMessageId)
        ? {
            ...m,
            status: "loading" as const,
            message: { ...m.message, content: "", reasoningContent: undefined },
          }
        : m,
    );
  } else {
    conv.messages = [
      ...(conv.messages || []),
      {
        id: assistantMsgId,
        status: "loading" as const,
        message: { role: "assistant", content: "" },
      },
    ];
  }
  schedulePersistState();

  const runEntry: ActiveSessionRun = {
    conversationKey: convKey,
    agentId: runAgentId,
    modelId: (requestParams.model as string) || inputCurrentModel.value,
    startedAt: now,
    provider: sessionProvider,
    abort: () => {
      runEntry.outcome = "abort";
      sessionProvider.request.abort();
    },
    outcome: "pending",
    errorText: null,
  };
  activeSessionRuns.set(convKey, runEntry);

  sessionProvider.request.options.callbacks = {
    onUpdate: (chunk: XModelResponse, responseHeaders: Headers) => {
      const currentConv = conversationList.value.find((item) => String(item.key) === convKey);
      if (!currentConv || !currentConv.messages) return;

      const msgs = [...currentConv.messages];
      const targetIdx = msgs.findIndex((m) => String(m.id) === String(assistantMsgId));
      if (targetIdx === -1) return;

      const targetMsg = msgs[targetIdx];
      // 会话更新被合并到时间闸统一应用（scheduleStreamMessageUpdate），
      // currentConv.messages 尚未包含本窗口内已累积的增量。transformMessage
      // 必须基于「已累积但未落地」的 origin 逐 chunk 继续累加，否则窗口内
      // 每个 chunk 都从旧状态起步，只有最后一个增量被保留（内容变残缺）。
      const pendingOrigin = streamPendingOrigins.get(convKey) ?? targetMsg.message;
      const nextMsg = sessionProvider.transformMessage({
        originMessage: pendingOrigin,
        chunk,
        chunks: [],
        status: "updating",
        responseHeaders,
      });

      msgs[targetIdx] = {
        ...targetMsg,
        status: "updating",
        message: nextMsg,
        ...(extraInfo ? { extraInfo } : {}),
      };
      streamPendingOrigins.set(convKey, nextMsg);
      // 合并到时间闸统一应用，避免快速流逐 chunk 全量更新打爆渲染/GC。
      scheduleStreamMessageUpdate(convKey, msgs);

      const pending = optimisticMessages.get(convKey);
      if (pending && hasAcknowledgedOptimisticMessage(msgs, pending)) {
        optimisticMessages.delete(convKey);
      }
      // 不再逐 chunk 持久化：回合运行期间跳过（见 useChatPersistence deep watch），
      // finalizeSessionRun 在回合结束时统一落盘，避免流式长回合打爆 IndexedDB 队列。
    },
    onSuccess: (chunks: XModelResponse[], responseHeaders: Headers) => {
      // 先落掉最后一批未应用的 chunk，再基于最新会话状态生成最终消息。
      flushStreamMessageUpdate(convKey);
      const currentConv = conversationList.value.find((item) => String(item.key) === convKey);
      if (currentConv && currentConv.messages) {
        const msgs = [...currentConv.messages];
        const targetIdx = msgs.findIndex((m) => String(m.id) === String(assistantMsgId));
        if (targetIdx !== -1) {
          const targetMsg = msgs[targetIdx];
          const finalMsg = sessionProvider.transformMessage({
            originMessage: targetMsg.message,
            chunk: undefined as unknown as XModelResponse,
            chunks,
            status: "success",
            responseHeaders,
          });
          msgs[targetIdx] = {
            ...targetMsg,
            status: "success",
            message: finalMsg,
          };
          updateConversationMessages(convKey, persistMessageTimings(convKey, msgs));
        }
      }
      finalizeSessionRun(convKey, "success");
    },
    onError: (error: Error, errorInfo?: unknown) => {
      const run = activeSessionRuns.get(convKey);
      const isAbort = error.name === "AbortError" || run?.outcome === "abort";
      const outcome = isAbort ? "abort" : "error";
      if (run && !run.errorText) {
        run.errorText =
          (typeof (errorInfo as { error?: { message?: string } })?.error?.message === "string" &&
            (errorInfo as { error?: { message?: string } }).error!.message!.trim()) ||
          (error instanceof Error && error.message.trim()) ||
          (isAbort ? "请求已中止" : "请求失败，请重试！");
      }

      // 先落掉最后一批未应用的 chunk，再基于最新会话状态标记错误。
      flushStreamMessageUpdate(convKey);
      const currentConv = conversationList.value.find((item) => String(item.key) === convKey);
      if (currentConv && currentConv.messages) {
        const msgs = [...currentConv.messages];
        const targetIdx = msgs.findIndex((m) => String(m.id) === String(assistantMsgId));
        if (targetIdx !== -1) {
          const targetMsg = msgs[targetIdx];
          const existing =
            typeof targetMsg.message.content === "string" ? targetMsg.message.content : "";
          const content = isAbort
            ? existing && existing !== WEB_SEARCHING_MARKER
              ? existing
              : "请求已中止"
            : existing || run?.errorText || "请求失败，请重试！";
          msgs[targetIdx] = {
            ...targetMsg,
            status: isAbort ? "abort" : "error",
            message: { ...targetMsg.message, content, role: "assistant" },
          };
          updateConversationMessages(convKey, persistMessageTimings(convKey, msgs));
        }
      }
      finalizeSessionRun(convKey, outcome);
    },
  };

  try {
    const transformed = sessionProvider.transformParams(
      requestParams,
      sessionProvider.request.options,
    );
    sessionProvider.request.run(transformed);
  } catch (err) {
    finalizeSessionRun(convKey, "error");
    throw err;
  }
};

const sendMessageNow = (
  nextContent: string,
  options: SubmitMessageOptions = {},
  clearComposer = true,
  targetConversationKey?: string,
): boolean => {
  if ((!nextContent || !nextContent.trim()) && !options.attachments?.length) return false;
  if (inputUnavailable.value) return false;
  if (!activeAgent.value.available) {
    message.warning(
      activeAgent.value.adapterHint ||
        `${activeAgent.value.name} 当前不可用，请检查本地 CLI 安装与登录状态`,
    );
    return false;
  }

  // 草稿态首次发送时，才创建真实会话并写入侧栏
  const conversation = targetConversationKey
    ? conversationList.value.find((item) => String(item.key) === targetConversationKey)
    : ensureActiveConversation(options.systemPrompt ?? "");
  if (!conversation) return false;
  const conversationKey = String(conversation.key);

  if (isConversationRunning(conversationKey)) {
    queueMessage(conversation, nextContent, options.attachments);
    return true;
  }

  failedHistoryRefreshLocks.delete(conversationKey);
  const hadError = Boolean(conversation.lastError);
  const hadOverride = Boolean(conversation.statusOverride);
  if (conversation.lastError) delete conversation.lastError;
  if (conversation.statusOverride) conversation.statusOverride = "";
  if (hadError || hadOverride) schedulePersistState();
  if (options.systemPrompt !== undefined) {
    conversation.systemPrompt = options.systemPrompt.trim();
  }
  // 只有真正提交新消息才改变会话排序；读取、恢复和实时回放保持原顺序。
  conversation.updatedAt = Date.now();
  // 记录会话创建/最后使用的供应商与模型，供聚合侧栏点击时恢复
  if (!conversation.agentId) conversation.agentId = activeAgentId.value;
  if (!conversation.modelId) conversation.modelId = inputCurrentModel.value;
  manuallyStoppedConversationKeys.delete(conversationKey);

  showWelcome.value = false;
  const isHiddenRequest = options.extraInfo?.hidden === true;
  const optimisticId = `optimistic-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const requestExtraInfo: Record<string, unknown> = {
    ...options.extraInfo,
    ...(isHiddenRequest ? {} : { optimisticId }),
  };
  if (!isHiddenRequest) {
    optimisticMessages.set(conversationKey, {
      conversationKey,
      id: optimisticId,
      message: {
        role: "user",
        content: nextContent,
        ...(options.attachments?.length ? { attachments: options.attachments } : {}),
      },
      extraInfo: requestExtraInfo,
    });
  }

  const userMsgId = `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const userMsg: DefaultMessageInfo<XModelMessage> = {
    id: userMsgId,
    status: "local",
    message: {
      role: "user",
      content: nextContent,
      ...(options.attachments?.length ? { attachments: options.attachments } : {}),
    },
    extraInfo: requestExtraInfo,
  };

  conversation.messages = persistMessageTimings(conversationKey, [
    ...(conversation.messages || []),
    userMsg,
  ]);
  schedulePersistState();

  const forwardProvider = getForwardProvider(conversation.modelId || currentModel.value);
  try {
    runSessionRequest(
      conversationKey,
      {
        messages: [
          {
            role: "user",
            content: nextContent,
            ...(options.attachments?.length ? { attachments: options.attachments } : {}),
          },
        ],
        model: conversation.modelId || inputCurrentModel.value,
        mode: workMode.value,
        permission: effectivePermissionMode.value,
        systemPrompt: getRequestSystemPrompt(conversation.systemPrompt ?? ""),
        ...(options.goal ? { goal: options.goal } : {}),
        ...(options.instruction ? { instruction: options.instruction } : {}),
        enable_thinking: thinkingEnabled.value,
        thinking: { type: thinkingEnabled.value ? "enabled" : "disabled" },
        conversationId: conversationKey,
        ...(isAcpAgent.value ? { acpAgentId: conversation.agentId || activeAgentId.value } : {}),
        ...(isAcpAgent.value && conversation.providerSessionId
          ? { providerSessionId: conversation.providerSessionId }
          : {}),
        ...(conversation.projectPath?.trim() || projectPath.value.trim()
          ? { projectPath: (conversation.projectPath || projectPath.value).trim() }
          : {}),
        ...(!isAcpAgent.value && forwardProvider ? { provider: forwardProvider } : {}),
      },
      requestExtraInfo,
    );
  } catch (error) {
    optimisticMessages.delete(conversationKey);
    message.error(error instanceof Error ? error.message : "请求启动失败");
    return false;
  }
  if (
    clearComposer &&
    (!targetConversationKey || targetConversationKey === currentConversationKey.value)
  ) {
    setTimeout(() => {
      content.value = "";
    }, 0);
  }
  return true;
};

let queuedMessageTimer: ReturnType<typeof setTimeout> | null = null;
let queuedMessageTimerKey = "";

const dispatchNextQueuedMessage = (conversationKey: string) => {
  if (!conversationKey) return;
  if (inputUnavailable.value || isConversationRunning(conversationKey)) {
    return;
  }
  const conversation = conversationList.value.find((item) => String(item.key) === conversationKey);
  const queuedMessage = conversation?.queuedMessages?.[0];
  if (!conversation || conversation.queuePaused || !queuedMessage) return;

  conversation.queuedMessages = conversation.queuedMessages?.slice(1) ?? [];
  conversation.queuePaused = false;
  schedulePersistState();
  const started = sendMessageNow(
    queuedMessage.content,
    { attachments: queuedMessage.attachments },
    false,
    conversationKey,
  );
  if (!started) {
    conversation.queuedMessages = [queuedMessage, ...(conversation.queuedMessages ?? [])];
    conversation.queuePaused = true;
    schedulePersistState();
  }
};

scheduleNextQueuedMessage = (conversationKey: string) => {
  if (!conversationKey) return;
  if (queuedMessageTimer && queuedMessageTimerKey === conversationKey) return;
  if (queuedMessageTimer) clearTimeout(queuedMessageTimer);
  queuedMessageTimerKey = conversationKey;
  queuedMessageTimer = setTimeout(() => {
    queuedMessageTimer = null;
    queuedMessageTimerKey = "";
    dispatchNextQueuedMessage(conversationKey);
  }, 80);
};

const queueMessage = (
  conversation: OpenChatConversation,
  nextContent: string,
  attachments?: UploadedAttachment[],
) => {
  const queuedMessage: QueuedChatMessage = {
    id: `queued-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    content: nextContent.trim(),
    createdAt: Date.now(),
    ...(attachments?.length ? { attachments: attachments.map((item) => ({ ...item })) } : {}),
  };
  conversation.queuedMessages = [...(conversation.queuedMessages ?? []), queuedMessage];
  schedulePersistState();
  content.value = "";
};

const handleSubmit = (
  nextContent: string,
  attachmentsOrOptions: UploadedAttachment[] | SubmitMessageOptions = [],
  commandMeta?: { command: string; rawGoal: string },
) => {
  // 兼容 ChatInput 的 (value, attachments[], commandMeta) 与内部调用的 (value, options)
  let options: SubmitMessageOptions = {};
  if (Array.isArray(attachmentsOrOptions)) {
    options = { attachments: attachmentsOrOptions };
  } else if (attachmentsOrOptions && typeof attachmentsOrOptions === "object") {
    options = attachmentsOrOptions as SubmitMessageOptions;
  }
  if (commandMeta?.rawGoal) {
    if (
      commandMeta.command === "goal" ||
      commandMeta.command === "system" ||
      commandMeta.command === "objective"
    ) {
      options.goal = commandMeta.rawGoal;
    } else if (commandMeta.command === "instruction") {
      options.instruction = commandMeta.rawGoal;
    } else if (commandMeta.command === "review") {
      // Review 复审作为高优指令，复用 instruction 通道并以 [GOAL] 注入
      options.instruction = commandMeta.rawGoal;
    }
  } else {
    // 兜底：直接输入的 "/goal xxx" 未经 ChatInput 解析时（如 handlePromptClick 等路径）
    const trimmed = nextContent.trimStart();
    const match = trimmed.match(/^\/(goal|system|instruction|objective|review)\s+([\s\S]+)$/i);
    if (match) {
      const cmd = match[1].toLowerCase();
      const arg = match[2].trim();
      if (arg) {
        if (cmd === "goal" || cmd === "system" || cmd === "objective") {
          options.goal = arg;
          // 保持气泡可读性：用统一前缀展示
          nextContent = `🎯 目标指令：${arg}`;
        } else if (cmd === "instruction") {
          options.instruction = arg;
          nextContent = `📋 指令：${arg}`;
        } else if (cmd === "review") {
          options.instruction = arg;
          nextContent = `🔍 复审指令：${arg}`;
        }
      }
    }
  }
  if ((!nextContent || !nextContent.trim()) && !options.attachments?.length) return;
  if (inputUnavailable.value) return;
  if (!activeAgent.value.available) {
    message.warning(
      activeAgent.value.adapterHint ||
        `${activeAgent.value.name} 当前不可用，请检查本地 CLI 安装与登录状态`,
    );
    return;
  }

  // 有请求在跑（或已有排队消息）时，新消息进入队列；草稿态先落地会话再入队，
  // 避免「发不出去」——消息被静默丢弃且无任何提示。
  let conversation = getCurrentConversation();
  const currentKey = conversation ? String(conversation.key) : "";
  if (isConversationRunning(currentKey) || conversation?.queuedMessages?.length) {
    if (!conversation) {
      conversation = ensureActiveConversation(options.systemPrompt ?? "");
      if (!conversation) return;
    }
    queueMessage(conversation, nextContent, options.attachments);
    if (!isConversationRunning(String(conversation.key)) && !conversation.queuePaused) {
      scheduleNextQueuedMessage(String(conversation.key));
    }
    return;
  }

  sendMessageNow(nextContent, options);
};

const handleQueuedMessageChange = (id: string, nextContent: string) => {
  const conversation = getCurrentConversation();
  if (!conversation) return;
  const queuedMessage = conversation.queuedMessages?.find((item) => item.id === id);
  if (!queuedMessage) return;
  const content = nextContent.trim();
  if (!content && !queuedMessage.attachments?.length) return;
  queuedMessage.content = content;
  schedulePersistState();
};

const handleQueuedMessageRemove = (id: string) => {
  const conversation = getCurrentConversation();
  if (!conversation) return;
  conversation.queuedMessages = (conversation.queuedMessages ?? []).filter(
    (item) => item.id !== id,
  );
  if (conversation.queuedMessages.length === 0) conversation.queuePaused = false;
  schedulePersistState();
};

const handleQueuedMessageClear = () => {
  const conversation = getCurrentConversation();
  if (!conversation?.queuedMessages?.length) return;
  if (!window.confirm("确定清空当前会话的待发送队列吗？")) return;
  conversation.queuedMessages = [];
  conversation.queuePaused = false;
  schedulePersistState();
};

const handleQueuedMessageSend = () => {
  const conversation = getCurrentConversation();
  if (!conversation?.queuedMessages?.length || inputRunning.value || inputUnavailable.value) return;
  conversation.queuePaused = false;
  schedulePersistState();
  scheduleNextQueuedMessage(String(conversation.key));
};

watch(
  [currentConversationKey, inputRunning, inputUnavailable, isHydrating, currentQueuePaused],
  () => {
    const conversation = getCurrentConversation();
    if (conversation?.queuedMessages?.length && !conversation.queuePaused) {
      scheduleNextQueuedMessage(String(conversation.key));
    }
  },
  { flush: "post" },
);

// ============ 输入区业务数据（Git / skills / 附件上传，原内嵌于 ChatInput） ============
const composerData = useComposerData({
  projectPath,
  loading: inputRunning,
  agentMode: isAcpAgent,
  onProjectPathChange: handleProjectPathChange,
});
onBeforeUnmount(composerData.dispose);

const handleModelChange = async (key: string) => {
  if (isConversationRunning(currentConversationKey.value)) {
    message.warning("请先停止当前会话的任务再切换模型");
    return;
  }
  // 切换模型只影响后续请求，保持在当前会话内，不清空聊天记录。
  if (!isAcpAgent.value) {
    currentModel.value = key;
    if (currentConversationKey.value) {
      const conversation = getCurrentConversation();
      if (conversation) {
        conversation.modelId = key;
        schedulePersistState();
      }
    }
    return;
  }
  if (isConversationRunning(currentConversationKey.value) || acpSessionLoading.value) return;
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
    // ACP 配置写的是当前服务端会话；本地同样把模型记到当前会话上
    const conversation = getCurrentConversation();
    if (conversation) {
      conversation.modelId = key;
      schedulePersistState();
    }
    rememberAgentDefaultModel(activeAgentId.value, key);
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
};

const handleReloadMessage = (messageId: string | number) => {
  const currentConversation = getCurrentConversation();
  if (!currentConversation) return;
  const conversationKey = String(currentConversation.key);
  if (isConversationRunning(conversationKey)) {
    message.warning("该会话仍在运行，请等待完成后再重试");
    return;
  }

  const lastAssistantMessage = [...currentConversationMessages.value]
    .reverse()
    .find(({ message: modelMessage }) => modelMessage.role === "assistant");

  if (
    !lastAssistantMessage ||
    (lastAssistantMessage.status !== "success" &&
      lastAssistantMessage.status !== "error" &&
      lastAssistantMessage.status !== "abort") ||
    String(lastAssistantMessage.id) !== String(messageId)
  ) {
    message.warning("只能重新生成最后一条回答");
    return;
  }

  failedHistoryRefreshLocks.delete(conversationKey);
  if (currentConversation.lastError) delete currentConversation.lastError;
  if (currentConversation.statusOverride) currentConversation.statusOverride = "";
  schedulePersistState();

  const baseSystemPrompt = currentConversation.systemPrompt ?? "";
  const forwardProvider = getForwardProvider(currentConversation.modelId || currentModel.value);

  runSessionRequest(
    conversationKey,
    {
      messages: currentConversationMessages.value
        .filter((m) => String(m.id) !== String(messageId))
        .map((m) => ({
          role: m.message.role,
          content: m.message.content,
        })),
      model: currentConversation.modelId || inputCurrentModel.value,
      mode: workMode.value,
      permission: effectivePermissionMode.value,
      systemPrompt: getRequestSystemPrompt(baseSystemPrompt),
      conversationId: conversationKey,
      ...(isAcpAgent.value
        ? { acpAgentId: currentConversation.agentId || activeAgentId.value }
        : {}),
      ...(isAcpAgent.value && currentConversation.providerSessionId
        ? { providerSessionId: currentConversation.providerSessionId }
        : {}),
      ...(currentConversation.projectPath?.trim() || projectPath.value.trim()
        ? { projectPath: (currentConversation.projectPath || projectPath.value).trim() }
        : {}),
      ...(!isAcpAgent.value && forwardProvider ? { provider: forwardProvider } : {}),
    },
    undefined,
    true,
    messageId,
  );
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
  // 清理任务中的会话引用（归档对话从侧栏移除，任务侧也移除以保持一致）
  let tasksPruned = false;
  for (const task of taskList.value) {
    if (task.sessionKeys.includes(conversationKey)) {
      task.sessionKeys = task.sessionKeys.filter((k) => k !== conversationKey);
      task.updatedAt = Date.now();
      tasksPruned = true;
    }
  }
  if (tasksPruned) schedulePersistTasks();
  if (conversationKey === currentConversationKey.value) {
    resetAfterRemovingConversation();
  } else {
    schedulePersistState();
  }
  message.success("对话已归档");
};

/** 打开删除确认弹窗；确认后由 confirmDeleteConversation 执行删除。 */
const handleDeleteConversation = (conversationKey: string = currentConversationKey.value) => {
  if (!conversationKey) return;
  deleteTargetKey.value = conversationKey;
  deleteOpen.value = true;
};

const confirmDeleteConversation = () => {
  const conversationKey = deleteTargetKey.value;
  if (!conversationKey) return;
  conversationList.value = conversationList.value.filter(
    (conversation) => String(conversation.key) !== conversationKey,
  );
  // 同步清理任务中的悬空会话引用
  let tasksPruned = false;
  for (const task of taskList.value) {
    if (task.sessionKeys.includes(conversationKey)) {
      task.sessionKeys = task.sessionKeys.filter((k) => k !== conversationKey);
      task.updatedAt = Date.now();
      tasksPruned = true;
    }
  }
  if (tasksPruned) schedulePersistTasks();
  deleteOpen.value = false;
  deleteTargetKey.value = "";
  if (conversationKey === boardOpenKey.value) {
    boardOpenKey.value = "";
  }
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

// ============ 看板 ============

/** 看板卡片点击：切换到对应供应商并打开抽屉（复用 handleActiveChange 的供应商切换逻辑）。 */
const handleBoardOpenConversation = (key: string) => {
  boardOpenKey.value = key;
  if (key !== currentConversationKey.value) {
    handleActiveChange(key);
  }
};

const closeBoardDrawer = () => {
  boardOpenKey.value = "";
  syncConversationRoute("replace");
};

/** 拖拽归列 / 抽屉改列：写入覆盖标记，真实活动信号仍优先（见 deriveBoardStatus）。 */
const handleBoardMoveConversation = (key: string, status: SessionStatus) => {
  const conversation = conversationList.value.find((item) => String(item.key) === key);
  if (!conversation) return;
  // 从已终止拖出视为用户已确认该错误，清除持久错误标记以允许归列生效
  if (conversation.lastError && status !== "stopped") {
    delete conversation.lastError;
  }
  conversation.statusOverride = status === "done" ? "" : status;
  // 若仍为已终止列，保持 lastError；否则已在上方清除
  schedulePersistState();
};

const handleBoardPinConversation = (key: string) => {
  handlePinConversation(key);
};

const handleBoardArchiveConversation = (key: string) => {
  handleArchiveConversation(key);
};

const handleBoardDeleteConversation = (key: string) => {
  if (!key) return;
  // 复用删除逻辑但走侧栏的确认流：直接删
  handleDeleteConversation(key);
};

// ============ 任务看板（Task — 人） ============

const handleTaskOpen = (id: string) => {
  openTaskId.value = id;
};

const closeTaskDrawer = () => {
  openTaskId.value = "";
  // 任务抽屉关闭时同步收起其中的会话抽屉：若 boardOpenKey 残留，
  // 独立会话抽屉（v-if="!openTaskId"）会在任务抽屉收起后弹出来。
  boardOpenKey.value = "";
  syncConversationRoute("replace");
};

const handleTaskMove = (id: string, status: TaskStatus) => {
  try {
    taskList.value = updateTaskInList(taskList.value, id, { status });
  } catch (e) {
    message.error(e instanceof Error ? e.message : "移动失败");
    return;
  }
  schedulePersistTasks();
  message.success(`已移至 ${TASK_STATUS_META[status].name}`);
};

const handleTaskCreate = (payload: {
  title: string;
  projectPath: string | null;
  templateId?: string;
  status?: TaskStatus;
}) => {
  const normalizedPath =
    payload.projectPath !== null && payload.projectPath !== undefined
      ? normalizeProjectPath(String(payload.projectPath)) || null
      : null;
  if (normalizedPath) rememberProjectPath(normalizedPath);
  const task = createTaskInput({
    title: payload.title || undefined,
    projectPath: normalizedPath,
    status: payload.status,
    templateId: payload.templateId as unknown as
      | import("../services/taskStorage").TaskTemplateId
      | undefined,
  });
  taskList.value = [task, ...taskList.value];
  schedulePersistTasks();
  openTaskId.value = task.id;
  message.success("任务已创建");
};

const handleTaskUpdateTitle = (id: string, title: string) => {
  try {
    taskList.value = updateTaskInList(taskList.value, id, { title });
  } catch (e) {
    message.error(e instanceof Error ? e.message : "更新失败");
    return;
  }
  schedulePersistTasks();
};

const handleTaskUpdate = (id: string, patch: Partial<Task>) => {
  try {
    if (patch.projectPath !== undefined) {
      if (patch.projectPath === null || patch.projectPath === "") {
        patch.projectPath = null;
      } else {
        const normalized = normalizeProjectPath(String(patch.projectPath));
        patch.projectPath = normalized || null;
        if (patch.projectPath) rememberProjectPath(patch.projectPath);
      }
    }
    taskList.value = updateTaskInList(taskList.value, id, patch);
  } catch (e) {
    message.error(e instanceof Error ? e.message : "更新失败");
    return;
  }
  schedulePersistTasks();
};

const handleTaskArchive = (id: string) => {
  handleTaskMove(id, "archived");
};

const handleTaskDuplicate = (id: string) => {
  const task = taskList.value.find((t) => t.id === id);
  if (!task) return;
  const dup = duplicateTask(task);
  taskList.value = [dup, ...taskList.value];
  schedulePersistTasks();
  message.success("已基于此再建");
};

const handleTaskDelete = (id: string) => {
  taskList.value = taskList.value.filter((t) => t.id !== id);
  if (openTaskId.value === id) closeTaskDrawer();
  schedulePersistTasks();
  message.success("任务已删除");
};

const currentTask = computed(() => taskList.value.find((t) => t.id === openTaskId.value) ?? null);

const handleCreateSessionForTask = (taskId: string) => {
  const task = taskList.value.find((t) => t.id === taskId);
  if (!task) return;
  const targetProject = task.projectPath ?? projectPath.value.trim() ?? "";
  if (targetProject) {
    projectPath.value = targetProject;
  }
  const newKey = `acp:${activeAgentId.value}:${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const newConversation: OpenChatConversation = {
    key: newKey,
    label: task.title.slice(0, 40) || "新对话",
    group: "今天",
    updatedAt: Date.now(),
    agentId: activeAgentId.value,
    // 与草稿落地（ensureActiveConversation / sendMessageNow）一致：ACP 代理下
    // currentModel 是残留的 API 模型，必须用 inputCurrentModel 记录真实模型。
    modelId: inputCurrentModel.value,
    messages: [],
    projectPath: targetProject,
  } as OpenChatConversation;
  conversationList.value.unshift(newConversation);
  try {
    taskList.value = updateTaskInList(taskList.value, taskId, {
      sessionKeys: [...task.sessionKeys, String(newKey)],
    });
  } catch {
    // ignore
  }
  schedulePersistTasks();
  schedulePersistState();
  boardOpenKey.value = String(newKey);
  currentConversationKey.value = String(newKey);
  // 新会话无消息：立即显示欢迎态，避免聊天区短暂空白看起来像没有切换
  showWelcome.value = true;
  // 同步 URL，避免停留在上一个会话的路径（刷新后会恢复到错误会话）。
  syncConversationRoute("push");
};

const handleOpenSessionFromTask = (sessionKey: string) => {
  boardOpenKey.value = sessionKey;
  if (sessionKey !== currentConversationKey.value) handleActiveChange(sessionKey);
};

const handleRetrySessionForTask = (taskId: string, _sessionKey: string) => {
  // 重试仅新建空会话，不自动发送，原会话内容由用户自行决定
  handleCreateSessionForTask(taskId);
};

const handleRemoveSessionLink = (taskId: string, sessionKey: string) => {
  const task = taskList.value.find((t) => t.id === taskId);
  if (!task) return;
  try {
    taskList.value = updateTaskInList(taskList.value, taskId, {
      sessionKeys: task.sessionKeys.filter((k) => k !== sessionKey),
    });
  } catch {
    return;
  }
  schedulePersistTasks();
  message.success("已移除关联");
};

// ============ 命令面板 / 设置 ============

const handleCommandPaletteSelectConversation = (key: string) => {
  handleActiveChange(key);
};

const openCommandPalette = () => {
  commandPaletteOpen.value = true;
};

// ============ 工作区上下文（下发到展示层） ============
// reactive 组装：ref / computed 在代理上访问即解包，模板里 `ws.x` 直接可读写。

const workspace = reactive({
  // 全局外观（dark / themeMode 是 props，脚本中须经由 getter 保持响应式）
  get dark() {
    return props.dark;
  },
  get themeMode() {
    return props.themeMode;
  },
  toggleTheme: () => emit("toggleTheme"),
  setThemeMode: (mode: "system" | "light" | "dark") => emit("themeModeChange", mode),

  // 当前会话
  content,
  currentConversationKey,
  currentConversationTitle,
  currentConversationMessages,
  bubbleItems,
  searchResultsByMessageId,
  showWelcome,
  currentConversationBusyState,
  isRequesting,
  inputRunning,
  inputUnavailable,
  currentQueuedMessages,
  currentQueuePaused,
  acpRunState,
  inputCurrentModel,
  inputCurrentModelLabel,
  inputModelCatalog,
  thinkingEnabled,
  workMode,
  effectivePermissionMode,
  isPiAgent,
  pendingPermission,
  fileModeEnabled,
  historyBack,
  historyForward,

  // 供应商 / 项目
  agents,
  activeAgentId,
  activeAgent,
  isAcpAgent,
  acpSessionLoading,
  projectPath,
  projectPathOptions,
  projectPathEnabled,

  // 会话与任务集合
  conversationList,
  visibleConversationList,
  taskList,
  openTaskId,
  currentTask,
  boardOpenKey,
  drawerWidth,
  taskNowTick,
  boardStatusSignals,

  // 浮层
  conversationsOpen,
  sidebarWidth,
  commandPaletteOpen,
  settingsOpen,
  taskCompletionNotificationsEnabled,
  browserNotificationsSupported,

  // 会话操作
  handleSidebarToggle,
  handleExportLocalHistory,
  handleClearLocalHistory,
  handleRenameConversation,
  handlePinConversation,
  handleArchiveConversation,
  handleDeleteConversation,
  confirmDeleteConversation,
  handleSidebarRename,
  handleNewConversation,
  handleActiveChange,
  handleAgentChange,
  handleCommandPaletteSelectConversation,
  openCommandPalette,
  closeBoardDrawer,

  // 消息输入 / 请求
  handleChange,
  handleCancel,
  handleSubmit,
  handleReloadMessage,
  handlePromptClick,
  handleQueuedMessageChange,
  handleQueuedMessageRemove,
  handleQueuedMessageClear,
  handleQueuedMessageSend,
  handleModelChange,
  handleThinkingChange,
  handleModeChange,
  handlePermissionChange,
  handlePermissionResponse,
  handleFileModeChange,
  handleProjectPathChange,
  handleProjectPathRemove,

  // 输入区业务数据（useComposerData）
  gitWorkspace: composerData.gitWorkspace,
  gitWorkspaceBusy: composerData.gitWorkspaceBusy,
  projectPathPicking: composerData.projectPathPicking,
  skills: composerData.skills,
  stagedAttachments: composerData.stagedAttachments,
  handlePickProjectPath: composerData.handlePickProjectPath,
  handleGitWorkspaceRefresh: composerData.handleGitWorkspaceRefresh,
  handleGitBranchSwitch: composerData.handleGitBranchSwitch,
  handleAttachmentsUpload: composerData.handleAttachmentsUpload,
  handleAttachmentsChange: composerData.handleAttachmentsChange,

  // 设置 / 通知
  handleTaskCompletionNotificationsChange,
  handleTestTaskCompletionNotification,

  // 任务看板
  handleTaskOpen,
  handleTaskMove,
  handleTaskCreate,
  handleTaskUpdateTitle,
  handleTaskUpdate,
  handleTaskArchive,
  handleTaskDuplicate,
  handleTaskDelete,
  handleCreateSessionForTask,
  handleOpenSessionFromTask,
  handleRetrySessionForTask,
  handleRemoveSessionLink,
  closeTaskDrawer,
  refreshTasksFromServer,
}) satisfies Workspace;

provideWorkspace(workspace);
</script>
<template>
  <div
    class="workspace-root chat-app relative flex h-screen min-h-[100dvh] flex-col overflow-hidden bg-brand-background text-brand-foreground selection:bg-brand-surface-subtle selection:text-brand-foreground"
  >
    <!-- 顶部布局切换：横线 hover 唤起居中 Segmented -->
    <TopTabBar v-model="viewMode" />

    <a class="skip-link" href="#chat-content">跳到消息内容</a>

    <div class="relative min-h-0 flex-1 overflow-hidden">
      <BoardPage v-if="viewMode === 'board'" />
      <ChatPage v-else id="chat-content" />
    </div>

    <!-- 全局浮层：两个页面共用 -->
    <CommandPalette
      :open="commandPaletteOpen"
      :conversation-list="visibleConversationList"
      :dark="dark"
      @update:open="commandPaletteOpen = $event"
      @new-conversation="handleNewConversation"
      @open-settings="settingsOpen = true"
      @toggle-theme="emit('toggleTheme')"
      @toggle-sidebar="handleSidebarToggle"
      @export-history="handleExportLocalHistory"
      @clear-history="handleClearLocalHistory"
      @select-conversation="handleCommandPaletteSelectConversation"
    />

    <SettingsDialog
      :open="settingsOpen"
      :dark="dark"
      :theme-mode="themeMode"
      :task-completion-notifications-enabled="taskCompletionNotificationsEnabled"
      :browser-notifications-supported="browserNotificationsSupported"
      @update:open="settingsOpen = $event"
      @theme-mode-change="emit('themeModeChange', $event)"
      @task-completion-notifications-change="handleTaskCompletionNotificationsChange"
      @test-task-completion-notification="handleTestTaskCompletionNotification"
      @export-history="handleExportLocalHistory"
      @clear-history="handleClearLocalHistory"
    />

    <!-- 删除会话二次确认 -->
    <DeleteConversationModal v-model:open="deleteOpen" @confirm="confirmDeleteConversation" />
  </div>
</template>

<style scoped>
:deep(.chat-markdown a) {
  color: var(--brand-accent);
}
</style>

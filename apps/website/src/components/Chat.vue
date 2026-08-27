<script setup lang="ts">
import { Notification as XNotification } from "@antdv-next/x";
import type { ConversationsProps } from "@antdv-next/x";
import type { DefaultMessageInfo } from "@antdv-next/x-sdk";
import type { XModelMessage, XModelResponse } from "@antdv-next/x-sdk";
import { XRequest, useXChat } from "@antdv-next/x-sdk";
import { Drawer, message } from "antdv-next";
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
  collectFileWorkspaceState,
  collectWorkspaceDiffStats,
  type EditableWorkspaceFile,
} from "../utils/fileWorkspace";
import { normalizeDirectoryPath, uniqueDirectoryPaths } from "../utils/projectPath";
import { FILE_WORKSPACE_SYSTEM_PROMPT } from "../prompts/fileWorkspace";
import { deriveBoardStatus, hasPersistedError, type SessionStatus } from "../utils/sessionStatus";
import { loadChatState, type QueuedChatMessage } from "../services/chatStorage";
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
  isHiddenModelMessage,
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
import BoardView from "./chat/BoardView.vue";
import TaskBoardView from "./chat/TaskBoardView.vue";
import TaskDetailDrawer from "./chat/TaskDetailDrawer.vue";
import ChatHeader from "./chat/ChatHeader.vue";
import ChatMessages from "./chat/ChatMessages.vue";
import ChatInput from "./chat/ChatInput.vue";
import RightPanel from "./chat/RightPanel.vue";
import CommandPalette from "./chat/CommandPalette.vue";
import SettingsDialog from "./chat/SettingsDialog.vue";
import DeleteConversationModal from "./chat/DeleteConversationModal.vue";
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

/**
 * The SDK normally preserves `optimisticId` on its local user row. Keep a
 * content fallback for the brief period where an SDK/store update omits that
 * metadata, otherwise both rows remain rendered for the whole request.
 */
const hasAcknowledgedOptimisticMessage = (
  source: DefaultMessageInfo<XModelMessage>[],
  pending: NonNullable<typeof optimisticMessage.value>,
): boolean => {
  if (
    source.some(
      (item) =>
        (item.extraInfo as { optimisticId?: unknown } | undefined)?.optimisticId === pending.id,
    )
  ) {
    return true;
  }

  const lastUserMessage = [...source].reverse().find((item) => item.message.role === "user");
  return (
    typeof lastUserMessage?.message.content === "string" &&
    typeof pending.message.content === "string" &&
    lastUserMessage.message.content === pending.message.content
  );
};

const conversationsOpen = ref(true);
/** 草稿会话在抽屉中的占位 key：不对应任何真实会话。 */
const DRAFT_BOARD_KEY = "__draft__";
/** 看板抽屉当前打开的会话；空串表示看板态（无聊天面板）。 */
const boardOpenKey = ref("");
/** 任务详情抽屉：打开的任务 id，空串表示未打开。 */
const openTaskId = ref("");
/** 任务列表（全局跨项目），与会话解耦。 */
const taskList = ref<Task[]>([]);
/** 任务持久化防抖句柄。 */
let persistTaskTimer: ReturnType<typeof setTimeout> | null = null;
const schedulePersistTasks = () => {
  if (isHydrating.value) return;
  if (persistTaskTimer) clearTimeout(persistTaskTimer);
  persistTaskTimer = setTimeout(() => {
    persistTaskTimer = null;
    void saveTasks(taskList.value);
  }, 300);
};
/** 看板抽屉宽度：桌面默认 1080，上限视口 92%；移动端由 CSS 全屏接管。 */
const DRAWER_WIDTH_DEFAULT = 1080;
const drawerWidth = ref(
  typeof window !== "undefined"
    ? Math.min(DRAWER_WIDTH_DEFAULT, Math.floor(window.innerWidth * 0.92))
    : DRAWER_WIDTH_DEFAULT,
);
/** 出错 / 手动停止后未恢复的会话：驱动「已终止」列。 */
const stoppedConversationKeys = ref<Set<string>>(new Set());
const boardStatusSignals = computed(
  () =>
    ({
      busyStates: conversationBusyStates.value,
      permissionKeys: new Set(
        pendingPermission.value
          ? [activeRequestConversationKey.value || currentConversationKey.value].filter(Boolean)
          : [],
      ),
      stoppedKeys: stoppedConversationKeys.value,
    }) satisfies import("../utils/sessionStatus").SessionStatusSignals,
);
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
/** 全局项目历史（与供应商/模型解耦）：不再按 agentId 分区 */
const projectPathHistory = ref<string[]>([]);
const selectedWorkspacePath = ref<string[]>([]);
const pendingSearchSources = ref<WebSearchSourceItem[] | null>(null);
const showWelcome = ref(true);
const isHydrating = ref(true);
let componentUnmounted = false;
const activeRequestConversationKey = ref<string>("");
/** 请求开始时间，供侧栏「工作中」条目计时 */
const requestStartedAt = ref(0);
let activeRequestOutcome: "pending" | "error" | "abort" | null = null;
let pendingChatError: string | null = null;
/**
 * Provider history often omits a transient turn.failed assistant message.
 * Keep the live message authoritative until the user explicitly acts.
 */
const failedHistoryRefreshLocks = new Set<string>();
const manuallyStoppedConversationKeys = new Set<string>();
let scheduleNextQueuedMessage: (conversationKey: string) => void = () => {};
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
const CHAT_AUTO_SCROLL_KEY = "open-chat-auto-scroll-mode-v1";
type AutoScrollMode = "follow" | "always" | "never";
const readAutoScrollMode = (): AutoScrollMode => {
  try {
    const stored = localStorage.getItem(CHAT_AUTO_SCROLL_KEY);
    if (stored === "follow" || stored === "always" || stored === "never") return stored;
    // 兼容旧的布尔值存储
    if (stored === "false" || stored === "0") return "never";
    if (stored === "true" || stored === "1") return "always";
  } catch {
    // ignore
  }
  return "follow";
};
const autoScrollMode = ref<AutoScrollMode>(readAutoScrollMode());
watch(autoScrollMode, (value) => {
  try {
    localStorage.setItem(CHAT_AUTO_SCROLL_KEY, value);
  } catch {
    // ignore
  }
});
const handleAutoScrollModeChange = (mode: AutoScrollMode) => {
  autoScrollMode.value = mode;
};
const TASK_COMPLETION_NOTIFICATIONS_KEY = "open-chat-task-completion-notifications";
const browserNotificationsSupported =
  typeof window !== "undefined" && typeof window.Notification !== "undefined";

const readTaskCompletionNotificationsEnabled = () => {
  if (!browserNotificationsSupported) return false;
  try {
    return (
      localStorage.getItem(TASK_COMPLETION_NOTIFICATIONS_KEY) === "true" &&
      XNotification.permission === "granted"
    );
  } catch {
    return false;
  }
};

const taskCompletionNotificationsEnabled = ref(readTaskCompletionNotificationsEnabled());

const persistTaskCompletionNotificationsEnabled = (enabled: boolean) => {
  try {
    localStorage.setItem(TASK_COMPLETION_NOTIFICATIONS_KEY, String(enabled));
  } catch {
    // Local storage may be unavailable in private browsing; keep the current session setting.
  }
};

const handleTaskCompletionNotificationsChange = async (enabled: boolean) => {
  if (!enabled) {
    taskCompletionNotificationsEnabled.value = false;
    persistTaskCompletionNotificationsEnabled(false);
    return;
  }

  if (!browserNotificationsSupported) {
    message.warning("当前浏览器不支持系统通知");
    return;
  }

  try {
    const permission = await XNotification.requestPermission();
    const granted = permission === "granted";
    taskCompletionNotificationsEnabled.value = granted;
    persistTaskCompletionNotificationsEnabled(granted);
    if (granted) {
      message.success("已开启任务完成通知");
    } else {
      message.warning("浏览器未允许通知，请在网站权限设置中开启");
    }
  } catch (error) {
    console.error("Failed to request browser notification permission:", error);
    taskCompletionNotificationsEnabled.value = false;
    persistTaskCompletionNotificationsEnabled(false);
    message.warning("无法请求浏览器通知权限");
  }
};

const handleTestTaskCompletionNotification = () => {
  if (
    !taskCompletionNotificationsEnabled.value ||
    !browserNotificationsSupported ||
    XNotification.permission !== "granted"
  ) {
    message.warning("请先开启任务完成通知并允许浏览器通知权限");
    return;
  }

  XNotification.open({
    title: "Open Chat · 测试通知",
    body: "如果你能看到这条系统通知，任务完成提醒已可以正常使用。",
    tag: "open-chat-task-completion-test",
    duration: 8,
    onClick: () => window.focus(),
  });
};
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

const normalizeProjectPath = (value: string | undefined): string => {
  const path = normalizeDirectoryPath(value);
  return path && path === normalizeDirectoryPath(defaultProjectPath.value) ? "" : path;
};

const loadProjectPathHistory = () => {
  if (typeof window === "undefined") return;
  try {
    const stored = JSON.parse(localStorage.getItem(PROJECT_PATH_HISTORY_KEY) || "null") as unknown;
    if (!stored) return;
    let paths: string[] = [];
    if (Array.isArray(stored)) {
      paths = stored.filter((v): v is string => typeof v === "string");
    } else if (typeof stored === "object") {
      // 兼容旧数据：Record<agentId, string[]> → 合并为全局列表
      for (const value of Object.values(stored as Record<string, unknown>)) {
        if (Array.isArray(value)) {
          paths.push(...value.filter((v): v is string => typeof v === "string"));
        }
      }
    }
    projectPathHistory.value = uniqueDirectoryPaths(paths.map(normalizeProjectPath)).slice(0, 20);
  } catch {
    projectPathHistory.value = [];
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

const rememberProjectPath = (value: string) => {
  const path = normalizeProjectPath(value);
  if (!path) return;
  const paths = uniqueDirectoryPaths([path, ...projectPathHistory.value]).slice(0, 20);
  projectPathHistory.value = paths;
  saveProjectPathHistory();
};

const forgetProjectPath = (value: string) => {
  const path = normalizeProjectPath(value);
  if (!path) return;
  projectPathHistory.value = projectPathHistory.value.filter((item) => item !== path);
  saveProjectPathHistory();
};

const projectPathOptions = computed(() => {
  const current = normalizeProjectPath(projectPath.value);
  return uniqueDirectoryPaths(
    current ? [current, ...projectPathHistory.value] : [...projectPathHistory.value],
  );
});

const lastProjectPath = () => {
  return projectPathHistory.value.map(normalizeProjectPath).find(Boolean) ?? "";
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

interface TaskCompletionNotice {
  key: string;
  agentId: string;
  conversationKey: string;
}

const showTaskCompletionNotification = (notice: TaskCompletionNotice) => {
  if (
    !taskCompletionNotificationsEnabled.value ||
    !browserNotificationsSupported ||
    XNotification.permission !== "granted"
  ) {
    return;
  }
  const conversation = conversationList.value.find(
    (item) =>
      (item.agentId || "api") === notice.agentId && String(item.key) === notice.conversationKey,
  );
  const conversationTitle = String(conversation?.label ?? "").trim();
  XNotification.open({
    title: "Open Chat · 任务已完成",
    body:
      conversationTitle && conversationTitle !== "新对话"
        ? `${conversationTitle} 已完成，可以查看结果。`
        : "Agent 任务已完成，可以查看结果。",
    tag: notice.key,
    duration: 8,
    onClick: () => window.focus(),
  });
};

const notifyTaskCompletion = (notice: TaskCompletionNotice) => {
  showTaskCompletionNotification(notice);
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
const currentFileWorkspace = computed(() =>
  collectFileWorkspaceState(
    currentConversationMessages.value.map(({ id, message }) => ({
      id,
      role: message.role,
      content: message.content,
      messages: Array.isArray((message as { fragments?: unknown }).fragments)
        ? ((message as { fragments: unknown }).fragments as TranscriptMessage[])
        : undefined,
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

const handleNewConversation = () => {
  // 看板主页：新任务直接以抽屉形态打开草稿会话
  boardOpenKey.value = DRAFT_BOARD_KEY;
  // 草稿态下重复点击只提示，不重复创建
  if (isInDraftMode.value) {
    showWelcome.value = true;
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
  const targetKey = String(key);
  const targetConversation = conversationList.value.find((item) => String(item.key) === targetKey);
  // 聚合侧栏：点击不同供应商的会话时，自动切换供应商与模型
  if (targetConversation?.agentId && targetConversation.agentId !== activeAgentId.value) {
    const targetAgent = agents.value.find((agent) => agent.id === targetConversation.agentId);
    if (targetAgent) {
      if (isRequesting.value) {
        message.warning("请先停止当前任务再切换会话");
        return;
      }
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
  if (isRequesting.value) {
    message.warning("请先停止当前 Agent 任务再切换供应商");
    return;
  }
  const next = agents.value.find((agent) => agent.id === agentId);
  if (!next) return;
  resetPermissionForAgentSwitch();
  draftConversationKey.value = "";
  acpSession.value = null;
  // 项目与供应商解耦：切换供应商不重置项目目录，保留当前选择供新会话复用
  activeAgentId.value = next.id;
  localStorage.setItem("open-chat-agent", next.id);
  currentConversationKey.value = "";
  setMessages([]);
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
provider.onChatError = (message: string) => {
  pendingChatError = typeof message === "string" && message.trim() ? message.trim() : "请求失败";
  if (activeRequestOutcome === "pending") activeRequestOutcome = "error";
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
      activeRequestOutcome = "abort";
      pendingChatError = "请求已中止";
      const existing =
        typeof messageInfo?.message?.content === "string" ? messageInfo.message.content : "";
      return {
        content: existing && existing !== WEB_SEARCHING_MARKER ? existing : "请求已中止",
        role: "assistant",
      };
    }
    activeRequestOutcome = "error";
    pendingChatError =
      (typeof errorInfo?.error?.message === "string" && errorInfo.error.message.trim()) ||
      (error instanceof Error && error.message.trim()) ||
      "请求失败，请重试！";
    return {
      content: errorInfo?.error?.message || "请求失败，请重试！",
      role: "assistant",
    };
  },
  // Keep a visible assistant row mounted while the gateway is preparing the
  // first event, so the outgoing message transitions directly into feedback.
  requestPlaceholder: () => ({ content: "", role: "assistant" }),
});

/** 当前会话正在生成；输入仍可提交，但新消息会进入队列。 */
const inputRunning = computed(
  () =>
    isRequesting.value ||
    (activeRequestOutcome === "pending" &&
      Boolean(activeRequestConversationKey.value) &&
      activeRequestConversationKey.value === currentConversationKey.value) ||
    Boolean(currentOpenChatRun.value) ||
    (usesAcpProtocol.value && acpRunState.value?.state === "running"),
);
/** 初始化期间无法可靠确定目标会话，此时才真正禁用输入。后台 sessions 轮询不能影响输入焦点。 */
const inputUnavailable = computed(() => isAcpAgent.value && isHydrating.value);
const inputBusy = computed(() => inputUnavailable.value || inputRunning.value);

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

/** 当前会话的运行起点；聊天区与侧栏共用这一份服务端时间。 */
const currentConversationBusyState = computed(() =>
  currentConversationKey.value
    ? conversationBusyStates.value[currentConversationKey.value]
    : undefined,
);
/** 共享计时 tick：驱动任务卡片/抽屉内会话的耗时显示 */
const taskNowTick = ref(Date.now());
let taskTickTimer: ReturnType<typeof setInterval> | undefined;
const stopTaskTick = () => {
  if (taskTickTimer) clearInterval(taskTickTimer);
  taskTickTimer = undefined;
};
const startTaskTick = (periodMs: number) => {
  stopTaskTick();
  taskTickTimer = setInterval(() => (taskNowTick.value = Date.now()), periodMs);
};
const hasTaskBusy = computed(() => Object.keys(conversationBusyStates.value).length > 0);
watch(hasTaskBusy, (busy) => startTaskTick(busy ? 1000 : 30000), { immediate: true });
onBeforeUnmount(stopTaskTick);

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

/**
/**
 * 仅用于已存在于本地 IndexedDB 的会话做标题/路径等元数据补齐。
 * 不再为仅存在于供应商侧的外部会话创建新的侧栏条目——侧栏只展示 open chat 本地发起的 sessions。
 */
const syncProviderConversations = async (agentId: string): Promise<void> => {
  const agent = agents.value.find((item) => item.id === agentId);
  if (!agent || agent.kind !== "acp" || !agent.available) return;
  try {
    const result = await loadAcpProviderSessions(agentId);
    if (agentId !== activeAgentId.value) return;
    if (!result.supported) return;
    let changed = false;
    for (const providerSession of result.sessions) {
      const existing = conversationList.value.find(
        (item) => item.agentId === agentId && item.providerSessionId === providerSession.sessionId,
      );
      if (!existing) continue;
      const updatedAt = providerSession.updatedAt
        ? Date.parse(providerSession.updatedAt)
        : Number.NaN;
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
        if (
          existing.agentId === activeAgentId.value &&
          String(existing.key) === currentConversationKey.value &&
          !isRequesting.value &&
          !isHydrating.value &&
          !acpStreamController.value
        ) {
          void refreshAcpSession();
        }
      }
    }
    if (changed) schedulePersistState();
  } catch (error) {
    console.error(`Failed to load ${agentId} provider sessions:`, error);
  }
};

let sessionRefreshController: AbortController | null = null;
let sessionRefreshSequence = 0;
let sessionRefreshFrame: number | null = null;
let sessionRefreshInFlight = false;
let sessionRefreshGeneration = 0;

const SESSION_REFRESH_RUNNING_MS = 2_000;
const SESSION_REFRESH_IDLE_MS = 5_000;

const stopSessionRefresh = () => {
  sessionRefreshGeneration += 1;
  if (sessionRefreshFrame !== null) {
    window.cancelAnimationFrame(sessionRefreshFrame);
    sessionRefreshFrame = null;
  }
  sessionRefreshController?.abort();
  sessionRefreshController = null;
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
    if (!existing) {
      // 只维护本地已存在的会话，不为外部运行中的会话自动创建侧栏条目
      continue;
    }
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
  }
  if (changed) schedulePersistState();
};

const refreshSessionState = async () => {
  if (componentUnmounted || isHydrating.value || document.visibilityState === "hidden") return;
  if (sessionRefreshInFlight) return;
  sessionRefreshInFlight = true;
  const agent = activeAgent.value;
  if (agent.kind !== "acp" || !agent.available) {
    openChatSessions.value = [];
    sessionRefreshInFlight = false;
    return;
  }

  const sequence = ++sessionRefreshSequence;
  const agentId = agent.id;
  const controller = new AbortController();
  sessionRefreshController = controller;
  try {
    // 本地聚合模式：不再周期性全量拉取供应商会话，仅刷新运行状态（openChatSessions）。
    // 供应商元数据同步（syncProviderConversations）仅在需要时手动触发，避免侧栏全量拉取。
    const previouslyRunning = openChatSessions.value.filter(
      (session) => session.agentId === agentId && session.running,
    );
    const openChatResult = await loadOpenChatSessions(agentId, controller.signal)
      .then((sessions) => ({ status: "fulfilled" as const, value: sessions }))
      .catch((reason: unknown) => ({ status: "rejected" as const, reason }));
    if (sequence !== sessionRefreshSequence || agentId !== activeAgentId.value) return;

    if (openChatResult.status === "fulfilled") {
      const sessions = openChatResult.value;
      openChatSessions.value = sessions;
      reconcileRunningConversations(sessions);
      const completedRuns = previouslyRunning.filter(
        (previous) =>
          !sessions.some(
            (session) =>
              session.running &&
              session.agentId === previous.agentId &&
              session.conversationId === previous.conversationId,
          ),
      );
      for (const previous of completedRuns) {
        notifyTaskCompletion({
          key: `task:${previous.agentId}:${previous.conversationId}:${previous.startedAt ?? previous.createdAt}`,
          agentId: previous.agentId,
          conversationKey: previous.conversationId,
        });
      }
      const selectedConversation = getCurrentConversation();
      if (
        selectedConversation &&
        completedRuns.some((session) => sessionMatchesConversation(session, selectedConversation))
      ) {
        void refreshAcpSession();
      }
      const selectedRun = selectedConversation
        ? sessions.find(
            (session) =>
              session.running && sessionMatchesConversation(session, selectedConversation),
          )
        : undefined;
      if (!isRequesting.value) {
        acpRunState.value = selectedRun ? { state: "running" } : null;
        // The SSE replay is the fast path. If it is unavailable (for example
        // after a transient disconnect), pull the collector-backed history on
        // the next refresh so the visible conversation still advances.
        if (selectedRun && !acpStreamController.value) {
          void refreshAcpSession();
        }
      }
    } else if ((openChatResult.reason as Error)?.name !== "AbortError") {
      console.error("Failed to refresh Open Chat session state:", openChatResult.reason);
    }
  } catch (error) {
    console.error("Failed to refresh session state:", error);
  } finally {
    if (sequence === sessionRefreshSequence) {
      sessionRefreshController = null;
    }
    sessionRefreshInFlight = false;
    if (
      !componentUnmounted &&
      sequence === sessionRefreshSequence &&
      document.visibilityState !== "hidden"
    ) {
      const hasRunningSession = openChatSessions.value.some((session) => session.running);
      scheduleSessionRefresh(
        hasRunningSession || isRequesting.value
          ? SESSION_REFRESH_RUNNING_MS
          : SESSION_REFRESH_IDLE_MS,
      );
    }
  }
};

const scheduleSessionRefresh = (delayMs = 0) => {
  if (
    componentUnmounted ||
    sessionRefreshFrame !== null ||
    isHydrating.value ||
    document.visibilityState === "hidden"
  ) {
    return;
  }
  const generation = sessionRefreshGeneration;
  const dueAt = performance.now() + Math.max(0, delayMs);
  const tick = (now: number) => {
    if (
      generation !== sessionRefreshGeneration ||
      componentUnmounted ||
      isHydrating.value ||
      document.visibilityState === "hidden"
    ) {
      sessionRefreshFrame = null;
      return;
    }
    if (now < dueAt) {
      sessionRefreshFrame = window.requestAnimationFrame(tick);
      return;
    }
    sessionRefreshFrame = null;
    if (sessionRefreshInFlight) {
      scheduleSessionRefresh(100);
      return;
    }
    void refreshSessionState();
  };
  sessionRefreshFrame = window.requestAnimationFrame(tick);
};

const restartSessionRefresh = () => {
  stopSessionRefresh();
  sessionRefreshSequence += 1;
  if (!componentUnmounted && !isHydrating.value && document.visibilityState !== "hidden") {
    scheduleSessionRefresh();
  }
};

const handleVisibilityChange = () => {
  if (document.visibilityState === "hidden") {
    stopSessionRefresh();
    stopAcpLiveStream();
    return;
  }
  restartSessionRefresh();
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

const setConversationLastError = (conversationKey: string, errorMessage: string) => {
  const conv = conversationList.value.find((item) => String(item.key) === conversationKey);
  if (!conv) return;
  conv.lastError = errorMessage.trim() ? errorMessage.trim().slice(0, 2000) : "请求失败";
  if (conv.statusOverride) conv.statusOverride = "";
  // 确保抽屉打开时能看到与聊天一致的红色错误条：给最后一条 assistant 消息补 chatError
  if (conv.messages?.length) {
    const lastAssistant = [...conv.messages]
      .reverse()
      .find((item) => item.message.role === "assistant");
    if (lastAssistant) {
      const msg = lastAssistant.message as unknown as Record<string, unknown>;
      const extra = (lastAssistant.extraInfo as Record<string, unknown> | undefined) ?? {};
      if (typeof msg.chatError !== "string" || !msg.chatError) {
        msg.chatError = conv.lastError;
      }
      if (typeof extra.chatError !== "string" || !extra.chatError) {
        lastAssistant.extraInfo = { ...extra, chatError: conv.lastError };
      }
    }
  }
  conv.updatedAt = Date.now();
  schedulePersistState();
};
const clearConversationLastError = (conversationKey: string) => {
  const conv = conversationList.value.find((item) => String(item.key) === conversationKey);
  if (!conv) return;
  const hadError = Boolean(conv.lastError);
  if ("lastError" in conv) delete conv.lastError;
  // 同步清理最后一条 assistant 消息上的 chatError，避免历史错误导致 hasPersistedError 误判
  if (conv.messages?.length) {
    const lastAssistant = [...conv.messages].reverse().find((item) => {
      if (!item || typeof item !== "object" || !("message" in item)) return false;
      const message = item.message;
      if (!message || typeof message !== "object" || !("role" in message)) return false;
      const role = message.role;
      return role === "assistant";
    });
    if (lastAssistant && typeof lastAssistant === "object") {
      let changed = false;
      if ("message" in lastAssistant) {
        const message = lastAssistant.message;
        if (message && typeof message === "object" && "chatError" in message) {
          const chatError = message.chatError;
          if (typeof chatError === "string" && chatError.trim()) {
            delete (message as Record<string, unknown>).chatError;
            changed = true;
          }
        }
      }
      if ("extraInfo" in lastAssistant) {
        const extraInfo = lastAssistant.extraInfo;
        if (extraInfo && typeof extraInfo === "object" && "chatError" in extraInfo) {
          const chatError = extraInfo.chatError;
          if (typeof chatError === "string" && chatError.trim()) {
            const nextExtra = { ...(extraInfo as Record<string, unknown>) };
            delete nextExtra.chatError;
            lastAssistant.extraInfo = Object.keys(nextExtra).length
              ? (nextExtra as never)
              : undefined;
            changed = true;
          }
        }
      }
      if (hadError || changed) schedulePersistState();
      return;
    }
  }
  if (hadError) schedulePersistState();
};

const getConversationErrorMessage = (key: string): string => {
  if (pendingChatError && String(activeRequestConversationKey.value) === key)
    return pendingChatError;
  const conv = conversationList.value.find((item) => String(item.key) === key);
  if (conv?.messages?.length) {
    const lastAssistant = [...conv.messages]
      .reverse()
      .find((item) => item.message.role === "assistant");
    if (lastAssistant) {
      const msg = lastAssistant.message as unknown as { chatError?: unknown; content?: unknown };
      if (typeof msg.chatError === "string" && msg.chatError.trim()) return msg.chatError.trim();
      const extraInfo = lastAssistant.extraInfo as { chatError?: unknown } | undefined;
      if (extraInfo && typeof extraInfo.chatError === "string" && extraInfo.chatError.trim()) {
        return extraInfo.chatError.trim();
      }
      if (typeof msg.content === "string" && msg.content.trim()) {
        const text = msg.content.trim();
        if (text !== WEB_SEARCHING_MARKER && text.length > 0) return text.slice(0, 2000);
      }
    }
  }
  return pendingChatError || "请求失败";
};

watch(isRequesting, (requesting) => {
  if (requesting) {
    requestStartedAt.value = Date.now();
    acpRunState.value = isAcpAgent.value ? { state: "running" } : null;
    if (isAcpAgent.value) restartSessionRefresh();
    return;
  }
  const completedConversationKey = activeRequestConversationKey.value;
  const completedRequestStartedAt = requestStartedAt.value;
  const completedOutcome = activeRequestOutcome;
  const manuallyStopped = completedConversationKey
    ? manuallyStoppedConversationKeys.delete(completedConversationKey)
    : false;
  if (completedConversationKey) {
    if (completedOutcome === "error") {
      failedHistoryRefreshLocks.add(completedConversationKey);
      const errorText = getConversationErrorMessage(completedConversationKey);
      setConversationLastError(completedConversationKey, errorText);
    } else if (completedOutcome === "abort" || manuallyStopped) {
      failedHistoryRefreshLocks.delete(completedConversationKey);
      const abortText =
        pendingChatError && pendingChatError !== "请求已中止" ? pendingChatError : "已手动停止";
      setConversationLastError(completedConversationKey, abortText);
    } else if (completedOutcome === "pending") {
      failedHistoryRefreshLocks.delete(completedConversationKey);
      clearConversationLastError(completedConversationKey);
    }
  }
  if (completedConversationKey) {
    // The request SSE closing is authoritative. Clear the cached state result
    // before the live-stream watcher runs, otherwise it can subscribe to a run
    // that the server has just removed and produce a transient 404.
    markConversationRunIdle(completedConversationKey);
  }
  attachPendingSearchSources();
  activeRequestConversationKey.value = "";
  pendingPermission.value = null;
  requestStartedAt.value = 0;
  // 请求结束：会话必然回到空闲，清掉过期的 ACP 运行状态
  acpRunState.value = null;
  if (completedOutcome === "pending" && !manuallyStopped && completedConversationKey) {
    notifyTaskCompletion({
      key: `task:${activeAgentId.value}:${completedConversationKey}:${completedRequestStartedAt}`,
      agentId: activeAgentId.value,
      conversationKey: completedConversationKey,
    });
  }
  activeRequestOutcome = null;
  pendingChatError = null;
  if (completedConversationKey) {
    const conversation = conversationList.value.find(
      (item) => String(item.key) === completedConversationKey,
    );
    if (conversation?.queuedMessages?.length) {
      conversation.queuePaused = manuallyStopped || completedOutcome !== "pending";
      schedulePersistState();
      if (!manuallyStopped && completedOutcome === "pending") {
        scheduleNextQueuedMessage(completedConversationKey);
      }
    } else if (conversation?.queuePaused) {
      conversation.queuePaused = false;
      schedulePersistState();
    }
  }
  if (isAcpAgent.value) restartSessionRefresh();
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
  // The UI key can be a provider-session-derived key after a page refresh.
  // The live-run registry is indexed by its gateway conversation id, so use
  // the matched run id for the subscription while keeping the UI key for
  // message updates and queue state.
  const streamConversationId = selectedRun?.conversationId || conversationId;
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
      // End the cached run before refreshing. Otherwise a 204 caused by the
      // run finishing between refresh and subscribe immediately reopens the same
      // stream and creates a tight request loop.
      markConversationRunIdle(conversationId);
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
          key: `task:${activeAgentId.value}:${conversationId}:${selectedRun?.startedAt ?? Date.now()}`,
          agentId: activeAgentId.value,
          conversationKey: conversationId,
        });
      } else if (conversation.queuedMessages?.length) {
        conversation.queuePaused = true;
        schedulePersistState();
      }
      restartSessionRefresh();
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

watch([activeAgentId, currentConversationKey, isHydrating], ([, key], [, previousKey]) => {
  // Selecting another conversation is an explicit user/navigation action, so
  // its provider history may become authoritative again.
  if (key && key !== previousKey) failedHistoryRefreshLocks.delete(key);
  void refreshAcpSession();
});

watch(activeAgentId, () => {
  restartSessionRefresh();
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
    const pending = optimisticMessage.value;
    if (
      pending &&
      pending.conversationKey === conversationWriteKey &&
      hasAcknowledgedOptimisticMessage(newMessages, pending)
    ) {
      optimisticMessage.value = null;
    }
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
  componentUnmounted = false;
  window.addEventListener("keydown", handleWorkspaceKeydown);
  window.addEventListener("popstate", handleRoutePopState);
  document.addEventListener("visibilitychange", handleVisibilityChange);
  if (window.matchMedia("(max-width: 767px)").matches) {
    conversationsOpen.value = false;
    rightPanelOpen.value = false;
  }
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
  // Release session/config watchers only after the final route conversation
  // is known. Releasing earlier creates a throwaway draft session request.
  isHydrating.value = false;
  restartSessionRefresh();
});

onBeforeUnmount(() => {
  componentUnmounted = true;
  window.removeEventListener("keydown", handleWorkspaceKeydown);
  window.removeEventListener("popstate", handleRoutePopState);
  document.removeEventListener("visibilitychange", handleVisibilityChange);
  window.removeEventListener("mousemove", handleResizeMove);
  window.removeEventListener("mouseup", handleResizeEnd);
  stopSessionRefresh();
  stopAcpLiveStream();
  if (queuedMessageTimer) clearTimeout(queuedMessageTimer);
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

  /** 刷新后服务端仍在运行，但本地消息快照可能暂时没有 assistant 气泡。 */
  const withRunningPlaceholder = (items: ReturnType<typeof modelMessagesToBubbleItems>) => {
    if (!currentConversationBusyState.value) return items;
    if (
      items.some(
        (item) =>
          item.role === "assistant" && (item.status === "loading" || item.status === "updating"),
      )
    ) {
      return items;
    }
    return [
      ...items,
      {
        key: `${currentConversationKey.value}:running`,
        role: "assistant" as const,
        status: "updating" as const,
        loading: false,
        content: "",
        extraInfo: {},
      },
    ];
  };

  if (!pending || pending.conversationKey !== currentConversationKey.value) {
    return withRunningPlaceholder(baseItems);
  }

  // Once useXChat has emitted the local user item, only retire that optimistic
  // row. The assistant fallback must stay until the SDK publishes its own
  // loading/updating item, otherwise the request has a visible feedback gap.
  const storeHasPendingMessage = hasAcknowledgedOptimisticMessage(conversationMessages, pending);

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
  const optimisticItems = storeHasPendingMessage
    ? [...conversationMessages]
    : [...conversationMessages, pendingInfo];
  // Keep the transition visually continuous even while the request store is
  // waiting to publish its placeholder row.
  if (
    isRequesting.value &&
    activeRequestConversationKey.value === currentConversationKey.value &&
    !hasStreamingAssistant
  ) {
    optimisticItems.push({
      id: `${pending.id}:thinking`,
      // Render through AssistantMessageContent so the waiting phase uses the
      // same "工作中" indicator as the subsequent streamed response.
      status: "updating",
      message: { role: "assistant", content: "" },
    });
  }
  return withRunningPlaceholder(modelMessagesToBubbleItems(optimisticItems));
});

// ============ 事件处理 ============

const handlePromptClick = (info: { data: { key?: string; description?: string } }) => {
  const prompt = typeof info.data.description === "string" ? info.data.description : "";
  if (inputBusy.value || !prompt) return;

  showWelcome.value = false;
  handleSubmit(prompt);
};

const handleCancel = () => {
  activeRequestOutcome = "abort";
  const conversationId = activeRequestConversationKey.value || currentConversationKey.value;
  if (conversationId) manuallyStoppedConversationKeys.add(conversationId);
  const conversation = conversationList.value.find((item) => String(item.key) === conversationId);
  if (conversation?.queuedMessages?.length) {
    conversation.queuePaused = true;
    schedulePersistState();
  }
  // ACP：断连不再自动取消回合，停止必须先调服务端取消接口
  if (isAcpAgent.value) {
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

  return composedPrompt;
};

interface SubmitMessageOptions {
  extraInfo?: Record<string, unknown>;
  systemPrompt?: string;
  /** 随消息发送的附件（已上传到网关，携带持久引用）。 */
  attachments?: UploadedAttachment[];
  goal?: string;
  instruction?: string;
}

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

const sendMessageNow = (
  nextContent: string,
  options: SubmitMessageOptions = {},
  clearComposer = true,
): boolean => {
  if ((!nextContent || !nextContent.trim()) && !options.attachments?.length) return false;
  if (inputUnavailable.value || inputRunning.value) return false;
  if (!activeAgent.value.available) {
    message.warning(
      activeAgent.value.adapterHint ||
        `${activeAgent.value.name} 当前不可用，请检查本地 CLI 安装与登录状态`,
    );
    return false;
  }

  // 草稿态首次发送时，才创建真实会话并写入侧栏
  const conversation = ensureActiveConversation(options.systemPrompt ?? "");
  if (!conversation) return false;
  failedHistoryRefreshLocks.delete(String(conversation.key));
  // 再次发送视为对错误/停止的显式恢复：清掉已终止标记与旧拖拽覆盖
  const hadError = Boolean(conversation.lastError);
  const hadOverride = Boolean(conversation.statusOverride);
  if (conversation.lastError) delete conversation.lastError;
  if (conversation.statusOverride) conversation.statusOverride = "";
  pendingChatError = null;
  if (hadError || hadOverride) schedulePersistState();
  if (options.systemPrompt !== undefined) {
    conversation.systemPrompt = options.systemPrompt.trim();
  }
  // 只有真正提交新消息才改变会话排序；读取、恢复和实时回放保持原顺序。
  conversation.updatedAt = Date.now();
  // 记录会话创建/最后使用的供应商与模型，供聚合侧栏点击时恢复
  conversation.agentId = activeAgentId.value;
  conversation.modelId = inputCurrentModel.value;
  manuallyStoppedConversationKeys.delete(String(conversation.key));
  activeRequestOutcome = "pending";
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
  try {
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
        ...(options.goal ? { goal: options.goal } : {}),
        ...(options.instruction ? { instruction: options.instruction } : {}),
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
  } catch (error) {
    activeRequestOutcome = null;
    activeRequestConversationKey.value = "";
    optimisticMessage.value = null;
    message.error(error instanceof Error ? error.message : "请求启动失败");
    return false;
  }
  if (clearComposer) {
    setTimeout(() => {
      content.value = "";
    }, 0);
  }
  return true;
};

let queuedMessageTimer: ReturnType<typeof setTimeout> | null = null;
let queuedMessageTimerKey = "";

const dispatchNextQueuedMessage = (conversationKey: string) => {
  if (
    conversationKey !== currentConversationKey.value ||
    inputUnavailable.value ||
    inputRunning.value
  ) {
    return;
  }
  const conversation = getCurrentConversation();
  const queuedMessage = conversation?.queuedMessages?.[0];
  if (!conversation || conversation.queuePaused || !queuedMessage) return;

  conversation.queuedMessages = conversation.queuedMessages?.slice(1) ?? [];
  conversation.queuePaused = false;
  schedulePersistState();
  const started = sendMessageNow(
    queuedMessage.content,
    { attachments: queuedMessage.attachments },
    false,
  );
  if (!started) {
    conversation.queuedMessages = [queuedMessage, ...(conversation.queuedMessages ?? [])];
    conversation.queuePaused = true;
    schedulePersistState();
  }
};

scheduleNextQueuedMessage = (conversationKey: string) => {
  if (!conversationKey || conversationKey !== currentConversationKey.value) return;
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
  if (inputRunning.value || conversation?.queuedMessages?.length) {
    if (!conversation) {
      conversation = ensureActiveConversation(options.systemPrompt ?? "");
      if (!conversation) return;
    }
    queueMessage(conversation, nextContent, options.attachments);
    if (!inputRunning.value && !conversation.queuePaused) {
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
    failedHistoryRefreshLocks.delete(String(conversation.key));
  }
  void refreshAcpSession(true);
};

const handleProjectPathRemove = (value: string) => {
  if (isRequesting.value) {
    message.warning("请先停止当前任务再删除项目目录");
    return;
  }
  const removedPath = normalizeProjectPath(value);
  if (!removedPath) return;
  forgetProjectPath(removedPath);
  if (normalizeProjectPath(projectPath.value) === removedPath) handleProjectPathChange("");
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
  if (currentConversation) {
    failedHistoryRefreshLocks.delete(String(currentConversation.key));
    if (currentConversation.lastError) delete currentConversation.lastError;
    if (currentConversation.statusOverride) currentConversation.statusOverride = "";
    pendingChatError = null;
    schedulePersistState();
  }
  activeRequestConversationKey.value = currentConversationKey.value;
  const baseSystemPrompt = currentConversation?.systemPrompt ?? "";
  const forwardProvider = getForwardProvider(currentModel.value);
  activeRequestOutcome = "pending";
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

const handleDeleteConversation = (conversationKey: string = currentConversationKey.value) => {
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
  if (isRequesting.value && key !== currentConversationKey.value) {
    message.warning("请先停止当前任务再打开其他会话");
    return;
  }
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
    agentId: activeAgentId.value,
    modelId: currentModel.value,
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
};

const handleOpenSessionFromTask = (sessionKey: string) => {
  if (isRequesting.value && sessionKey !== currentConversationKey.value) {
    message.warning("请先停止当前任务再打开其他会话");
    return;
  }
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
            :dark="dark"
            :agents="agents"
            :active-agent-id="activeAgentId"
            @toggle-sidebar="handleSidebarToggle"
            @toggle-theme="emit('toggleTheme')"
            @new-conversation="handleNewConversation"
            @open-search="commandPaletteOpen = true"
            @open-settings="settingsOpen = true"
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

    <div class="chat-main flex min-w-0 flex-1 flex-col overflow-hidden bg-brand-workspace">
      <TaskBoardView
        :tasks="taskList"
        :conversation-list="conversationList"
        :open-task-id="openTaskId"
        :status-signals="boardStatusSignals"
        :agents="agents"
        :project-path-options="projectPathOptions"
        :current-project-path="projectPath"
        @open-task="handleTaskOpen"
        @move-task="handleTaskMove"
        @create-task="handleTaskCreate"
        @update-task-title="handleTaskUpdateTitle"
        @archive-task="handleTaskArchive"
        @duplicate-task="handleTaskDuplicate"
        @delete-task="handleTaskDelete"
      />
    </div>
    <!-- 任务抽屉：split 模式 左任务｜右对话（新建/打开会话同屉） -->
    <TaskDetailDrawer
      :open="Boolean(openTaskId)"
      :task="currentTask"
      :conversation-list="conversationList"
      :status-signals="boardStatusSignals"
      :now-tick="taskNowTick"
      :split="true"
      :active-session-key="boardOpenKey"
      :project-path-options="projectPathOptions"
      @close="closeTaskDrawer"
      @update-task="handleTaskUpdate"
      @create-session="handleCreateSessionForTask"
      @open-session="handleOpenSessionFromTask"
      @retry-session="handleRetrySessionForTask"
      @remove-session-link="handleRemoveSessionLink"
    >
      <template #chat>
        <template v-if="boardOpenKey">
          <div class="flex h-full min-h-0 flex-col overflow-hidden">
            <ChatHeader
              :sidebar-open="conversationsOpen"
              :right-panel-open="rightPanelOpen"
              :right-panel-available="workspaceAvailable"
              :syncing="isRequesting"
              :can-go-back="historyBack.length > 0"
              :can-go-forward="historyForward.length > 0"
              :diff-added="workspaceDiffStats.added"
              :diff-removed="workspaceDiffStats.removed"
              :show-close="true"
              @toggle-sidebar="handleSidebarToggle"
              @toggle-right-panel="rightPanelOpen = !rightPanelOpen"
              @export="handleExportLocalHistory"
              @rename="handleRenameConversation"
              @pin="handlePinConversation"
              @archive="handleBoardArchiveConversation(currentConversationKey)"
              @delete="handleBoardDeleteConversation(currentConversationKey)"
              @close="closeBoardDrawer"
            />
            <div class="relative min-h-0 flex-1 overflow-hidden">
              <ChatMessages
                :show-welcome="
                  showWelcome &&
                  currentConversationMessages.length === 0 &&
                  !currentConversationBusyState
                "
                :bubble-items="bubbleItems"
                :dark="dark"
                :conversation-key="currentConversationKey"
                :search-results-by-message-id="searchResultsByMessageId"
                :working="Boolean(currentConversationBusyState)"
                :working-started-at-ms="currentConversationBusyState?.startedAt"
                :auto-scroll-mode="autoScrollMode"
                :project-path="projectPath"
                :project-path-options="projectPathOptions"
                @reload="handleReloadMessage"
                @prompt-click="handlePromptClick"
                @project-path-change="handleProjectPathChange"
                @project-path-remove="handleProjectPathRemove"
              />
            </div>
            <ChatInput
              v-model="content"
              :loading="inputRunning"
              :disabled="inputUnavailable"
              :queued-messages="currentQueuedMessages"
              :queue-paused="currentQueuePaused"
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
              :is-oh-my-pi="isPiAgent"
              @change="handleChange"
              @cancel="handleCancel"
              @submit="handleSubmit"
              @queued-message-change="handleQueuedMessageChange"
              @queued-message-remove="handleQueuedMessageRemove"
              @queued-message-clear="handleQueuedMessageClear"
              @queued-message-send="handleQueuedMessageSend"
              @model-change="handleModelChange"
              @thinking-change="handleThinkingChange"
              @mode-change="handleModeChange"
              @permission-change="handlePermissionChange"
              @permission-response="handlePermissionResponse"
              @file-mode-change="handleFileModeChange"
              @project-path-change="handleProjectPathChange"
              @project-path-remove="handleProjectPathRemove"
            />
          </div>
        </template>
      </template>
    </TaskDetailDrawer>

    <!-- 会话抽屉：仅当未打开任务时（侧栏直接打开会话） -->
    <Drawer
      v-if="!openTaskId"
      class="board-drawer"
      :open="Boolean(boardOpenKey)"
      placement="right"
      :width="drawerWidth"
      :keyboard="false"
      :body-style="{ padding: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }"
      :header-style="{ display: 'none' }"
      destroy-on-close
      @close="closeBoardDrawer"
    >
      <template v-if="boardOpenKey">
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
          :show-close="true"
          @toggle-sidebar="handleSidebarToggle"
          @toggle-right-panel="rightPanelOpen = !rightPanelOpen"
          @export="handleExportLocalHistory"
          @rename="handleRenameConversation"
          @pin="handlePinConversation"
          @archive="handleBoardArchiveConversation(currentConversationKey)"
          @delete="handleBoardDeleteConversation(currentConversationKey)"
          @close="closeBoardDrawer"
        />
        <div class="relative min-h-0 flex-1 overflow-hidden">
          <ChatMessages
            :show-welcome="
              showWelcome &&
              currentConversationMessages.length === 0 &&
              !currentConversationBusyState
            "
            :bubble-items="bubbleItems"
            :dark="dark"
            :conversation-key="currentConversationKey"
            :search-results-by-message-id="searchResultsByMessageId"
            :working="Boolean(currentConversationBusyState)"
            :working-started-at-ms="currentConversationBusyState?.startedAt"
            :auto-scroll-mode="autoScrollMode"
            :project-path="projectPath"
            :project-path-options="projectPathOptions"
            @reload="handleReloadMessage"
            @prompt-click="handlePromptClick"
            @project-path-change="handleProjectPathChange"
            @project-path-remove="handleProjectPathRemove"
          />
        </div>
        <ChatInput
          v-model="content"
          :loading="inputRunning"
          :disabled="inputUnavailable"
          :queued-messages="currentQueuedMessages"
          :queue-paused="currentQueuePaused"
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
          :is-oh-my-pi="isPiAgent"
          @change="handleChange"
          @cancel="handleCancel"
          @submit="handleSubmit"
          @queued-message-change="handleQueuedMessageChange"
          @queued-message-remove="handleQueuedMessageRemove"
          @queued-message-clear="handleQueuedMessageClear"
          @queued-message-send="handleQueuedMessageSend"
          @model-change="handleModelChange"
          @thinking-change="handleThinkingChange"
          @mode-change="handleModeChange"
          @permission-change="handlePermissionChange"
          @permission-response="handlePermissionResponse"
          @file-mode-change="handleFileModeChange"
          @project-path-change="handleProjectPathChange"
          @project-path-remove="handleProjectPathRemove"
        />
      </template>
    </Drawer>

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
      :task-completion-notifications-enabled="taskCompletionNotificationsEnabled"
      :browser-notifications-supported="browserNotificationsSupported"
      :auto-scroll-mode="autoScrollMode"
      @update:open="settingsOpen = $event"
      @theme-mode-change="emit('themeModeChange', $event)"
      @task-completion-notifications-change="handleTaskCompletionNotificationsChange"
      @test-task-completion-notification="handleTestTaskCompletionNotification"
      @export-history="handleExportLocalHistory"
      @clear-history="handleClearLocalHistory"
      @auto-scroll-mode-change="handleAutoScrollModeChange"
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

:deep(.chat-markdown a) {
  color: var(--brand-accent);
}

/* 抽屉内右面板：覆盖在消息流之上 */
:deep(.board-drawer .ant-drawer-body) {
  position: relative;
}

.board-drawer-panel {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: var(--z-sidebar);
  width: min(420px, 60%);
  box-shadow: -18px 0 46px rgba(9, 9, 11, 0.18);
  background: var(--brand-workspace);
}

/* 抽屉左缘拖拽手柄 */
.board-drawer-resize {
  position: fixed;
  top: 0;
  bottom: 0;
  z-index: calc(var(--z-modal) + 1);
  width: 6px;
  border: 0;
  padding: 0;
  cursor: col-resize;
  background: transparent;
}

.board-drawer-resize:hover {
  background: var(--brand-resize, rgba(24, 24, 27, 0.12));
}

@media (max-width: 767px) {
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

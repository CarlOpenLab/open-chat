/**
 * 工作区上下文（容器 → 页面 的唯一状态通道）。
 *
 * 分层约定：
 * - `WorkspacePage`（容器）持有全部会话/任务状态与业务逻辑；
 * - `BoardPage` / `ChatPage` / `ConversationPanel` 是纯展示层，
 *   通过 `useWorkspace()` 注入读取状态、调用 handler；
 * - 页面之间不互相引用，一切协作都经由容器状态完成。
 */
import type { InjectionKey } from "vue";
import { inject, provide } from "vue";
import type { DefaultMessageInfo, XModelMessage } from "@antdv-next/x-sdk";
import type { OpenChatConversation } from "../composables/useChatPersistence";
import type { ModelCatalogEntry } from "../composables/useChatModels";
import type { WebSearchSourceItem } from "../services/ai";
import type { AcpRunStateNotice, PermissionRequest } from "../services/OpenChatProvider";
import type { AgentView } from "../services/acp";
import type { QueuedChatMessage } from "../services/chatStorage";
import type { Task } from "../services/taskStorage";
import type { modelMessagesToBubbleItems } from "../services/transcript";
import type { SessionStatus, SessionStatusSignals } from "../utils/sessionStatus";
import type { TaskStatus } from "../utils/taskStatus";

/** ChatInput 提交选项（goal / instruction 等扩展通道）。 */
export interface SubmitMessageOptions {
  extraInfo?: Record<string, unknown>;
  systemPrompt?: string;
  attachments?: import("../services/ai").UploadedAttachment[];
  goal?: string;
  instruction?: string;
}

export type BubbleItems = ReturnType<typeof modelMessagesToBubbleItems>;
export type WorkspaceViewMode = "board" | "chat";

/**
 * 容器暴露给展示层的工作区对象。
 * 由容器以 `reactive({...})` 组装：ref/computed 访问即解包，handler 保持原样。
 */
export interface Workspace {
  // ===== 全局外观 =====
  dark: boolean;
  themeMode: "system" | "light" | "dark";
  toggleTheme: () => void;
  setThemeMode: (mode: "system" | "light" | "dark") => void;

  // ===== 当前会话（对话区） =====
  content: string;
  currentConversationKey: string;
  currentConversationTitle: string;
  currentConversationMessages: DefaultMessageInfo<XModelMessage>[];
  bubbleItems: BubbleItems;
  searchResultsByMessageId: Record<string, WebSearchSourceItem[]>;
  showWelcome: boolean;
  currentConversationBusyState?: { startedAt: number };
  isRequesting: boolean;
  inputRunning: boolean;
  inputUnavailable: boolean;
  currentQueuedMessages: QueuedChatMessage[];
  currentQueuePaused: boolean;
  acpRunState: AcpRunStateNotice | null;
  inputCurrentModel: string;
  inputCurrentModelLabel: string;
  inputModelCatalog: ModelCatalogEntry[];
  thinkingEnabled: boolean;
  workMode: "build" | "plan";
  effectivePermissionMode: "supervised" | "auto" | "full";
  isPiAgent: boolean;
  pendingPermission: PermissionRequest | null;
  fileModeEnabled: boolean;
  rightPanelOpen: boolean;
  workspaceAvailable: boolean;
  workspaceDiffStats: { added: number; removed: number };
  historyBack: string[];
  historyForward: string[];

  // ===== 供应商 / 项目 =====
  agents: AgentView[];
  activeAgentId: string;
  activeAgent: AgentView;
  isAcpAgent: boolean;
  acpSessionLoading: boolean;
  projectPath: string;
  projectPathOptions: string[];
  projectPathEnabled: boolean;

  // ===== 会话与任务集合 =====
  conversationList: OpenChatConversation[];
  visibleConversationList: OpenChatConversation[];
  taskList: Task[];
  openTaskId: string;
  currentTask: Task | null;
  boardOpenKey: string;
  drawerWidth: number;
  taskNowTick: number;
  boardStatusSignals: SessionStatusSignals;

  // ===== 浮层 =====
  conversationsOpen: boolean;
  sidebarWidth: number;
  commandPaletteOpen: boolean;
  settingsOpen: boolean;
  taskCompletionNotificationsEnabled: boolean;
  browserNotificationsSupported: boolean;

  // ===== 会话操作 =====
  handleSidebarToggle: () => void;
  handleExportLocalHistory: () => void;
  handleClearLocalHistory: () => void;
  handleRenameConversation: (title: string) => void;
  handlePinConversation: (conversationKey?: string) => void;
  handleArchiveConversation: (conversationKey?: string) => void;
  handleDeleteConversation: (conversationKey?: string) => void;
  handleSidebarRename: (conversationKey: string, title: string) => void;
  handleNewConversation: () => void;
  handleActiveChange: ConversationsActiveChange;
  handleAgentChange: (agentId: string) => void;
  handleCommandPaletteSelectConversation: (key: string) => void;
  openCommandPalette: () => void;
  closeBoardDrawer: () => void;

  // ===== 消息输入 / 请求 =====
  handleChange: (value: string) => void;
  handleCancel: () => void;
  handleSubmit: (
    nextContent: string,
    attachmentsOrOptions?: import("../services/ai").UploadedAttachment[] | SubmitMessageOptions,
    commandMeta?: { command: string; rawGoal: string },
  ) => void;
  handleReloadMessage: (messageId: string | number) => void;
  handlePromptClick: (info: { data: { key?: string; description?: string } }) => void;
  handleQueuedMessageChange: (id: string, nextContent: string) => void;
  handleQueuedMessageRemove: (id: string) => void;
  handleQueuedMessageClear: () => void;
  handleQueuedMessageSend: () => void;
  handleModelChange: (key: string) => void;
  handleThinkingChange: (value: boolean) => void;
  handleModeChange: (value: "build" | "plan") => void;
  handlePermissionChange: (value: "supervised" | "auto" | "full") => void;
  handlePermissionResponse: (response: "once" | "always" | "reject") => Promise<void>;
  handleFileModeChange: (value: boolean) => void;
  handleProjectPathChange: (value: string) => void;
  handleProjectPathRemove: (value: string) => void;

  // ===== 设置 / 通知 =====
  handleTaskCompletionNotificationsChange: (enabled: boolean) => Promise<void>;
  handleTestTaskCompletionNotification: () => void;

  // ===== 任务看板 =====
  handleTaskOpen: (id: string) => void;
  handleTaskMove: (id: string, status: TaskStatus) => void;
  handleTaskCreate: (payload: {
    title: string;
    projectPath: string | null;
    templateId?: string;
    status?: TaskStatus;
  }) => void;
  handleTaskUpdateTitle: (id: string, title: string) => void;
  handleTaskUpdate: (id: string, patch: Partial<Task>) => void;
  handleTaskArchive: (id: string) => void;
  handleTaskDuplicate: (id: string) => void;
  handleTaskDelete: (id: string) => void;
  handleCreateSessionForTask: (taskId: string) => void;
  handleOpenSessionFromTask: (sessionKey: string) => void;
  handleRetrySessionForTask: (taskId: string, sessionKey: string) => void;
  handleRemoveSessionLink: (taskId: string, sessionKey: string) => void;
  closeTaskDrawer: () => void;
}

/** Conversations 组件 onActiveChange 的 key 是 string | number，内部统一转 string。 */
export type ConversationsActiveChange = (key: string | number) => void;

export type WorkspaceSessionStatus = SessionStatus;

const WORKSPACE_KEY: InjectionKey<Workspace> = Symbol("open-chat-workspace");

export const provideWorkspace = (workspace: Workspace): void => {
  provide(WORKSPACE_KEY, workspace);
};

export const useWorkspace = (): Workspace => {
  const workspace = inject(WORKSPACE_KEY);
  if (!workspace) {
    throw new Error("useWorkspace 必须在 WorkspacePage 之内使用");
  }
  return workspace;
};

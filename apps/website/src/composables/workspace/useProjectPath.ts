import { message } from "antdv-next";
import { computed, ref, type Ref } from "vue";
import { projectPathsApi } from "../../services/workspaceApi";
import { normalizeDirectoryPath, uniqueDirectoryPaths } from "../../utils/projectPath";
import type { OpenChatConversation } from "../useChatPersistence";

/** 目录历史上限（与网关一致）。 */
const PROJECT_PATH_HISTORY_LIMIT = 20;

export interface UseProjectPathDeps {
  conversationList: Ref<OpenChatConversation[]>;
  currentConversationKey: Ref<string>;
  isConversationRunning: (key: string) => boolean;
  /** 会话防抖落盘（声明在 setup 更靠后处，故用回调延迟取用）。 */
  schedulePersist: () => void;
  /** 项目目录是 ACP 会话的加载参数，切换后需强制重拉。 */
  refreshAcpSession: (force?: boolean) => void;
  /** 项目目录变更后，该会话的失败历史刷新锁失效。 */
  forgetFailedHistoryRefresh: (conversationKey: string) => void;
}

/**
 * 项目目录域：当前 / 草稿 / 默认目录、网关侧目录历史（SQLite）的增删，
 * 以及切换 / 删除目录的副作用编排。本地先乐观更新，再以网关返回的列表为准。
 */
export function useProjectPath(deps: UseProjectPathDeps) {
  const projectPath = ref("");
  const draftProjectPath = ref("");
  const defaultProjectPath = ref("");
  /** 全局目录历史（与供应商 / 模型解耦），最近使用在前。 */
  const projectPathHistory = ref<string[]>([]);

  /**
   * @description 归一化目录；等于网关默认工作目录时视为「未选择」。
   * @param {string | undefined} value - 原始目录
   * @returns {string} 归一化后的目录；未选择时为空串
   */
  const normalizeProjectPath = (value: string | undefined): string => {
    const path = normalizeDirectoryPath(value);
    return path && path === normalizeDirectoryPath(defaultProjectPath.value) ? "" : path;
  };

  /**
   * @description 用网关返回的目录列表覆盖本地历史（过滤默认目录）。
   * @param {string[]} paths - 网关目录历史
   * @returns {void}
   */
  const applyHistory = (paths: string[]) => {
    projectPathHistory.value = uniqueDirectoryPaths(paths.map(normalizeProjectPath)).slice(
      0,
      PROJECT_PATH_HISTORY_LIMIT,
    );
  };

  /**
   * @description 从网关加载目录历史。
   * @returns {Promise<void>}
   */
  const loadProjectPathHistory = async () => {
    try {
      applyHistory(await projectPathsApi.list());
    } catch (error) {
      console.error("Failed to load project path history:", error);
    }
  };

  /**
   * @description 记住目录：本地立即移到最前，并写入网关。
   * @param {string} value - 目录路径
   * @returns {void}
   */
  const rememberProjectPath = (value: string) => {
    const path = normalizeProjectPath(value);
    if (!path) return;
    applyHistory([path, ...projectPathHistory.value]);
    void projectPathsApi
      .remember(path)
      .then(applyHistory)
      .catch((error: unknown) => console.error("Failed to remember project path:", error));
  };

  /**
   * @description 从历史中移除目录（本地立即生效，并同步网关）。
   * @param {string} value - 目录路径
   * @returns {void}
   */
  const forgetProjectPath = (value: string) => {
    const path = normalizeProjectPath(value);
    if (!path) return;
    projectPathHistory.value = projectPathHistory.value.filter((item) => item !== path);
    void projectPathsApi
      .forget(path)
      .then(applyHistory)
      .catch((error: unknown) => console.error("Failed to forget project path:", error));
  };

  const projectPathOptions = computed(() => {
    const current = normalizeProjectPath(projectPath.value);
    return uniqueDirectoryPaths(
      current ? [current, ...projectPathHistory.value] : [...projectPathHistory.value],
    );
  });

  /**
   * @description 最近使用的目录（新会话的默认目录）。
   * @returns {string} 目录；无历史时为空串
   */
  const lastProjectPath = () => {
    return projectPathHistory.value.map(normalizeProjectPath).find(Boolean) ?? "";
  };

  /**
   * @description 切换当前会话（或草稿）的项目目录，并强制重拉 agent 会话。
   * @param {string} value - 新目录；空串表示使用默认目录
   * @returns {void}
   */
  const handleProjectPathChange = (value: string) => {
    if (deps.isConversationRunning(deps.currentConversationKey.value)) {
      message.warning("请先停止当前会话的任务再切换项目目录");
      return;
    }
    const nextPath = normalizeProjectPath(value);
    projectPath.value = nextPath;
    if (!deps.currentConversationKey.value) draftProjectPath.value = nextPath;
    if (nextPath) rememberProjectPath(nextPath);
    const conversation = deps.conversationList.value.find(
      (item) => item.key === deps.currentConversationKey.value,
    );
    if (conversation) {
      conversation.projectPath = projectPath.value;
      deps.schedulePersist();
      deps.forgetFailedHistoryRefresh(String(conversation.key));
    }
    deps.refreshAcpSession(true);
  };

  /**
   * @description 从历史中删除目录；删除的正是当前目录时同时切回默认目录。
   * @param {string} value - 目录路径
   * @returns {void}
   */
  const handleProjectPathRemove = (value: string) => {
    if (deps.isConversationRunning(deps.currentConversationKey.value)) {
      message.warning("请先停止当前会话的任务再删除项目目录");
      return;
    }
    const removedPath = normalizeProjectPath(value);
    if (!removedPath) return;
    forgetProjectPath(removedPath);
    if (normalizeProjectPath(projectPath.value) === removedPath) handleProjectPathChange("");
  };

  return {
    projectPath,
    draftProjectPath,
    defaultProjectPath,
    projectPathHistory,
    projectPathOptions,
    normalizeProjectPath,
    loadProjectPathHistory,
    rememberProjectPath,
    forgetProjectPath,
    lastProjectPath,
    handleProjectPathChange,
    handleProjectPathRemove,
  };
}

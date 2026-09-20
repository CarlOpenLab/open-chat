import { message } from "antdv-next";
import { computed, ref, type Ref } from "vue";
import { loadServerState, saveServerState } from "../../services/serverState";
import { normalizeDirectoryPath, uniqueDirectoryPaths } from "../../utils/projectPath";
import type { OpenChatConversation } from "../useChatPersistence";

const PROJECT_PATH_HISTORY_KEY = "open-chat-project-paths-v1";

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
 * 项目目录域：当前/草稿/默认目录、网关侧项目历史（含旧 localStorage 迁移）、
 * 历史去重与增删，以及切换/删除目录的副作用编排。
 */
export function useProjectPath(deps: UseProjectPathDeps) {
  const projectPath = ref("");
  const draftProjectPath = ref("");
  const defaultProjectPath = ref("");
  /** 全局项目历史（与供应商/模型解耦）：不再按 agentId 分区 */
  const projectPathHistory = ref<string[]>([]);

  const normalizeProjectPath = (value: string | undefined): string => {
    const path = normalizeDirectoryPath(value);
    return path && path === normalizeDirectoryPath(defaultProjectPath.value) ? "" : path;
  };

  const loadProjectPathHistory = () => {
    if (typeof window === "undefined") return;
    // 项目历史存网关（局域网共享）；localStorage 旧数据仅在网关为空时一次性迁移
    void loadServerState("project-paths")
      .then((stored) => {
        if (Array.isArray(stored) && stored.length) {
          projectPathHistory.value = uniqueDirectoryPaths(
            stored.filter((v): v is string => typeof v === "string").map(normalizeProjectPath),
          ).slice(0, 20);
          return;
        }
        if (stored && typeof stored === "object") {
          // 兼容旧数据：Record<agentId, string[]> → 合并为全局列表
          const paths: string[] = [];
          for (const value of Object.values(stored as Record<string, unknown>)) {
            if (Array.isArray(value)) {
              paths.push(...value.filter((v): v is string => typeof v === "string"));
            }
          }
          if (paths.length) {
            projectPathHistory.value = uniqueDirectoryPaths(paths.map(normalizeProjectPath)).slice(
              0,
              20,
            );
          }
          return;
        }
        migrateLegacyProjectPaths();
      })
      .catch(() => migrateLegacyProjectPaths());
  };

  /** localStorage 旧副本仅在网关无数据时上传，避免覆盖其他设备的数据。 */
  const migrateLegacyProjectPaths = () => {
    try {
      const legacy = localStorage.getItem(PROJECT_PATH_HISTORY_KEY);
      if (!legacy) return;
      localStorage.removeItem(PROJECT_PATH_HISTORY_KEY);
      void saveServerState("project-paths", JSON.parse(legacy)).catch(() => {});
    } catch {
      // ignore
    }
  };

  const saveProjectPathHistory = () => {
    void saveServerState("project-paths", [...projectPathHistory.value]).catch(() => {});
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
    migrateLegacyProjectPaths,
    saveProjectPathHistory,
    rememberProjectPath,
    forgetProjectPath,
    lastProjectPath,
    handleProjectPathChange,
    handleProjectPathRemove,
  };
}

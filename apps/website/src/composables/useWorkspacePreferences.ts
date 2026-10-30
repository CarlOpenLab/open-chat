/**
 * 工作区偏好（当前 agent、各 agent 默认模型、Model API 当前模型）：保存在网关，
 * 换浏览器 / 换设备打开同一网关时保持一致。本地立即生效，写入合并防抖。
 */
import {
  DEFAULT_WORKSPACE_PREFERENCES,
  type WorkspacePreferences,
} from "@cc-heart/open-chat-types";
import { onBeforeUnmount, reactive } from "vue";
import { preferencesApi } from "../services/workspaceApi";

const WRITE_DELAY_MS = 300;

export function useWorkspacePreferences() {
  const preferences = reactive<WorkspacePreferences>({
    ...DEFAULT_WORKSPACE_PREFERENCES,
    agentDefaultModels: {},
  });
  let pending: Partial<WorkspacePreferences> = {};
  let timer: ReturnType<typeof setTimeout> | null = null;

  /**
   * @description 立即写出累积的偏好修改。
   * @returns {void}
   */
  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (Object.keys(pending).length === 0) return;
    const patch = pending;
    pending = {};
    preferencesApi.update(patch).catch((error: unknown) => {
      console.error("Failed to save preferences:", error);
    });
  };

  /**
   * @description 从网关加载偏好。
   * @returns {Promise<void>}
   */
  const load = async () => {
    Object.assign(preferences, await preferencesApi.get());
  };

  /**
   * @description 修改偏好：本地立即生效，网关写入防抖合并。
   * @param {Partial<WorkspacePreferences>} patch - 需要修改的偏好
   * @returns {void}
   */
  const update = (patch: Partial<WorkspacePreferences>) => {
    Object.assign(preferences, patch);
    pending = { ...pending, ...patch };
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, WRITE_DELAY_MS);
  };

  /**
   * @description 记住某个 agent 的默认模型（新会话优先使用）。
   * @param {string} agentId - agent id
   * @param {string} model - 模型 id
   * @returns {void}
   */
  const rememberAgentModel = (agentId: string, model: string) => {
    if (!agentId || !model || preferences.agentDefaultModels[agentId] === model) return;
    update({ agentDefaultModels: { ...preferences.agentDefaultModels, [agentId]: model } });
  };

  onBeforeUnmount(flush);

  return { preferences, load, update, rememberAgentModel };
}

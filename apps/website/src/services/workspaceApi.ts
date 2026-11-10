/**
 * 工作区数据 API：会话索引、服务商、偏好、项目目录历史与数据库概况。
 * 数据全部保存在网关的 SQLite，浏览器不再落任何本地存储。
 */
import type {
  ConversationRecord,
  LegacyImportPayload,
  LegacyImportResult,
  ProviderView,
  WorkspaceInfo,
  WorkspacePreferences,
} from "@cc-heart/open-chat-types";
import { apiRequest, apiUrl } from "./http";

const encode = encodeURIComponent;

export const conversationsApi = {
  /**
   * @description 读取未归档的会话索引。
   * @returns {Promise<ConversationRecord[]>} 会话列表
   */
  async list(): Promise<ConversationRecord[]> {
    return (
      await apiRequest<{ conversations: ConversationRecord[] }>("/api/conversations", {
        errorMessage: "会话加载失败",
      })
    ).conversations;
  },

  /**
   * @description 写入完整会话记录（幂等 upsert）。
   * @param {ConversationRecord} record - 会话记录
   * @returns {Promise<void>}
   */
  async save(record: ConversationRecord): Promise<void> {
    await apiRequest(`/api/conversations/${encode(record.key)}`, {
      method: "PUT",
      json: record,
      errorMessage: "会话保存失败",
    });
  },

  /**
   * @description 删除会话。
   * @param {string} key - 会话 key
   * @returns {Promise<void>}
   */
  async remove(key: string): Promise<void> {
    await apiRequest(`/api/conversations/${encode(key)}`, {
      method: "DELETE",
      errorMessage: "会话删除失败",
    });
  },

  /**
   * @description 归档会话（从列表隐藏，数据保留）。
   * @param {string} key - 会话 key
   * @returns {Promise<void>}
   */
  async archive(key: string): Promise<void> {
    await apiRequest(`/api/conversations/${encode(key)}/archive`, {
      method: "POST",
      errorMessage: "会话归档失败",
    });
  },

  /**
   * @description 清空全部会话。
   * @returns {Promise<void>}
   */
  async clear(): Promise<void> {
    await apiRequest("/api/conversations", { method: "DELETE", errorMessage: "清空会话失败" });
  },

  /**
   * @description 读取 Model API 会话保存的消息。
   * @param {string} key - 会话 key
   * @returns {Promise<unknown[] | null>} 消息数组；从未保存过时为 null
   */
  async getTranscript(key: string): Promise<unknown[] | null> {
    return (
      await apiRequest<{ messages: unknown[] | null }>(
        `/api/conversations/${encode(key)}/transcript`,
        { errorMessage: "会话消息加载失败" },
      )
    ).messages;
  },

  /**
   * @description 整体保存 Model API 会话的消息。
   * @param {string} key - 会话 key
   * @param {unknown[]} messages - 消息数组
   * @returns {Promise<void>}
   */
  async saveTranscript(key: string, messages: unknown[]): Promise<void> {
    await apiRequest(`/api/conversations/${encode(key)}/transcript`, {
      method: "PUT",
      json: { messages },
      errorMessage: "会话消息保存失败",
    });
  },
};

export const providersApi = {
  /**
   * @description 读取模型服务商（Key 只含掩码）。
   * @returns {Promise<ProviderView[]>} 服务商列表
   */
  async list(): Promise<ProviderView[]> {
    return (
      await apiRequest<{ providers: ProviderView[] }>("/api/providers", {
        errorMessage: "服务商加载失败",
      })
    ).providers;
  },
};

export const preferencesApi = {
  /**
   * @description 读取工作区偏好。
   * @returns {Promise<WorkspacePreferences>} 完整偏好
   */
  async get(): Promise<WorkspacePreferences> {
    return (
      await apiRequest<{ preferences: WorkspacePreferences }>("/api/preferences", {
        errorMessage: "偏好加载失败",
      })
    ).preferences;
  },

  /**
   * @description 合并更新工作区偏好。
   * @param {Partial<WorkspacePreferences>} patch - 需要修改的偏好
   * @returns {Promise<WorkspacePreferences>} 更新后的完整偏好
   */
  async update(patch: Partial<WorkspacePreferences>): Promise<WorkspacePreferences> {
    return (
      await apiRequest<{ preferences: WorkspacePreferences }>("/api/preferences", {
        method: "PATCH",
        json: patch,
        errorMessage: "偏好保存失败",
      })
    ).preferences;
  },
};

export const projectPathsApi = {
  /**
   * @description 读取项目目录历史（最近使用在前）。
   * @returns {Promise<string[]>} 目录列表
   */
  async list(): Promise<string[]> {
    return (
      await apiRequest<{ paths: string[] }>("/api/project-path/history", {
        errorMessage: "目录历史加载失败",
      })
    ).paths;
  },

  /**
   * @description 记住一个目录（移到最前）。
   * @param {string} path - 目录路径
   * @returns {Promise<string[]>} 更新后的目录历史
   */
  async remember(path: string): Promise<string[]> {
    return (
      await apiRequest<{ paths: string[] }>("/api/project-path/history", {
        method: "POST",
        json: { path },
        errorMessage: "目录历史保存失败",
      })
    ).paths;
  },

  /**
   * @description 从历史中移除目录。
   * @param {string} path - 目录路径
   * @returns {Promise<string[]>} 更新后的目录历史
   */
  async forget(path: string): Promise<string[]> {
    return (
      await apiRequest<{ paths: string[] }>(
        `/api/project-path/history?${new URLSearchParams({ path })}`,
        { method: "DELETE", errorMessage: "目录历史保存失败" },
      )
    ).paths;
  },
};

export const workspaceApi = {
  /**
   * @description 读取数据库概况（路径、大小、各类数据条数）。
   * @returns {Promise<WorkspaceInfo>} 概况
   */
  async info(): Promise<WorkspaceInfo> {
    return apiRequest<WorkspaceInfo>("/api/workspace/info", { errorMessage: "数据概况加载失败" });
  },

  /** 全量备份下载地址（同源 cookie 鉴权，可直接用作下载链接）。 */
  exportUrl: apiUrl("/api/workspace/export"),

  /**
   * @description 提交浏览器旧数据，由网关按「缺失才写入」合并。
   * @param {LegacyImportPayload} payload - 旧数据
   * @returns {Promise<LegacyImportResult>} 各类数据实际导入条数
   */
  async importLegacy(payload: LegacyImportPayload): Promise<LegacyImportResult> {
    return (
      await apiRequest<{ imported: LegacyImportResult }>("/api/workspace/import-legacy", {
        method: "POST",
        json: payload,
        errorMessage: "旧数据导入失败",
      })
    ).imported;
  },
};

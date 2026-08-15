export interface ModelInfo {
  id: string;
  name?: string;
  contextLength?: number;
}

export interface ModelsProvider {
  name: string;
  models: ModelInfo[];
}

/** 服务端本地 opencode（AI 取本地的）发现的模型。 */
export interface LocalModelInfo {
  /** 形如 `provider/model`（如 `opencode/nemotron-3.5-lightning-free`）。 */
  id: string;
  name: string;
  provider: string;
  providerName: string;
  contextLength?: number;
}

export interface LocalModelsInfo {
  enabled: boolean;
  provider: string;
  models: LocalModelInfo[];
  error?: string;
}

export interface ModelsResponse {
  search: { enabled: boolean; provider: string };
  local?: LocalModelsInfo;
}

/** Display-ready source item consumed by the `Sources` UI component. */
export interface WebSearchSourceItem {
  key: string;
  title: string;
  url: string;
  description: string;
}

/**
 * Base URL for gateway requests. Defaults to a relative path so that, in dev,
 * requests go through the Vite proxy (`/api` -> http://localhost:8082) and avoid
 * CORS. Set `VITE_API_URL` to target the gateway directly when needed.
 */
export const API_BASE_URL = import.meta.env.VITE_API_URL || "";

/** Optional gateway bearer token (only required when the gateway enables auth). */
export const GATEWAY_API_KEY = import.meta.env.VITE_GATEWAY_API_KEY || "";

export const aiService = {
  /**
   * 获取服务端能力状态：联网搜索可用性 + 本地 opencode（AI 取本地的）
   * 发现的模型/供应商。手动配置的服务商模型仍在客户端本地（IndexedDB），
   * 由 useChatModels 合并展示。
   */
  async getModels(): Promise<ModelsResponse> {
    const response = await fetch(`${API_BASE_URL}/api/models`);
    if (!response.ok) {
      throw new Error("Failed to fetch models");
    }
    return response.json();
  },

  /** Ask a local gateway to open the host OS directory picker. */
  async pickProjectPath(): Promise<{ path?: string; canceled: boolean }> {
    const response = await fetch(`${API_BASE_URL}/api/project-path/pick`, {
      method: "POST",
      headers: GATEWAY_API_KEY ? { Authorization: `Bearer ${GATEWAY_API_KEY}` } : undefined,
    });
    const data = (await response.json().catch(() => ({}))) as {
      path?: unknown;
      canceled?: unknown;
      error?: { message?: string };
    };
    if (!response.ok) {
      throw new Error(data.error?.message || `目录选择失败（HTTP ${response.status}）`);
    }
    return {
      path: typeof data.path === "string" ? data.path : undefined,
      canceled: data.canceled === true,
    };
  },
};

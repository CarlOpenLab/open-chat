export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  model?: string;
  stream?: boolean;
  temperature?: number;
  maxTokens?: number;
}

export interface ModelInfo {
  id: string;
  name?: string;
  contextLength?: number;
}

export interface ModelsProvider {
  name: string;
  models: ModelInfo[];
}

export interface ModelsResponse {
  defaultModel: string;
  search: { enabled: boolean; provider: string };
  providers: ModelsProvider[];
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
   * 获取支持的模型列表（含联网搜索可用性）
   */
  async getModels(): Promise<ModelsResponse> {
    const response = await fetch(`${API_BASE_URL}/api/models`);
    if (!response.ok) {
      throw new Error("Failed to fetch models");
    }
    return response.json();
  },
};

import { API_BASE_URL } from "./ai";

export type ProviderApi = "chat/completions" | "responses";

export interface ProviderModelInfo {
  id: string;
  name?: string;
  contextLength?: number;
}

export interface ProviderView {
  id: string;
  name: string;
  baseUrl: string;
  api: ProviderApi;
  models: ProviderModelInfo[];
  hasKey: boolean;
  apiKeyMasked: string;
  createdAt: number;
  updatedAt: number;
}

export interface ProviderInput {
  name: string;
  baseUrl: string;
  /** 留空表示在更新时保留原有密钥。支持 `$ENV_VAR` 引用服务端环境变量。 */
  apiKey: string;
  api: ProviderApi;
  models: ProviderModelInfo[];
}

export interface ProviderListResponse {
  providers: ProviderView[];
}

const parseError = async (response: Response): Promise<Error> => {
  let message = `请求失败（${response.status}）`;
  try {
    const data = (await response.json()) as { error?: { message?: string } };
    if (data.error?.message) message = data.error.message;
  } catch {
    // non-JSON error body
  }
  return new Error(message);
};

export const providerService = {
  async list(): Promise<ProviderView[]> {
    const response = await fetch(`${API_BASE_URL}/api/providers`);
    if (!response.ok) throw await parseError(response);
    const data = (await response.json()) as ProviderListResponse;
    return data.providers;
  },

  async create(input: ProviderInput): Promise<ProviderView> {
    const response = await fetch(`${API_BASE_URL}/api/providers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!response.ok) throw await parseError(response);
    const data = (await response.json()) as { provider: ProviderView };
    return data.provider;
  },

  async update(id: string, input: ProviderInput): Promise<ProviderView> {
    const response = await fetch(`${API_BASE_URL}/api/providers/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!response.ok) throw await parseError(response);
    const data = (await response.json()) as { provider: ProviderView };
    return data.provider;
  },

  async remove(id: string): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/api/providers/${id}`, { method: "DELETE" });
    if (!response.ok) throw await parseError(response);
  },
};

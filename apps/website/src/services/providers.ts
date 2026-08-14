import { deleteLocalValue, readLocalValue, writeLocalValue } from "./localDatabase";

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
  /** 密钥明文；更新时留空表示保留原有密钥。 */
  apiKey: string;
  api: ProviderApi;
  models: ProviderModelInfo[];
}

/** 本地持久化形态：apiKey 明文保存在浏览器 IndexedDB（与服务端无关）。 */
export interface StoredLocalProvider extends ProviderInput {
  id: string;
  createdAt: number;
  updatedAt: number;
}

const PROVIDERS_KEY = "providers-v1";

interface ProvidersFile {
  version: 1;
  providers: StoredLocalProvider[];
}

function maskKey(value: string): string {
  if (!value) return "";
  if (value.length <= 8) return "****";
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

function toView(provider: StoredLocalProvider): ProviderView {
  return {
    id: provider.id,
    name: provider.name,
    baseUrl: provider.baseUrl,
    api: provider.api,
    models: provider.models,
    hasKey: provider.apiKey.length > 0,
    apiKeyMasked: maskKey(provider.apiKey),
    createdAt: provider.createdAt,
    updatedAt: provider.updatedAt,
  };
}

function newId(): string {
  const uuid =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : "";
  if (uuid) return uuid;
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeInput(input: ProviderInput): ProviderInput {
  const name = typeof input?.name === "string" ? input.name.trim() : "";
  const baseUrl = typeof input?.baseUrl === "string" ? input.baseUrl.trim() : "";
  const apiKey = typeof input?.apiKey === "string" ? input.apiKey.trim() : "";
  const api: ProviderApi = input?.api === "responses" ? "responses" : "chat/completions";
  const models = Array.isArray(input?.models) ? input.models : [];
  if (!name) throw new Error("服务商名称不能为空");
  return { name, baseUrl, apiKey, api, models };
}

async function loadAll(): Promise<StoredLocalProvider[]> {
  const raw = await readLocalValue<ProvidersFile>(PROVIDERS_KEY);
  if (!raw || !Array.isArray(raw.providers)) return [];
  return raw.providers;
}

async function saveAll(providers: StoredLocalProvider[]): Promise<void> {
  const payload: ProvidersFile = { version: 1, providers };
  await writeLocalValue(PROVIDERS_KEY, payload);
}

/** 服务商数据全部存储在浏览器本地（IndexedDB），不请求任何服务端接口。 */
export const providerService = {
  async list(): Promise<ProviderView[]> {
    const providers = await loadAll();
    return providers.map(toView);
  },

  /** 全部本地服务商（含明文 apiKey，仅供内存中解析转发目标）。 */
  async listStored(): Promise<StoredLocalProvider[]> {
    return loadAll();
  },

  async getStored(id: string): Promise<StoredLocalProvider | undefined> {
    const providers = await loadAll();
    return providers.find((provider) => provider.id === id);
  },

  /** 按模型 id 找到所属服务商（含明文 apiKey，仅供发送请求时使用）。 */
  async findByModel(model: string): Promise<StoredLocalProvider | undefined> {
    const providers = await loadAll();
    return providers.find((provider) => provider.models.some((item) => item.id === model));
  },

  async create(input: ProviderInput): Promise<ProviderView> {
    const normalized = normalizeInput(input);
    const now = Date.now();
    const provider: StoredLocalProvider = {
      id: newId(),
      ...normalized,
      createdAt: now,
      updatedAt: now,
    };
    const providers = await loadAll();
    providers.push(provider);
    await saveAll(providers);
    return toView(provider);
  },

  async update(id: string, input: ProviderInput): Promise<ProviderView> {
    const normalized = normalizeInput(input);
    const providers = await loadAll();
    const index = providers.findIndex((provider) => provider.id === id);
    if (index === -1) {
      throw new Error(`服务商不存在：${id}`);
    }
    const existing = providers[index];
    const updated: StoredLocalProvider = {
      ...existing,
      name: normalized.name,
      baseUrl: normalized.baseUrl,
      api: normalized.api,
      models: normalized.models,
      // 留空保留原 key
      apiKey: normalized.apiKey || existing.apiKey,
      updatedAt: Date.now(),
    };
    providers[index] = updated;
    await saveAll(providers);
    return toView(updated);
  },

  async remove(id: string): Promise<void> {
    const providers = await loadAll();
    await saveAll(providers.filter((provider) => provider.id !== id));
  },

  /** 清除全部服务商（设置面板「清空」用）。 */
  async clear(): Promise<void> {
    await deleteLocalValue(PROVIDERS_KEY);
  },
};

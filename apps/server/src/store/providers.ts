/**
 * 模型服务商存储（providers 表）。
 *
 * API Key 只保存在网关：对外列表只返回掩码；转发聊天请求时由网关按
 * providerId（或模型 id）解析出 baseUrl / apiKey，明文不经过浏览器。
 */
import { randomUUID } from "node:crypto";
import type {
  ProviderApi,
  ProviderInput,
  ProviderModel,
  ProviderView,
} from "@cc-heart/open-chat-types";
import { GatewayError } from "../error";
import { parseJsonColumn, type Database } from "../db/database";

interface ProviderRow {
  id: string;
  name: string;
  base_url: string;
  api: ProviderApi;
  api_key: string;
  models: string;
  created_at: number;
  updated_at: number;
}

/** 网关内部使用的完整服务商（含明文 Key）。 */
export interface StoredProvider {
  id: string;
  name: string;
  baseUrl: string;
  api: ProviderApi;
  apiKey: string;
  models: ProviderModel[];
  createdAt: number;
  updatedAt: number;
}

/**
 * @description 生成 Key 掩码：保留首尾各 4 位，短 Key 全部隐藏。
 * @param {string} value - 明文 Key
 * @returns {string} 掩码文本；无 Key 时为空串
 */
function maskKey(value: string): string {
  if (!value) return "";
  if (value.length <= 8) return "****";
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

/**
 * @description 规范化模型列表：丢弃缺少 id 的条目并按 id 去重。
 * @param {unknown} value - 原始模型数组
 * @returns {ProviderModel[]} 合法模型
 */
function normalizeModels(value: unknown): ProviderModel[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const models: ProviderModel[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const candidate = item as Record<string, unknown>;
    const id = typeof candidate.id === "string" ? candidate.id.trim() : "";
    if (!id || seen.has(id)) continue;
    seen.add(id);
    models.push({
      id,
      ...(typeof candidate.name === "string" && candidate.name.trim()
        ? { name: candidate.name.trim() }
        : {}),
      ...(typeof candidate.contextLength === "number" && candidate.contextLength > 0
        ? { contextLength: candidate.contextLength }
        : {}),
    });
  }
  return models;
}

/**
 * @description 校验服务商请求体。新建时要求 name 与 http(s) baseUrl；更新时只校验出现的字段。
 * @param {unknown} body - 请求体
 * @param {"create" | "update"} mode - 新建或更新
 * @returns {ProviderInput} 规范化后的字段
 * @throws {GatewayError} 字段缺失或非法时抛出 400
 */
export function parseProviderInput(body: unknown, mode: "create" | "update"): ProviderInput {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw GatewayError.invalidRequest("请求体必须是 JSON 对象");
  }
  const obj = body as Record<string, unknown>;
  const input: ProviderInput = {};
  if ("name" in obj || mode === "create") {
    const name = typeof obj.name === "string" ? obj.name.trim().slice(0, 100) : "";
    if (!name) throw GatewayError.invalidRequest("服务商名称不能为空");
    input.name = name;
  }
  if ("baseUrl" in obj || mode === "create") {
    const baseUrl = typeof obj.baseUrl === "string" ? obj.baseUrl.trim() : "";
    if (!/^https?:\/\//i.test(baseUrl)) {
      throw GatewayError.invalidRequest("baseUrl 必须是 http(s) 地址");
    }
    input.baseUrl = baseUrl;
  }
  if ("apiKey" in obj) {
    if (typeof obj.apiKey !== "string") throw GatewayError.invalidRequest("apiKey 必须是字符串");
    input.apiKey = obj.apiKey.trim();
  }
  if ("api" in obj) input.api = obj.api === "responses" ? "responses" : "chat/completions";
  if ("models" in obj) input.models = normalizeModels(obj.models);
  return input;
}

/**
 * @description 宽松规范化旧版服务商数据（{ version, providers: [...] } 中的单项）。
 * @param {unknown} value - 旧服务商对象
 * @returns {StoredProvider | null} 规范化后的服务商；缺少必填字段时为 null
 */
export function normalizeLegacyProvider(value: unknown): StoredProvider | null {
  if (!value || typeof value !== "object") return null;
  const obj = value as Record<string, unknown>;
  const id = typeof obj.id === "string" ? obj.id.trim() : "";
  const name = typeof obj.name === "string" ? obj.name.trim() : "";
  const baseUrl = typeof obj.baseUrl === "string" ? obj.baseUrl.trim() : "";
  if (!id || !name || !/^https?:\/\//i.test(baseUrl)) return null;
  const now = Date.now();
  const createdAt = typeof obj.createdAt === "number" ? obj.createdAt : now;
  return {
    id,
    name,
    baseUrl,
    api: obj.api === "responses" ? "responses" : "chat/completions",
    apiKey: typeof obj.apiKey === "string" ? obj.apiKey.trim() : "",
    models: normalizeModels(obj.models),
    createdAt,
    updatedAt: typeof obj.updatedAt === "number" ? obj.updatedAt : createdAt,
  };
}

/**
 * @description 把数据库行转换为内部服务商对象。
 * @param {ProviderRow} row - providers 表的一行
 * @returns {StoredProvider} 含明文 Key 的服务商
 */
function rowToStored(row: ProviderRow): StoredProvider {
  return {
    id: row.id,
    name: row.name,
    baseUrl: row.base_url,
    api: row.api,
    apiKey: row.api_key,
    models: parseJsonColumn<ProviderModel[]>(row.models, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * @description 转换为对外展示形态（Key 掩码）。
 * @param {StoredProvider} provider - 内部服务商
 * @returns {ProviderView} 可安全返回给浏览器的视图
 */
export function toProviderView(provider: StoredProvider): ProviderView {
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

export class ProviderStore {
  constructor(private readonly db: Database) {}

  /**
   * @description 列出全部服务商（按创建时间升序，含明文 Key，仅供网关内部使用）。
   * @returns {StoredProvider[]} 服务商列表
   */
  list(): StoredProvider[] {
    const rows = this.db
      .prepare("SELECT * FROM providers ORDER BY created_at, rowid")
      .all() as unknown as ProviderRow[];
    return rows.map(rowToStored);
  }

  /**
   * @description 读取单个服务商。
   * @param {string} id - 服务商 id
   * @returns {StoredProvider | null} 服务商；不存在时为 null
   */
  get(id: string): StoredProvider | null {
    const row = this.db.prepare("SELECT * FROM providers WHERE id = ?").get(id) as unknown as
      | ProviderRow
      | undefined;
    return row ? rowToStored(row) : null;
  }

  /**
   * @description 新建服务商。
   * @param {ProviderInput} input - 已经过 parseProviderInput("create") 校验的字段
   * @param {number} now - 创建时间
   * @returns {StoredProvider} 新建的服务商
   */
  create(input: ProviderInput, now = Date.now()): StoredProvider {
    const provider: StoredProvider = {
      id: randomUUID(),
      name: input.name ?? "",
      baseUrl: input.baseUrl ?? "",
      api: input.api ?? "chat/completions",
      apiKey: input.apiKey ?? "",
      models: input.models ?? [],
      createdAt: now,
      updatedAt: now,
    };
    this.insert(provider);
    return provider;
  }

  /**
   * @description 更新服务商；apiKey 为空或未提供时保留原 Key。
   * @param {string} id - 服务商 id
   * @param {ProviderInput} input - 已经过 parseProviderInput("update") 校验的字段
   * @param {number} now - 更新时间
   * @returns {StoredProvider | null} 更新后的服务商；不存在时为 null
   */
  update(id: string, input: ProviderInput, now = Date.now()): StoredProvider | null {
    const current = this.get(id);
    if (!current) return null;
    const next: StoredProvider = {
      ...current,
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.baseUrl !== undefined ? { baseUrl: input.baseUrl } : {}),
      ...(input.api !== undefined ? { api: input.api } : {}),
      ...(input.models !== undefined ? { models: input.models } : {}),
      ...(input.apiKey ? { apiKey: input.apiKey } : {}),
      updatedAt: now,
    };
    this.db
      .prepare(
        `UPDATE providers SET name = ?, base_url = ?, api = ?, api_key = ?, models = ?,
           updated_at = ? WHERE id = ?`,
      )
      .run(
        next.name,
        next.baseUrl,
        next.api,
        next.apiKey,
        JSON.stringify(next.models),
        next.updatedAt,
        id,
      );
    return next;
  }

  /**
   * @description 删除服务商。
   * @param {string} id - 服务商 id
   * @returns {boolean} 存在并已删除时为 true
   */
  delete(id: string): boolean {
    return Number(this.db.prepare("DELETE FROM providers WHERE id = ?").run(id).changes) > 0;
  }

  /**
   * @description 旧数据导入：服务商不存在时写入。
   * @param {StoredProvider} provider - 规范化后的服务商
   * @returns {boolean} 实际写入时为 true
   */
  insertIfAbsent(provider: StoredProvider): boolean {
    if (this.get(provider.id)) return false;
    this.insert(provider);
    return true;
  }

  /**
   * @description 统计服务商数量。
   * @returns {number} 服务商数量
   */
  count(): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM providers").get() as { n: number }).n;
  }

  private insert(provider: StoredProvider): void {
    this.db
      .prepare(
        `INSERT INTO providers (id, name, base_url, api, api_key, models, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        provider.id,
        provider.name,
        provider.baseUrl,
        provider.api,
        provider.apiKey,
        JSON.stringify(provider.models),
        provider.createdAt,
        provider.updatedAt,
      );
  }
}

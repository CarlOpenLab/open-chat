/**
 * 工作区偏好（preferences 表，每个偏好一行 JSON）：当前 agent、各 agent 默认模型、
 * Model API 当前模型、看板助手会话。主题等纯显示偏好按设备保存在浏览器，不在这里。
 */
import {
  DEFAULT_WORKSPACE_PREFERENCES,
  type BoardAssistantSession,
  type WorkspacePreferences,
} from "@cc-heart/open-chat-types";
import { GatewayError } from "../error";
import { transaction, type Database } from "../db/database";

type PreferenceKey = keyof WorkspacePreferences;

const PREFERENCE_KEYS = Object.keys(DEFAULT_WORKSPACE_PREFERENCES) as PreferenceKey[];

/**
 * @description 规范化看板助手会话；agentId 为空时视为未设置。
 * @param {unknown} value - 原始值
 * @returns {BoardAssistantSession | null} 会话或 null
 */
function normalizeBoardAssistant(value: unknown): BoardAssistantSession | null {
  if (!value || typeof value !== "object") return null;
  const obj = value as Record<string, unknown>;
  const agentId = typeof obj.agentId === "string" ? obj.agentId.trim() : "";
  if (!agentId) return null;
  return {
    agentId,
    providerSessionId:
      typeof obj.providerSessionId === "string" ? obj.providerSessionId.trim() : "",
  };
}

/**
 * @description 规范化 agent → 默认模型映射，丢弃非字符串值。
 * @param {unknown} value - 原始值
 * @returns {Record<string, string>} 合法映射
 */
function normalizeModelMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, string> = {};
  for (const [agentId, model] of Object.entries(value as Record<string, unknown>)) {
    if (agentId && typeof model === "string" && model) result[agentId] = model;
  }
  return result;
}

/**
 * @description 校验偏好补丁：只允许已知键，值按各自规则规范化。
 * @param {unknown} body - 请求体
 * @returns {Partial<WorkspacePreferences>} 规范化后的补丁
 * @throws {GatewayError} 请求体不是对象或包含未知键时抛出 400
 */
export function parsePreferencesPatch(body: unknown): Partial<WorkspacePreferences> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw GatewayError.invalidRequest("请求体必须是 JSON 对象");
  }
  const patch: Partial<WorkspacePreferences> = {};
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    switch (key as PreferenceKey) {
      case "activeAgentId":
        patch.activeAgentId = typeof value === "string" ? value.trim().slice(0, 100) : "";
        break;
      case "currentModel":
        patch.currentModel = typeof value === "string" ? value.trim().slice(0, 300) : "";
        break;
      case "agentDefaultModels":
        patch.agentDefaultModels = normalizeModelMap(value);
        break;
      case "boardAssistant":
        patch.boardAssistant = normalizeBoardAssistant(value);
        break;
      default:
        throw GatewayError.invalidRequest(`未知的偏好项：${key}`);
    }
  }
  return patch;
}

export class PreferenceStore {
  constructor(private readonly db: Database) {}

  /**
   * @description 读取全部偏好，缺失项使用默认值。
   * @returns {WorkspacePreferences} 完整偏好
   */
  get(): WorkspacePreferences {
    const rows = this.db.prepare("SELECT key, value FROM preferences").all() as Array<{
      key: string;
      value: string;
    }>;
    const stored: Record<string, unknown> = {};
    for (const row of rows) {
      try {
        stored[row.key] = JSON.parse(row.value) as unknown;
      } catch {
        // 单项损坏时回落默认值
      }
    }
    const known = Object.fromEntries(
      Object.entries(stored).filter(([key]) => PREFERENCE_KEYS.includes(key as PreferenceKey)),
    );
    return { ...DEFAULT_WORKSPACE_PREFERENCES, ...parsePreferencesPatch(known) };
  }

  /**
   * @description 合并写入偏好补丁（未出现的键保持不变）。
   * @param {Partial<WorkspacePreferences>} patch - 已校验的补丁
   * @param {number} now - 写入时间
   * @returns {WorkspacePreferences} 写入后的完整偏好
   */
  update(patch: Partial<WorkspacePreferences>, now = Date.now()): WorkspacePreferences {
    const statement = this.db.prepare(
      `INSERT INTO preferences (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    );
    transaction(this.db, () => {
      for (const [key, value] of Object.entries(patch)) {
        statement.run(key, JSON.stringify(value), now);
      }
    });
    return this.get();
  }

  /**
   * @description 判断某个偏好是否已经写入过（旧数据导入时避免覆盖）。
   * @param {PreferenceKey} key - 偏好键
   * @returns {boolean} 已存在时为 true
   */
  has(key: PreferenceKey): boolean {
    return Boolean(this.db.prepare("SELECT 1 FROM preferences WHERE key = ?").get(key));
  }
}

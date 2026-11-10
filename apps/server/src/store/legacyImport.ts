/**
 * 旧数据一次性导入 SQLite。
 *
 * 两个来源，导入规则一致——「网关已有的数据优先，缺失才写入」，可重复执行：
 * 1. 旧版网关的 JSON 状态文件 `<数据根>/state/*.json`：网关启动时导入，
 *    完成后目录改名为 `state.imported-<时间戳>` 留作备份；
 * 2. 更早版本留在浏览器 IndexedDB / localStorage 的数据：前端读出后经
 *    `POST /api/import/legacy` 提交，导入成功后由前端删除本地副本。
 */
import fs from "node:fs";
import path from "node:path";
import type {
  ConversationRecord,
  LegacyImportPayload,
  LegacyImportResult,
} from "@cc-heart/open-chat-types";
import { transaction } from "../db/database";
import { parseConversationRecord } from "./conversations";
import { parsePreferencesPatch } from "./preferences";
import { normalizeLegacyProvider } from "./providers";
import type { WorkspaceStore } from "./workspace";

/** 旧版网关状态文件名 → 导入载荷字段。 */
const STATE_FILES: Record<string, keyof LegacyImportPayload> = {
  "chat-state.json": "chatState",
  "project-paths.json": "projectPaths",
  "providers.json": "providers",
};

const EMPTY_RESULT: LegacyImportResult = {
  conversations: 0,
  transcripts: 0,
  providers: 0,
  projectPaths: 0,
  preferences: 0,
};

/**
 * @description 从会话 key 中解析创建时间（`{ts}-{rand}` 或 `acp:{agent}:{ts}-{rand}`）。
 * @param {string} key - 会话 key
 * @returns {number | undefined} epoch 毫秒；无法解析时为 undefined
 */
function timestampFromKey(key: string): number | undefined {
  const match = (key.split(":").pop() ?? "").match(/^(\d{12,})/);
  return match ? Number(match[1]) : undefined;
}

/**
 * @description 取消息的可见文本（字符串内容直接返回，数组内容拼接 text 片段）。
 * @param {unknown} content - 消息 content
 * @returns {string} 文本
 */
function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) =>
      part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string"
        ? (part as { text: string }).text
        : "",
    )
    .join(" ");
}

/**
 * @description 旧版「默认对话」标题：用首条用户消息的摘要替换。
 * @param {unknown[]} messages - 旧会话保存的消息
 * @returns {string} 新标题
 */
function titleFromMessages(messages: unknown[]): string {
  for (const item of messages) {
    const message = (item as { message?: { role?: unknown; content?: unknown } })?.message;
    if (message?.role !== "user") continue;
    const text = textOf(message.content).replace(/\s+/g, " ").trim();
    if (text) return text.length > 20 ? `${text.slice(0, 20)}...` : text;
  }
  return "新对话";
}

/**
 * @description 旧会话里保存的消息去掉流式中间态，作为 Model API 会话的 transcript。
 * @param {unknown[]} messages - 旧消息数组
 * @returns {unknown[]} 已完成的消息
 */
function settledMessages(messages: unknown[]): unknown[] {
  return messages.filter((item) => {
    const status = (item as { status?: unknown })?.status;
    return status !== "loading" && status !== "updating";
  });
}

/**
 * @description 把旧版会话对象转换为会话记录。
 * @param {unknown} value - 旧会话（PersistedConversation）
 * @param {string} currentModel - 旧状态中的全局当前模型（会话缺少 modelId 时使用）
 * @returns {{ record: ConversationRecord; messages: unknown[] } | null} 记录与消息；缺少 key 时为 null
 */
function convertLegacyConversation(
  value: unknown,
  currentModel: string,
): { record: ConversationRecord; messages: unknown[] } | null {
  if (!value || typeof value !== "object") return null;
  const obj = value as Record<string, unknown>;
  const key = typeof obj.key === "string" || typeof obj.key === "number" ? String(obj.key) : "";
  if (!key.trim() || key.length > 200) return null;
  const messages = Array.isArray(obj.messages) ? obj.messages : [];
  const updatedAt =
    typeof obj.updatedAt === "number" && Number.isFinite(obj.updatedAt)
      ? obj.updatedAt
      : (timestampFromKey(key) ?? Date.now());
  const label = typeof obj.label === "string" ? obj.label : "";
  const record = parseConversationRecord(key.trim(), {
    title: label === "默认对话" ? titleFromMessages(messages) : label,
    pinned: obj.group === "置顶",
    agentId: obj.agentId,
    modelId: typeof obj.modelId === "string" && obj.modelId ? obj.modelId : currentModel,
    providerSessionId: obj.providerSessionId,
    projectPath: obj.projectPath,
    systemPrompt: obj.systemPrompt,
    lastError: obj.lastError,
    queuePaused: obj.queuePaused,
    queuedMessages: obj.queuedMessages,
    createdAt: timestampFromKey(key) ?? updatedAt,
    updatedAt,
  });
  return { record, messages: settledMessages(messages) };
}

/**
 * @description 展开旧版项目目录历史：新版是字符串数组，更早版本按 agent 分组。
 * @param {unknown} value - 旧目录数据
 * @returns {string[]} 目录列表（保持原顺序）
 */
function legacyProjectPaths(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (!value || typeof value !== "object") return [];
  return Object.values(value as Record<string, unknown>).flatMap((list) =>
    Array.isArray(list) ? list.filter((item): item is string => typeof item === "string") : [],
  );
}

/**
 * @description 按「缺失才写入」规则把旧数据合并进数据库（单个事务）。
 * @param {WorkspaceStore} store - 工作区存储
 * @param {LegacyImportPayload} payload - 旧数据载荷
 * @returns {LegacyImportResult} 各类数据实际写入的条数
 */
export function importLegacyPayload(
  store: WorkspaceStore,
  payload: LegacyImportPayload,
): LegacyImportResult {
  const result = { ...EMPTY_RESULT };
  transaction(store.db, () => {
    const chatState =
      payload.chatState && typeof payload.chatState === "object"
        ? (payload.chatState as Record<string, unknown>)
        : null;
    const currentModel =
      typeof chatState?.currentModel === "string" ? chatState.currentModel.trim() : "";

    const conversations = Array.isArray(chatState?.conversationList)
      ? chatState.conversationList
      : [];
    for (const raw of conversations) {
      const converted = convertLegacyConversation(raw, currentModel);
      if (!converted) continue;
      const { record, messages } = converted;
      if (!store.conversations.insertIfAbsent(record)) continue;
      result.conversations += 1;
      if (record.agentId === "api" && messages.length > 0) {
        store.conversations.saveTranscript(record.key, messages);
        result.transcripts += 1;
      }
    }

    const paths = legacyProjectPaths(payload.projectPaths);
    const base = Date.now();
    paths.forEach((projectPath, index) => {
      if (store.projectPaths.insertIfAbsent(projectPath, base - index)) result.projectPaths += 1;
    });

    const providersFile = payload.providers as { providers?: unknown } | null | undefined;
    const providers = Array.isArray(providersFile?.providers) ? providersFile.providers : [];
    for (const raw of providers) {
      const provider = normalizeLegacyProvider(raw);
      if (provider && store.providers.insertIfAbsent(provider)) result.providers += 1;
    }

    const preferencePatch: Record<string, unknown> = {};
    if (typeof payload.activeAgentId === "string" && !store.preferences.has("activeAgentId")) {
      preferencePatch.activeAgentId = payload.activeAgentId;
    }
    if (payload.agentDefaultModels && !store.preferences.has("agentDefaultModels")) {
      preferencePatch.agentDefaultModels = payload.agentDefaultModels;
    }
    if (currentModel && !store.preferences.has("currentModel")) {
      preferencePatch.currentModel = currentModel;
    }
    const keys = Object.keys(preferencePatch);
    if (keys.length > 0) {
      store.preferences.update(parsePreferencesPatch(preferencePatch));
      result.preferences = keys.length;
    }
  });
  return result;
}

/**
 * @description 导入旧版网关 JSON 状态目录；导入后把目录改名留作备份，避免重复导入。
 * @param {WorkspaceStore} store - 工作区存储
 * @param {string} stateDir - 旧状态目录（`<数据根>/state`）
 * @returns {LegacyImportResult | null} 导入统计；目录不存在时为 null
 */
export function importLegacyStateDirectory(
  store: WorkspaceStore,
  stateDir: string,
): LegacyImportResult | null {
  if (!fs.existsSync(stateDir)) return null;
  const payload: LegacyImportPayload = {};
  for (const [fileName, field] of Object.entries(STATE_FILES)) {
    const file = path.join(stateDir, fileName);
    if (!fs.existsSync(file)) continue;
    try {
      const envelope = JSON.parse(fs.readFileSync(file, "utf8")) as { data?: unknown };
      payload[field] = envelope?.data;
    } catch (error) {
      console.warn(`[store] 跳过无法解析的旧状态文件 ${file}:`, error);
    }
  }
  const result = importLegacyPayload(store, payload);
  const backup = `${stateDir}.imported-${Date.now()}`;
  try {
    fs.renameSync(stateDir, backup);
  } catch (error) {
    console.warn(`[store] 旧状态目录改名失败（下次启动会再次尝试合并）:`, error);
  }
  return result;
}

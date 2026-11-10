/**
 * 会话索引存储（conversations + conversation_transcripts 表）。
 *
 * 会话正文由各 agent 自己的存储提供（Codex / Claude / Pi 的会话文件，按
 * providerSessionId 拉取），这里只保存索引与运行元数据；唯独 Model API 会话
 * 没有外部存储，其消息以 transcript 形式整体保存，打开会话时恢复。
 */
import {
  CONVERSATION_LIMITS,
  type ConversationRecord,
  type MessageAttachmentRef,
  type QueuedMessage,
} from "@cc-heart/open-chat-types";
import { GatewayError } from "../error";
import { parseJsonColumn, transaction, type Database } from "../db/database";

interface ConversationRow {
  key: string;
  title: string;
  pinned: number;
  agent_id: string;
  model_id: string;
  provider_session_id: string | null;
  project_path: string | null;
  system_prompt: string;
  last_error: string | null;
  queue_paused: number;
  queued_messages: string;
  created_at: number;
  updated_at: number;
  archived_at: number | null;
}

const DEFAULT_TITLE = "新对话";
const SHORT_TEXT_LIMIT = 500;
const ERROR_TEXT_LIMIT = 2000;

/**
 * @description 取可选字符串字段：去首尾空白并截断，空串与非字符串视为 null。
 * @param {unknown} value - 原始值
 * @param {number} limit - 最大长度
 * @returns {string | null} 规范化结果
 */
function optionalText(value: unknown, limit = SHORT_TEXT_LIMIT): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, limit);
  return trimmed || null;
}

/**
 * @description 取有限数字时间戳，否则返回回退值。
 * @param {unknown} value - 原始值
 * @param {number} fallback - 回退时间戳
 * @returns {number} epoch 毫秒
 */
function timestamp(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * @description 规范化附件引用列表，丢弃缺少引用或文件名的条目。
 * @param {unknown} value - 原始附件数组
 * @returns {MessageAttachmentRef[]} 合法附件
 */
function normalizeAttachments(value: unknown): MessageAttachmentRef[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const candidate = item as Record<string, unknown>;
    const reference = optionalText(candidate.reference, 300);
    const name = optionalText(candidate.name, 300);
    if (!reference || !name) return [];
    return [{ reference, name, isImage: candidate.isImage === true }];
  });
}

/**
 * @description 规范化排队消息：内容与附件都为空的条目被丢弃。
 * @param {unknown} value - 原始队列数组
 * @param {number} now - 缺少 createdAt 时的回退时间
 * @returns {QueuedMessage[]} 合法的排队消息
 */
function normalizeQueuedMessages(value: unknown, now: number): QueuedMessage[] {
  if (!Array.isArray(value)) return [];
  const messages: QueuedMessage[] = [];
  value.forEach((item, index) => {
    if (!item || typeof item !== "object") return;
    const candidate = item as Record<string, unknown>;
    const content =
      typeof candidate.content === "string"
        ? candidate.content.trim().slice(0, CONVERSATION_LIMITS.queuedContent)
        : "";
    const attachments = normalizeAttachments(candidate.attachments);
    if (!content && attachments.length === 0) return;
    messages.push({
      id: optionalText(candidate.id, 100) ?? `queued-${now}-${index}`,
      content,
      createdAt: timestamp(candidate.createdAt, now),
      ...(attachments.length ? { attachments } : {}),
    });
  });
  return messages.slice(0, CONVERSATION_LIMITS.queuedMessages);
}

/**
 * @description 校验会话 key：路由参数与旧数据导入共用。
 * @param {unknown} value - 原始 key
 * @returns {string} 合法 key
 * @throws {GatewayError} key 为空或过长时抛出 400
 */
export function parseConversationKey(value: unknown): string {
  const key = typeof value === "string" ? value.trim() : "";
  if (!key || key.length > CONVERSATION_LIMITS.key) {
    throw GatewayError.invalidRequest("会话 key 不能为空且不超过 200 个字符");
  }
  return key;
}

/**
 * @description 把请求体（或旧数据）规范化为完整的会话记录；缺失字段取默认值。
 * @param {string} key - 会话 key（来自路由参数）
 * @param {unknown} body - 会话字段
 * @param {number} now - 缺少时间戳时的回退值
 * @returns {ConversationRecord} 可直接写库的记录
 * @throws {GatewayError} 请求体不是对象时抛出 400
 */
export function parseConversationRecord(
  key: string,
  body: unknown,
  now = Date.now(),
): ConversationRecord {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw GatewayError.invalidRequest("请求体必须是 JSON 对象");
  }
  const obj = body as Record<string, unknown>;
  const updatedAt = timestamp(obj.updatedAt, now);
  return {
    key,
    title:
      (typeof obj.title === "string" ? obj.title.trim().slice(0, CONVERSATION_LIMITS.title) : "") ||
      DEFAULT_TITLE,
    pinned: obj.pinned === true,
    agentId: optionalText(obj.agentId, 100) ?? "api",
    modelId: optionalText(obj.modelId) ?? "",
    providerSessionId: optionalText(obj.providerSessionId),
    projectPath: optionalText(obj.projectPath),
    systemPrompt:
      typeof obj.systemPrompt === "string"
        ? obj.systemPrompt.slice(0, CONVERSATION_LIMITS.systemPrompt)
        : "",
    lastError: optionalText(obj.lastError, ERROR_TEXT_LIMIT),
    queuePaused: obj.queuePaused === true,
    queuedMessages: normalizeQueuedMessages(obj.queuedMessages, now),
    createdAt: timestamp(obj.createdAt, updatedAt),
    updatedAt,
  };
}

/**
 * @description 把数据库行转换为会话记录。
 * @param {ConversationRow} row - conversations 表的一行
 * @returns {ConversationRecord} 会话记录
 */
function rowToRecord(row: ConversationRow): ConversationRecord {
  return {
    key: row.key,
    title: row.title,
    pinned: row.pinned === 1,
    agentId: row.agent_id,
    modelId: row.model_id,
    providerSessionId: row.provider_session_id,
    projectPath: row.project_path,
    systemPrompt: row.system_prompt,
    lastError: row.last_error,
    queuePaused: row.queue_paused === 1,
    queuedMessages: parseJsonColumn<QueuedMessage[]>(row.queued_messages, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.archived_at != null ? { archivedAt: row.archived_at } : {}),
  };
}

export class ConversationStore {
  constructor(private readonly db: Database) {}

  /**
   * @description 列出会话（置顶优先，其余按更新时间倒序）；默认不含已归档。
   * @param {{ includeArchived?: boolean }} [options] - includeArchived：导出备份等全量场景使用
   * @returns {ConversationRecord[]} 会话列表
   */
  list(options: { includeArchived?: boolean } = {}): ConversationRecord[] {
    const sql = options.includeArchived
      ? `SELECT * FROM conversations
         ORDER BY pinned DESC, updated_at DESC, rowid DESC`
      : `SELECT * FROM conversations WHERE archived_at IS NULL
         ORDER BY pinned DESC, updated_at DESC, rowid DESC`;
    const rows = this.db.prepare(sql).all() as unknown as ConversationRow[];
    return rows.map(rowToRecord);
  }

  /**
   * @description 读取单个会话（含已归档）。
   * @param {string} key - 会话 key
   * @returns {ConversationRecord | null} 会话；不存在时为 null
   */
  get(key: string): ConversationRecord | null {
    const row = this.db.prepare("SELECT * FROM conversations WHERE key = ?").get(key) as unknown as
      | ConversationRow
      | undefined;
    return row ? rowToRecord(row) : null;
  }

  /**
   * @description 写入完整会话记录：不存在则新建，存在则覆盖可变字段（创建时间保持首次写入值）。
   * 重新写入已归档的会话会取消归档。
   * @param {ConversationRecord} record - 已规范化的记录
   * @returns {ConversationRecord} 写入后的记录
   */
  upsert(record: ConversationRecord): ConversationRecord {
    this.db
      .prepare(
        `INSERT INTO conversations (key, title, pinned, agent_id, model_id, provider_session_id,
           project_path, system_prompt, last_error, queue_paused,
           queued_messages, archived_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
         ON CONFLICT (key) DO UPDATE SET
           title = excluded.title,
           pinned = excluded.pinned,
           agent_id = excluded.agent_id,
           model_id = excluded.model_id,
           provider_session_id = excluded.provider_session_id,
           project_path = excluded.project_path,
           system_prompt = excluded.system_prompt,
           last_error = excluded.last_error,
           queue_paused = excluded.queue_paused,
           queued_messages = excluded.queued_messages,
           archived_at = NULL,
           updated_at = excluded.updated_at`,
      )
      .run(
        record.key,
        record.title,
        record.pinned ? 1 : 0,
        record.agentId,
        record.modelId,
        record.providerSessionId,
        record.projectPath,
        record.systemPrompt,
        record.lastError,
        record.queuePaused ? 1 : 0,
        JSON.stringify(record.queuedMessages),
        record.createdAt,
        record.updatedAt,
      );
    return this.get(record.key)!;
  }

  /**
   * @description 旧数据导入：会话不存在时写入，已存在时保留网关版本。
   * @param {ConversationRecord} record - 已规范化的记录
   * @returns {boolean} 实际写入时为 true
   */
  insertIfAbsent(record: ConversationRecord): boolean {
    if (this.db.prepare("SELECT 1 FROM conversations WHERE key = ?").get(record.key)) return false;
    this.upsert(record);
    return true;
  }

  /**
   * @description 归档会话：从列表隐藏但保留数据（transcript 一并保留）。
   * @param {string} key - 会话 key
   * @param {number} now - 归档时间
   * @returns {boolean} 会话存在时为 true
   */
  archive(key: string, now = Date.now()): boolean {
    const result = this.db
      .prepare("UPDATE conversations SET archived_at = ? WHERE key = ?")
      .run(now, key);
    return Number(result.changes) > 0;
  }

  /**
   * @description 删除会话（transcript 由外键级联删除）。
   * @param {string} key - 会话 key
   * @returns {boolean} 会话存在并已删除时为 true
   */
  delete(key: string): boolean {
    return Number(this.db.prepare("DELETE FROM conversations WHERE key = ?").run(key).changes) > 0;
  }

  /**
   * @description 清空全部会话（设置页「清空历史」）。
   * @returns {number} 删除的会话数量
   */
  deleteAll(): number {
    return transaction(this.db, () =>
      Number(this.db.prepare("DELETE FROM conversations").run().changes),
    );
  }

  /**
   * @description 读取 Model API 会话保存的消息。
   * @param {string} key - 会话 key
   * @returns {unknown[] | null} 消息数组；从未保存过时为 null
   */
  getTranscript(key: string): unknown[] | null {
    const row = this.db
      .prepare("SELECT messages FROM conversation_transcripts WHERE conversation_key = ?")
      .get(key) as { messages: string } | undefined;
    return row ? parseJsonColumn<unknown[]>(row.messages, []) : null;
  }

  /**
   * @description 整体替换会话的 transcript。
   * @param {string} key - 会话 key（会话必须已存在）
   * @param {unknown[]} messages - 消息数组
   * @param {number} now - 保存时间
   * @returns {void}
   * @throws {GatewayError} 序列化后超过大小上限时抛出 400
   * @throws {Error} 会话不存在时抛出外键约束错误（路由层映射为 409）
   */
  saveTranscript(key: string, messages: unknown[], now = Date.now()): void {
    const serialized = JSON.stringify(messages);
    if (Buffer.byteLength(serialized) > CONVERSATION_LIMITS.transcriptBytes) {
      throw GatewayError.invalidRequest("会话消息过大，超过 8 MB 上限");
    }
    this.db
      .prepare(
        `INSERT INTO conversation_transcripts (conversation_key, messages, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT (conversation_key) DO UPDATE SET
           messages = excluded.messages,
           updated_at = excluded.updated_at`,
      )
      .run(key, serialized, now);
  }

  /**
   * @description 统计未归档会话数量。
   * @returns {number} 会话数量
   */
  count(): number {
    return (
      this.db
        .prepare("SELECT COUNT(*) AS n FROM conversations WHERE archived_at IS NULL")
        .get() as {
        n: number;
      }
    ).n;
  }
}

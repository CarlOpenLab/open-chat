/**
 * ACP 会话索引（agent_sessions 表）。
 *
 * 网关只把「agent + sessionId + 归属会话 + 工作目录 + 标题 + 时间」记进 SQLite，
 * 会话正文仍在各 CLI 自己的存储里（`~/.claude/projects`、`~/.codex/sessions`、
 * `~/.pi|~/.omp`），需要渲染时按 id 读原生文件。这样既能在库里按 agent / 时间
 * 检索会话，又不用把第三方格式抄一遍。
 */
import type { Database } from "../db/database";

/** 会话来源：网关自己创建的，还是从 CLI 原生存储扫描入库的。 */
export type AgentSessionSource = "gateway" | "cli-file";

export interface AgentSessionRecord {
  agentId: string;
  sessionId: string;
  conversationId: string | null;
  cwd: string | null;
  title: string;
  source: AgentSessionSource;
  createdAt: number;
  updatedAt: number;
}

export interface AgentSessionRecordInput {
  agentId: string;
  sessionId: string;
  conversationId?: string | null;
  cwd?: string | null;
  title?: string;
  source?: AgentSessionSource;
  /** 显式时间戳（扫描 CLI 文件时用文件 mtime），缺省取当前时间。 */
  timestamp?: number;
}

/** 标题按字符截断，避免把整段提示词塞进索引。 */
const TITLE_LIMIT = 80;
/** 单次列表上限，防止误用一次取出全库。 */
const LIST_LIMIT_MAX = 2000;

interface AgentSessionRow {
  agent_id: string;
  session_id: string;
  conversation_id: string | null;
  cwd: string | null;
  title: string;
  source: AgentSessionSource;
  created_at: number;
  updated_at: number;
}

/**
 * @description 规范化标题：折叠空白（含换行）、去首尾、截断。
 * @param {string} value - 原始标题（通常是首条用户消息）
 * @returns {string} 可入库的标题
 */
export function normalizeSessionTitle(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, TITLE_LIMIT);
}

function toRecord(row: AgentSessionRow): AgentSessionRecord {
  return {
    agentId: row.agent_id,
    sessionId: row.session_id,
    conversationId: row.conversation_id,
    cwd: row.cwd,
    title: row.title,
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class AgentSessionStore {
  constructor(private readonly db: Database) {}

  /** 索引里的会话总数。 */
  count(): number {
    const row = this.db.prepare("SELECT count(*) AS n FROM agent_sessions").get() as { n: number };
    return row.n;
  }

  /**
   * @description 登记或更新一条会话索引。已存在时保留原 created_at，其余字段按传入值合并：
   * 空标题 / 空会话关联不覆盖已有值（网关重启后重复登记不会抹掉历史信息）。
   * @param {AgentSessionRecordInput} input - 索引字段
   * @returns {AgentSessionRecord} 落库后的记录
   */
  record(input: AgentSessionRecordInput): AgentSessionRecord {
    const now = input.timestamp ?? Date.now();
    const title = normalizeSessionTitle(input.title ?? "");
    this.db
      .prepare(
        `INSERT INTO agent_sessions
           (agent_id, session_id, conversation_id, cwd, title, source, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (agent_id, session_id) DO UPDATE SET
           conversation_id = COALESCE(excluded.conversation_id, agent_sessions.conversation_id),
           cwd             = COALESCE(excluded.cwd, agent_sessions.cwd),
           title           = CASE WHEN excluded.title <> '' THEN excluded.title
                                  ELSE agent_sessions.title END,
           updated_at      = MAX(excluded.updated_at, agent_sessions.updated_at)`,
      )
      .run(
        input.agentId,
        input.sessionId,
        input.conversationId ?? null,
        input.cwd ?? null,
        title,
        input.source ?? "gateway",
        now,
        now,
      );
    const record = this.get(input.agentId, input.sessionId);
    if (!record) throw new Error(`会话索引写入后读取失败：${input.agentId}/${input.sessionId}`);
    return record;
  }

  /**
   * @description 刷新活跃时间；可顺带补标题（仅在标题为空时写入）。
   * @param {string} agentId - agent id
   * @param {string} sessionId - provider session id
   * @param {string} title - 可选标题（首条用户消息）
   * @returns {void}
   */
  touch(agentId: string, sessionId: string, title?: string): void {
    const normalized = title ? normalizeSessionTitle(title) : "";
    this.db
      .prepare(
        `UPDATE agent_sessions SET
           updated_at = ?,
           title = CASE WHEN ? <> '' AND title = '' THEN ? ELSE title END
         WHERE agent_id = ? AND session_id = ?`,
      )
      .run(Date.now(), normalized, normalized, agentId, sessionId);
  }

  get(agentId: string, sessionId: string): AgentSessionRecord | null {
    const row = this.db
      .prepare("SELECT * FROM agent_sessions WHERE agent_id = ? AND session_id = ?")
      .get(agentId, sessionId) as AgentSessionRow | undefined;
    return row ? toRecord(row) : null;
  }

  /**
   * @description 按更新时间倒序列出会话索引。
   * @param {{ agentId?: string; limit?: number }} options - agent 过滤与条数上限
   * @returns {AgentSessionRecord[]} 会话索引列表
   */
  list(options: { agentId?: string; limit?: number } = {}): AgentSessionRecord[] {
    const limit = Math.min(Math.max(options.limit ?? 200, 1), LIST_LIMIT_MAX);
    const rows = (options.agentId
      ? this.db
          .prepare(
            `SELECT * FROM agent_sessions WHERE agent_id = ?
               ORDER BY updated_at DESC LIMIT ?`,
          )
          .all(options.agentId, limit)
      : this.db
          .prepare("SELECT * FROM agent_sessions ORDER BY updated_at DESC LIMIT ?")
          .all(limit)) as unknown as AgentSessionRow[];
    return rows.map(toRecord);
  }

  remove(agentId: string, sessionId: string): boolean {
    const result = this.db
      .prepare("DELETE FROM agent_sessions WHERE agent_id = ? AND session_id = ?")
      .run(agentId, sessionId);
    return result.changes > 0;
  }
}

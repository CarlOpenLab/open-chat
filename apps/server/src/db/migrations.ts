/**
 * Schema 迁移：数组下标 i 的脚本把数据库从版本 i 升到 i+1。
 * 只追加、不修改已发布的脚本——用户本机数据库按 user_version 逐个补齐。
 */
export const MIGRATIONS: readonly string[] = [
  // v1：任务 / 会话索引 / Model API transcript / 服务商 / 项目目录历史 / 偏好
  `
  CREATE TABLE tasks (
    id           TEXT PRIMARY KEY,
    title        TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'todo'
                 CHECK (status IN ('todo', 'doing', 'review', 'done', 'archived')),
    priority     TEXT CHECK (priority IS NULL OR priority IN ('P0', 'P1', 'P2', 'P3')),
    tags         TEXT NOT NULL DEFAULT '[]',
    due_at       INTEGER,
    description  TEXT NOT NULL DEFAULT '',
    project_path TEXT,
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL
  );
  CREATE INDEX tasks_updated_idx ON tasks (updated_at DESC);

  CREATE TABLE conversations (
    key                 TEXT PRIMARY KEY,
    title               TEXT NOT NULL DEFAULT '新对话',
    pinned              INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
    agent_id            TEXT NOT NULL DEFAULT 'api',
    model_id            TEXT NOT NULL DEFAULT '',
    provider_session_id TEXT,
    project_path        TEXT,
    system_prompt       TEXT NOT NULL DEFAULT '',
    task_id             TEXT REFERENCES tasks (id) ON DELETE SET NULL,
    status_override     TEXT,
    last_error          TEXT,
    queue_paused        INTEGER NOT NULL DEFAULT 0 CHECK (queue_paused IN (0, 1)),
    queued_messages     TEXT NOT NULL DEFAULT '[]',
    archived_at         INTEGER,
    created_at          INTEGER NOT NULL,
    updated_at          INTEGER NOT NULL
  );
  CREATE INDEX conversations_task_idx ON conversations (task_id);
  CREATE INDEX conversations_updated_idx ON conversations (updated_at DESC);

  CREATE TABLE conversation_transcripts (
    conversation_key TEXT PRIMARY KEY REFERENCES conversations (key) ON DELETE CASCADE,
    messages         TEXT NOT NULL,
    updated_at       INTEGER NOT NULL
  );

  CREATE TABLE providers (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    base_url   TEXT NOT NULL,
    api        TEXT NOT NULL DEFAULT 'chat/completions'
               CHECK (api IN ('chat/completions', 'responses')),
    api_key    TEXT NOT NULL DEFAULT '',
    models     TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE project_paths (
    path         TEXT PRIMARY KEY,
    last_used_at INTEGER NOT NULL
  );

  CREATE TABLE preferences (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  `,
];

/// <reference types="vite-plus/test/globals" />

import { openDatabase } from "../db/database";
import { MIGRATIONS } from "../db/migrations";
import { AgentSessionStore, normalizeSessionTitle } from "./agentSessions";
import { AttachmentIndexStore } from "./attachments";

/** 最小附件元数据。 */
const attachment = (id: string, fields: Record<string, unknown> = {}) => ({
  id,
  name: `${id}.png`,
  path: `/data/attachments/${id}/${id}.png`,
  size: 1024,
  isImage: true,
  ...fields,
});

describe("AttachmentIndexStore", () => {
  let db: ReturnType<typeof openDatabase>;
  let index: AttachmentIndexStore;

  beforeEach(() => {
    db = openDatabase(":memory:");
    index = new AttachmentIndexStore(db);
  });

  afterEach(() => {
    db.close();
  });

  it("records metadata and keeps the first createdAt on re-record", () => {
    const first = index.record(attachment("a1", { timestamp: 1000 }));
    expect(first.createdAt).toBe(1000);
    expect(first.size).toBe(1024);

    const again = index.record(attachment("a1", { size: 2048, timestamp: 5000 }));
    expect(again.createdAt).toBe(1000);
    expect(again.size).toBe(2048);
    expect(again.lastUsedAt).toBe(5000);
    expect(index.count()).toBe(1);
  });

  it("sums stored bytes and lists by recent use", () => {
    index.record(attachment("a1", { size: 100, timestamp: 1000 }));
    index.record(attachment("a2", { size: 250, timestamp: 2000 }));
    expect(index.totalBytes()).toBe(350);
    expect(index.list().map((item) => item.id)).toEqual(["a2", "a1"]);
  });

  it("prunes rows whose file is gone", () => {
    index.record(attachment("keep"));
    index.record(attachment("gone"));
    const removed = index.pruneMissing((filePath) => filePath.includes("keep"));
    expect(removed).toBe(1);
    expect(index.get("gone")).toBeNull();
    expect(index.get("keep")).not.toBeNull();
  });
});

describe("AgentSessionStore", () => {
  let db: ReturnType<typeof openDatabase>;
  let sessions: AgentSessionStore;

  beforeEach(() => {
    db = openDatabase(":memory:");
    sessions = new AgentSessionStore(db);
  });

  afterEach(() => {
    db.close();
  });

  it("records a gateway session with its conversation and cwd", () => {
    const record = sessions.record({
      agentId: "claude",
      sessionId: "s1",
      conversationId: "c1",
      cwd: "/data/dev/own/open-chat",
      source: "gateway",
      timestamp: 1000,
    });
    expect(record).toMatchObject({
      agentId: "claude",
      sessionId: "s1",
      conversationId: "c1",
      cwd: "/data/dev/own/open-chat",
      source: "gateway",
      title: "",
      createdAt: 1000,
      updatedAt: 1000,
    });
  });

  it("does not wipe title / conversation when re-recorded with empty values", () => {
    sessions.record({
      agentId: "claude",
      sessionId: "s1",
      conversationId: "c1",
      title: "首条消息",
      timestamp: 1000,
    });
    sessions.record({ agentId: "claude", sessionId: "s1", timestamp: 9000 });
    const record = sessions.get("claude", "s1");
    expect(record?.title).toBe("首条消息");
    expect(record?.conversationId).toBe("c1");
    expect(record?.updatedAt).toBe(9000);
  });

  it("fills the title from the first turn and keeps it afterwards", () => {
    sessions.record({ agentId: "codex", sessionId: "s2", timestamp: 1000 });
    sessions.touch("codex", "s2", "  修复   登录页\n样式 ");
    expect(sessions.get("codex", "s2")?.title).toBe("修复 登录页 样式");
    sessions.touch("codex", "s2", "第二条消息");
    expect(sessions.get("codex", "s2")?.title).toBe("修复 登录页 样式");
  });

  it("filters by agent and orders by recent activity", () => {
    sessions.record({ agentId: "claude", sessionId: "a", timestamp: 1000 });
    sessions.record({ agentId: "claude", sessionId: "b", timestamp: 3000 });
    sessions.record({ agentId: "codex", sessionId: "c", timestamp: 2000 });
    expect(sessions.list({ agentId: "claude" }).map((item) => item.sessionId)).toEqual(["b", "a"]);
    expect(sessions.list().map((item) => item.sessionId)).toEqual(["b", "c", "a"]);
    expect(sessions.count()).toBe(3);
  });

  it("removes a session index row", () => {
    sessions.record({ agentId: "claude", sessionId: "s1" });
    expect(sessions.remove("claude", "s1")).toBe(true);
    expect(sessions.remove("claude", "s1")).toBe(false);
  });

  it("truncates long titles to keep the index small", () => {
    expect(normalizeSessionTitle("字".repeat(200))).toHaveLength(80);
  });
});

describe("schema v2", () => {
  it("adds attachment and agent session tables on upgrade", () => {
    const db = openDatabase(":memory:");
    const tables = (
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all() as unknown as { name: string }[]
    ).map((row) => row.name);
    expect(tables).toContain("attachments");
    expect(tables).toContain("agent_sessions");
    expect(MIGRATIONS.length).toBeGreaterThanOrEqual(2);
    db.close();
  });
});

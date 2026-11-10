/// <reference types="vite-plus/test/globals" />

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { migrate, schemaVersion } from "../db/database";
import { MIGRATIONS } from "../db/migrations";
import { GatewayError } from "../error";
import { parseConversationRecord } from "./conversations";
import { importLegacyPayload, importLegacyStateDirectory } from "./legacyImport";
import { parsePreferencesPatch } from "./preferences";
import { parseProviderInput, toProviderView } from "./providers";
import { WorkspaceStore } from "./workspace";

/** 构造一条最小会话记录。 */
const conversation = (key: string, fields: Record<string, unknown> = {}) =>
  parseConversationRecord(key, { title: `会话 ${key}`, updatedAt: 1000, ...fields });

describe("WorkspaceStore", () => {
  let store: WorkspaceStore;

  beforeEach(() => {
    store = WorkspaceStore.open(":memory:");
  });

  afterEach(() => {
    store.close();
  });

  describe("schema", () => {
    it("migrates a fresh database to the latest version and is idempotent", () => {
      expect(schemaVersion(store.db)).toBe(MIGRATIONS.length);
      expect(migrate(store.db)).toBe(MIGRATIONS.length);
    });
  });

  describe("conversations", () => {
    it("upserts, keeps createdAt and lists pinned first", () => {
      store.conversations.upsert(conversation("a", { updatedAt: 3000 }));
      store.conversations.upsert(conversation("b", { updatedAt: 2000, pinned: true }));
      store.conversations.upsert(conversation("a", { title: "改名", updatedAt: 4000 }));
      const list = store.conversations.list();
      expect(list.map((item) => item.key)).toEqual(["b", "a"]);
      expect(list[1]).toMatchObject({ title: "改名", createdAt: 3000, updatedAt: 4000 });
    });

    it("exportAll includes archived conversations with archivedAt while list hides them", () => {
      store.conversations.upsert(conversation("c-live"));
      store.conversations.upsert(conversation("c-archived"));
      store.conversations.archive("c-archived", 2000);
      expect(store.conversations.list().map((c) => c.key)).toEqual(["c-live"]);
      const all = store.conversations.list({ includeArchived: true });
      expect(all.map((c) => c.key).sort()).toEqual(["c-archived", "c-live"]);
      expect(all.find((c) => c.key === "c-archived")?.archivedAt).toBe(2000);
      expect(store.conversations.get("c-archived")?.archivedAt).toBe(2000);
      const exported = store.exportAll();
      expect(exported.conversations.map((c) => c.key).sort()).toEqual(["c-archived", "c-live"]);
    });

    it("normalizes queued messages and drops empty ones", () => {
      const record = parseConversationRecord("q", {
        queuePaused: true,
        queuedMessages: [
          { id: "m1", content: " 继续 ", createdAt: 5 },
          { id: "m2", content: "  " },
          {
            content: "",
            attachments: [{ reference: "cc-attachment:x", name: "a.png", isImage: true }],
          },
        ],
      });
      expect(record.queuedMessages).toHaveLength(2);
      expect(record.queuedMessages[0]).toEqual({ id: "m1", content: "继续", createdAt: 5 });
      expect(store.conversations.upsert(record).queuedMessages).toEqual(record.queuedMessages);
    });

    it("stores transcripts and cascades them on delete", () => {
      store.conversations.upsert(conversation("api-1"));
      expect(store.conversations.getTranscript("api-1")).toBeNull();
      store.conversations.saveTranscript("api-1", [{ id: "u1", message: { role: "user" } }]);
      expect(store.conversations.getTranscript("api-1")).toHaveLength(1);
      expect(store.conversations.delete("api-1")).toBe(true);
      expect(store.conversations.getTranscript("api-1")).toBeNull();
      expect(() => store.conversations.saveTranscript("missing", [])).toThrow(/FOREIGN KEY/);
    });

    it("deleteAll removes every conversation", () => {
      store.conversations.upsert(conversation("c1"));
      expect(store.conversations.deleteAll()).toBe(1);
      expect(store.conversations.list()).toEqual([]);
    });
  });

  describe("providers", () => {
    it("never exposes the plain key and keeps it when updating with an empty key", () => {
      const plainKey = ["plain", "text", "provider", "key"].join("-");
      const created = store.providers.create(
        parseProviderInput(
          { name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", apiKey: plainKey },
          "create",
        ),
      );
      const view = toProviderView(created);
      expect(view).toMatchObject({
        hasKey: true,
        apiKeyMasked: `${plainKey.slice(0, 4)}…${plainKey.slice(-4)}`,
      });
      expect(JSON.stringify(view)).not.toContain(plainKey);

      const updated = store.providers.update(
        created.id,
        parseProviderInput({ name: "OR", apiKey: "" }, "update"),
      );
      expect(updated).toMatchObject({ name: "OR", apiKey: plainKey });
    });

    it("validates create input", () => {
      expect(() => parseProviderInput({ name: "x", baseUrl: "ftp://x" }, "create")).toThrow(
        GatewayError,
      );
      expect(() => parseProviderInput({ baseUrl: "https://x" }, "create")).toThrow(GatewayError);
      expect(parseProviderInput({ models: [{ id: "m" }, { id: "m" }, {}] }, "update")).toEqual({
        models: [{ id: "m" }],
      });
    });
  });

  describe("project paths", () => {
    it("keeps most recent first, dedupes normalized paths and caps at 20", () => {
      store.projectPaths.remember("/a/", 1);
      store.projectPaths.remember("/b", 2);
      expect(store.projectPaths.remember("/a", 3)).toEqual(["/a", "/b"]);
      for (let i = 0; i < 25; i += 1) store.projectPaths.remember(`/p${i}`, 10 + i);
      const list = store.projectPaths.list();
      expect(list).toHaveLength(20);
      expect(list[0]).toBe("/p24");
      expect(store.projectPaths.forget("/p24")[0]).toBe("/p23");
    });
  });

  describe("preferences", () => {
    it("returns defaults and merges patches", () => {
      expect(store.preferences.get()).toEqual({
        activeAgentId: "",
        agentDefaultModels: {},
        currentModel: "",
      });
      store.preferences.update(parsePreferencesPatch({ activeAgentId: "codex" }));
      const next = store.preferences.update(
        parsePreferencesPatch({ agentDefaultModels: { codex: "gpt-5", bad: 1 } }),
      );
      expect(next).toMatchObject({
        activeAgentId: "codex",
        agentDefaultModels: { codex: "gpt-5" },
      });
      expect(() => parsePreferencesPatch({ theme: "dark" })).toThrow(GatewayError);
    });
  });

  describe("legacy import", () => {
    const legacyPayload = () => ({
      chatState: {
        version: 2,
        currentConversationKey: "",
        currentModel: "gpt-4o",
        conversationList: [
          {
            key: "1760000000000-abc",
            label: "API 会话",
            group: "置顶",
            agentId: "api",
            messages: [
              { id: "u1", status: "local", message: { role: "user", content: "你好" } },
              { id: "a1", status: "updating", message: { role: "assistant", content: "…" } },
            ],
          },
          { key: "acp:codex:1760000000001-def", label: "默认对话", agentId: "codex" },
        ],
      },
      projectPaths: { codex: ["/repo/a/", "/repo/b"] },
      providers: {
        version: 1,
        providers: [{ id: "p1", name: "OR", baseUrl: "https://x.ai/v1", apiKey: "k", models: [] }],
      },
      activeAgentId: "codex",
    });

    it("merges every legacy category and is idempotent", () => {
      const first = importLegacyPayload(store, legacyPayload());
      expect(first).toEqual({
        conversations: 2,
        transcripts: 1,
        providers: 1,
        projectPaths: 2,
        preferences: 2,
      });

      const [pinned, other] = store.conversations.list();
      expect(pinned).toMatchObject({ key: "1760000000000-abc", pinned: true, modelId: "gpt-4o" });
      expect(other).toMatchObject({ title: "新对话", createdAt: 1760000000001 });
      expect(store.conversations.getTranscript(pinned.key)).toHaveLength(1);
      expect(store.projectPaths.list()).toEqual(["/repo/a", "/repo/b"]);
      expect(store.preferences.get()).toMatchObject({
        activeAgentId: "codex",
        currentModel: "gpt-4o",
      });

      expect(importLegacyPayload(store, legacyPayload())).toEqual({
        conversations: 0,
        transcripts: 0,
        providers: 0,
        projectPaths: 0,
        preferences: 0,
      });
    });

    it("never overwrites data that already exists in the gateway", () => {
      store.preferences.update({ activeAgentId: "claude" });
      importLegacyPayload(store, legacyPayload());
      expect(store.preferences.get().activeAgentId).toBe("claude");
    });

    it("imports a legacy state directory once and renames it as a backup", () => {
      const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "open-chat-legacy-"));
      try {
        const stateDir = path.join(dataDir, "state");
        fs.mkdirSync(stateDir);
        const write = (name: string, data: unknown) =>
          fs.writeFileSync(path.join(stateDir, name), JSON.stringify({ updatedAt: 1, data }));
        write("project-paths.json", ["/x"]);
        fs.writeFileSync(path.join(stateDir, "chat-state.json"), "not-json{{");

        expect(importLegacyStateDirectory(store, stateDir)).toMatchObject({
          projectPaths: 1,
        });
        expect(fs.existsSync(stateDir)).toBe(false);
        expect(fs.readdirSync(dataDir).some((name) => name.startsWith("state.imported-"))).toBe(
          true,
        );
        expect(importLegacyStateDirectory(store, stateDir)).toBeNull();
      } finally {
        fs.rmSync(dataDir, { recursive: true, force: true });
      }
    });
  });

  describe("info and export", () => {
    it("reports counts and exports without plain provider keys", () => {
      store.conversations.upsert(conversation("c1"));
      store.conversations.saveTranscript("c1", [{ id: "x" }]);
      const plainKey = ["export", "secret", "value"].join("-");
      store.providers.create(
        parseProviderInput({ name: "P", baseUrl: "https://p.ai", apiKey: plainKey }, "create"),
      );
      expect(store.info().counts).toEqual({
        conversations: 1,
        providers: 1,
        projectPaths: 0,
      });
      const exported = store.exportAll();
      expect(exported.transcripts).toEqual({ c1: [{ id: "x" }] });
      expect(JSON.stringify(exported)).not.toContain(plainKey);
    });
  });
});

describe("WorkspaceStore on disk", () => {
  it("persists across reopen", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "open-chat-db-"));
    const file = path.join(dir, "open-chat.db");
    try {
      const first = WorkspaceStore.open(file);
      first.conversations.upsert(conversation("persisted"));
      first.close();
      const second = WorkspaceStore.open(file);
      expect(second.conversations.list().map((item) => item.key)).toEqual(["persisted"]);
      expect(second.info().sizeBytes).toBeGreaterThan(0);
      second.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

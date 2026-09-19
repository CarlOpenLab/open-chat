/// <reference types="vite-plus/test/globals" />

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isAllowedStateName, readState, writeState, deleteState } from "./stateStore";

describe("stateStore", () => {
  let dataDir: string;
  const originalEnv = process.env.OPEN_CHAT_DATA_DIR;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "open-chat-state-test-"));
    process.env.OPEN_CHAT_DATA_DIR = dataDir;
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.OPEN_CHAT_DATA_DIR;
    else process.env.OPEN_CHAT_DATA_DIR = originalEnv;
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("rejects names outside the whitelist", () => {
    expect(isAllowedStateName("tasks")).toBe(true);
    expect(isAllowedStateName("../secrets")).toBe(false);
    expect(isAllowedStateName("chat-state")).toBe(true);
    expect(() => writeState("../secrets", {})).toThrow();
    expect(readState("../secrets")).toBeNull();
  });

  it("round-trips state under the data root state dir", () => {
    const envelope = writeState("tasks", [{ id: "t1", title: "任务" }]);
    expect(envelope.updatedAt).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(dataDir, "state", "tasks.json"))).toBe(true);

    const loaded = readState("tasks");
    expect(loaded?.data).toEqual([{ id: "t1", title: "任务" }]);
    expect(loaded?.updatedAt).toBe(envelope.updatedAt);
  });

  it("overwrites state; delete removes the file entirely", () => {
    writeState("chat-state", { version: 2 });
    writeState("chat-state", { version: 3 });
    expect(readState("chat-state")?.data).toEqual({ version: 3 });

    deleteState("chat-state");
    expect(readState("chat-state")).toBeNull();
    // 删除后可重新写入（客户端迁移/重建依赖这个语义）
    writeState("chat-state", { version: 4 });
    expect(readState("chat-state")?.data).toEqual({ version: 4 });
  });

  it("returns null for missing or corrupted files", () => {
    expect(readState("task-filters")).toBeNull();
    fs.mkdirSync(path.join(dataDir, "state"), { recursive: true });
    fs.writeFileSync(path.join(dataDir, "state", "task-filters.json"), "not-json{{");
    expect(readState("task-filters")).toBeNull();
  });
});

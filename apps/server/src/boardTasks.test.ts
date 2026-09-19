/// <reference types="vite-plus/test/globals" />

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  listBoardTasks,
  createBoardTask,
  patchBoardTask,
  deleteBoardTask,
  normalizeTask,
} from "./boardTasks";
import { readState } from "./stateStore";

describe("boardTasks", () => {
  let dataDir: string;
  const originalEnv = process.env.OPEN_CHAT_DATA_DIR;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "open-chat-board-tasks-test-"));
    process.env.OPEN_CHAT_DATA_DIR = dataDir;
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.OPEN_CHAT_DATA_DIR;
    else process.env.OPEN_CHAT_DATA_DIR = originalEnv;
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("starts empty; create assigns id/timestamps and defaults", () => {
    expect(listBoardTasks()).toEqual([]);
    const task = createBoardTask({ title: "修复登录页样式" });
    expect(task).not.toBeNull();
    expect(task!.id).toHaveLength(12);
    expect(task!.title).toBe("修复登录页样式");
    expect(task!.status).toBe("todo");
    expect(task!.priority).toBeNull();
    expect(task!.tags).toEqual([]);
    expect(task!.createdAt).toBeGreaterThan(0);
    expect(task!.updatedAt).toBe(task!.createdAt);
    // 与浏览器看板共享同一份 "tasks" 状态
    const envelope = readState("tasks");
    expect(envelope && Array.isArray(envelope.data)).toBe(true);
    expect(Array.isArray(envelope?.data) ? envelope.data.length : 0).toBe(1);
  });

  it("create rejects bodies without a title", () => {
    expect(createBoardTask({})).toBeNull();
    expect(createBoardTask({ status: "doing" })).toBeNull();
    expect(createBoardTask(null)).toBeNull();
    expect(createBoardTask("nope")).toBeNull();
  });

  it("create normalizes messy but valid fields", () => {
    const task = createBoardTask({
      title: "  任务  ",
      tags: [" x ", "x", 42, "", "a".repeat(40)],
      dueAt: -5,
      description: "d".repeat(9000),
      projectPath: "",
    })!;
    expect(task.title).toBe("任务");
    expect(task.status).toBe("todo");
    expect(task.priority).toBeNull();
    expect(task.tags).toEqual(["x", "a".repeat(30)]);
    expect(task.dueAt).toBeNull();
    expect(task.description).toHaveLength(8000);
    expect(task.projectPath).toBeNull();
  });

  it("create rejects invalid enum fields", () => {
    expect(createBoardTask({ title: "x", status: "bogus" })).toBeNull();
    expect(createBoardTask({ title: "x", priority: "P9" })).toBeNull();
  });

  it("patch updates only provided fields; id/createdAt immutable", () => {
    const task = createBoardTask({ title: "原始" })!;
    const patched = patchBoardTask(task.id, {
      title: "改名",
      status: "doing",
      priority: "P1",
      dueAt: 1789790000000,
      tags: ["bug"],
    });
    expect(patched).toMatchObject({
      id: task.id,
      title: "改名",
      status: "doing",
      priority: "P1",
      dueAt: 1789790000000,
      tags: ["bug"],
      description: "",
      createdAt: task.createdAt,
    });
    expect((patched as { updatedAt: number }).updatedAt).toBeGreaterThanOrEqual(task.updatedAt);
    expect(listBoardTasks()).toHaveLength(1);
  });

  it("patch returns undefined for unknown id and null for invalid body", () => {
    const task = createBoardTask({ title: "x" })!;
    expect(patchBoardTask("missing-id", { title: "y" })).toBeUndefined();
    expect(patchBoardTask(task.id, { status: "nope" })).toBeNull();
    expect(patchBoardTask(task.id, "junk")).toBeNull();
    expect(listBoardTasks()[0].title).toBe("x");
  });

  it("delete removes the task and reports unknown ids", () => {
    const a = createBoardTask({ title: "A" })!;
    const b = createBoardTask({ title: "B" })!;
    expect(deleteBoardTask(a.id)).toBe(true);
    expect(listBoardTasks().map((t) => t.id)).toEqual([b.id]);
    expect(deleteBoardTask(a.id)).toBe(false);
  });

  it("normalizeTask drops records without an id", () => {
    expect(normalizeTask({ title: "no id" })).toBeNull();
    expect(normalizeTask(null)).toBeNull();
  });

  it("sorts by updatedAt desc", () => {
    const a = createBoardTask({ title: "A" })!;
    patchBoardTask(a.id, { title: "A2" });
    const c = createBoardTask({ title: "C" })!;
    const ids = listBoardTasks().map((t) => t.id);
    expect(ids[0]).toBe(c.id); // 最新 updatedAt 排最前
    expect(ids).toContain(a.id);
  });
});

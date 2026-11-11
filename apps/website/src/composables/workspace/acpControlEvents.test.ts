/// <reference types="vite-plus/test/globals" />

import type { PermissionRequest } from "../../services/OpenChatProvider";
import { createAcpControlEventRouter } from "./acpControlEvents";

const permission: PermissionRequest = {
  id: "perm-1",
  version: "acp",
  agentId: "claude",
  permission: "bash",
  patterns: ["rm -rf dist"],
  metadata: { title: "rm -rf dist" },
  options: [{ optionId: "allow_once", name: "允许一次", kind: "allow_once" }],
};

describe("createAcpControlEventRouter", () => {
  it("把 chat_permission 交给权限回调，并标记事件已消费", () => {
    const received: PermissionRequest[] = [];
    const route = createAcpControlEventRouter({
      onPermission: (request) => received.push(request),
    });

    const consumed = route("chat_permission", JSON.stringify(permission));

    expect(consumed).toBe(true);
    expect(received).toEqual([permission]);
  });

  it("不消费正文事件，让它们继续进入 transformMessage", () => {
    let called = false;
    const route = createAcpControlEventRouter({
      onPermission: () => {
        called = true;
      },
    });

    expect(route("native_event", JSON.stringify({ type: "content.delta" }))).toBe(false);
    expect(route(null, "")).toBe(false);
    expect(called).toBe(false);
  });

  it("消费畸形的 chat_permission 但不触发权限回调", () => {
    let called = false;
    const route = createAcpControlEventRouter({
      onPermission: () => {
        called = true;
      },
    });

    expect(route("chat_permission", "not-json")).toBe(true);
    expect(route("chat_permission", JSON.stringify({ version: "acp" }))).toBe(true);
    expect(called).toBe(false);
  });

  it("把 chat_question 交给提问回调，并消费事件", () => {
    const received: unknown[] = [];
    const route = createAcpControlEventRouter({
      onPermission: () => {},
      onQuestion: (payload) => received.push(payload),
    });
    const payload = {
      id: "question-1",
      version: "acp",
      agentId: "claude",
      sessionId: "session-1",
      message: "Which codename?",
      requestedSchema: { type: "object", properties: {} },
    };

    expect(route("chat_question", JSON.stringify(payload))).toBe(true);
    expect(received).toEqual([payload]);
    expect(route("chat_question", "not-json")).toBe(true);
    expect(received).toHaveLength(1);
  });

  it("把 chat_question_resolved 交给撤销回调", () => {
    const resolved: Array<[string, string]> = [];
    const route = createAcpControlEventRouter({
      onPermission: () => {},
      onQuestionResolved: (id, reason) => resolved.push([id, reason]),
    });

    expect(
      route("chat_question_resolved", JSON.stringify({ id: "question-1", reason: "answered" })),
    ).toBe(true);
    expect(resolved).toEqual([["question-1", "answered"]]);
    expect(route("chat_question_resolved", JSON.stringify({ reason: "x" }))).toBe(true);
    expect(resolved).toHaveLength(1);
  });
});

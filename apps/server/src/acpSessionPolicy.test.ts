/// <reference types="vite-plus/test/globals" />

import type { SessionEvent } from "@cc-heart/acp-hub-core";
import { permissionModeToAcpMode, toChatQuestionPayload } from "./acpSessionPolicy";

const elicitation: Extract<SessionEvent, { type: "elicitation_request" }> = {
  type: "elicitation_request",
  requestId: "req-1",
  sessionId: "session-1",
  toolCallId: "call-1",
  mode: "form",
  message: "Which codename?",
  requestedSchema: {
    type: "object",
    properties: {
      question_0: {
        type: "string",
        title: "Codename",
        oneOf: [
          { const: "Alpha", title: "Alpha" },
          { const: "Beta", title: "Beta" },
        ],
      },
    },
  },
};

describe("permissionModeToAcpMode", () => {
  it("把 UI 权限档位映射到 ACP 会话模式", () => {
    expect(permissionModeToAcpMode("supervised")).toBe("default");
    expect(permissionModeToAcpMode("auto")).toBe("acceptEdits");
    expect(permissionModeToAcpMode("full")).toBe("bypassPermissions");
  });
});

describe("toChatQuestionPayload", () => {
  it("把可渲染的 form elicitation 转成前端问答卡负载", () => {
    const payload = toChatQuestionPayload(elicitation, {
      id: "question-1",
      agentId: "claude",
      sessionId: "session-1",
    });

    expect(payload).toEqual({
      id: "question-1",
      version: "acp",
      agentId: "claude",
      sessionId: "session-1",
      message: "Which codename?",
      requestedSchema: elicitation.requestedSchema,
      toolCallId: "call-1",
    });
  });

  it("忽略无法用表单渲染的 elicitation", () => {
    expect(
      toChatQuestionPayload(
        { type: "elicitation_request", requestId: "req-2", mode: "url", message: "Open it" },
        { id: "question-2", agentId: "claude", sessionId: "session-1" },
      ),
    ).toBeNull();

    expect(
      toChatQuestionPayload(
        { type: "elicitation_request", requestId: "req-3", mode: "form", message: "No schema" },
        { id: "question-3", agentId: "claude", sessionId: "session-1" },
      ),
    ).toBeNull();
  });
});

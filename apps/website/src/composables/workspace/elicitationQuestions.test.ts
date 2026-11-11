/// <reference types="vite-plus/test/globals" />

import type { QuestionnaireSubmission } from "@antdv-next/x-pro";
import { isQuestionPayload } from "./agentQuestions";
import {
  elicitationAnswerFromSubmission,
  questionnaireFromElicitation,
  type ElicitationQuestionPayload,
} from "./elicitationQuestions";

const singleSelect: ElicitationQuestionPayload = {
  id: "question-1",
  version: "acp",
  agentId: "claude",
  sessionId: "session-1",
  message: "Which codename should we use?",
  requestedSchema: {
    type: "object",
    properties: {
      question_0: {
        type: "string",
        title: "Codename",
        oneOf: [
          { const: "Alpha", title: "Alpha", description: "Use Alpha" },
          { const: "Beta", title: "Beta" },
        ],
      },
      question_0_custom: {
        type: "string",
        title: "Other",
        description: "Type your own answer",
      },
    },
  },
};

const multiSelect: ElicitationQuestionPayload = {
  id: "question-2",
  version: "acp",
  message: "What should this change cover?",
  requestedSchema: {
    type: "object",
    properties: {
      question_0: {
        type: "array",
        title: "Scope",
        items: {
          anyOf: [
            { const: "minimal", title: "Minimal" },
            { const: "tests", title: "Add tests" },
          ],
        },
      },
    },
  },
};

const submission = (
  answers: QuestionnaireSubmission["answers"],
  skipped: string[] = [],
): QuestionnaireSubmission => ({
  questionSetId: "question-1",
  revision: 1,
  answers,
  skipped,
  submissionId: "sub-1",
  submittedAt: "2026-11-11T00:00:00.000Z",
});

describe("questionnaireFromElicitation", () => {
  it("把单选 elicitation 转成可渲染的问卷，并识别每题的自由输入", () => {
    const payload = questionnaireFromElicitation(singleSelect);

    expect(payload).not.toBeNull();
    if (!payload) return;
    expect(payload.id).toBe("question-1");
    expect(payload.description).toBe("Which codename should we use?");
    expect(payload.questions).toHaveLength(1);
    expect(payload.questions[0]).toMatchObject({
      id: "question_0",
      title: "Codename",
      type: "single",
      allowCustom: true,
      customLabel: "Other",
      customPlaceholder: "Type your own answer",
    });
    expect(payload.questions[0].options?.map((option) => option.value)).toEqual(["Alpha", "Beta"]);
    expect(isQuestionPayload(payload)).toBe(true);
  });

  it("把多选 elicitation 转成多选问题", () => {
    const payload = questionnaireFromElicitation(multiSelect);

    expect(payload?.questions[0]).toMatchObject({
      id: "question_0",
      title: "Scope",
      type: "multiple",
      allowCustom: false,
    });
    expect(payload?.questions[0].options?.map((option) => option.value)).toEqual([
      "minimal",
      "tests",
    ]);
    expect(isQuestionPayload(payload)).toBe(true);
  });

  it("拒绝没有可渲染字段的请求", () => {
    expect(
      questionnaireFromElicitation({
        ...singleSelect,
        requestedSchema: { type: "object", properties: {} },
      }),
    ).toBeNull();
    expect(
      questionnaireFromElicitation({ ...singleSelect, requestedSchema: undefined as never }),
    ).toBeNull();
  });
});

describe("elicitationAnswerFromSubmission", () => {
  it("把单选答案与自由输入映射回 elicitation 字段", () => {
    const payload = questionnaireFromElicitation(singleSelect);
    if (!payload) throw new Error("expected payload");

    const answer = elicitationAnswerFromSubmission(
      submission({
        question_0: { selected: ["Alpha"], custom: "call it A" },
      }),
      payload,
    );

    expect(answer).toEqual({
      action: "accept",
      content: { question_0: "Alpha", question_0_custom: "call it A" },
    });
  });

  it("多选保留数组，全部跳过时回 decline", () => {
    const payload = questionnaireFromElicitation(multiSelect);
    if (!payload) throw new Error("expected payload");

    expect(
      elicitationAnswerFromSubmission(
        submission({ question_0: { selected: ["minimal", "tests"], custom: "" } }),
        payload,
      ),
    ).toEqual({
      action: "accept",
      content: { question_0: ["minimal", "tests"] },
    });

    expect(elicitationAnswerFromSubmission(submission({}, ["question_0"]), payload)).toEqual({
      action: "decline",
    });
  });
});

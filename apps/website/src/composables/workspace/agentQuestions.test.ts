/// <reference types="vite-plus/test/globals" />

import type { QuestionnaireSubmission } from "@antdv-next/x-pro";
import {
  createClarifyQuestionnaire,
  createQuestionCard,
  formatQuestionnaireAnswer,
  isQuestionPayload,
} from "./agentQuestions";

const submission = (
  answers: QuestionnaireSubmission["answers"],
  skipped: string[] = [],
): QuestionnaireSubmission => ({
  questionSetId: "open-chat-clarify",
  revision: 1,
  answers,
  skipped,
  submissionId: "sub-1",
  submittedAt: "2026-11-11T00:00:00.000Z",
});

describe("createClarifyQuestionnaire", () => {
  it("生成可提交的中文澄清问卷，revision 用于开启独立一轮", () => {
    const first = createClarifyQuestionnaire(1);
    const second = createClarifyQuestionnaire(2);
    expect(first.id).toBe("open-chat-clarify");
    expect(first.revision).toBe(1);
    expect(second.revision).toBe(2);
    expect(first.questions).toHaveLength(3);
    expect(first.submitLabel).toBe("发送需求");
    expect(first.allowSkip).toBe(true);
    expect(first.questions[0].allowCustom).toBe(true);
    expect(isQuestionPayload(first)).toBe(true);
  });
});

describe("isQuestionPayload", () => {
  it("拒绝非法与空问卷", () => {
    expect(isQuestionPayload(null)).toBe(false);
    expect(isQuestionPayload({ id: "x" })).toBe(false);
    expect(isQuestionPayload({ ...createClarifyQuestionnaire(), questions: [] })).toBe(false);
  });
});

describe("formatQuestionnaireAnswer", () => {
  it("把选中项映射成 option.label，并保留自定义文本", () => {
    const payload = createClarifyQuestionnaire();
    const text = formatQuestionnaireAnswer(
      submission({
        goal: { selected: ["feature"], custom: "做一个导出按钮" },
        scope: { selected: ["minimal", "tests"] },
        acceptance: { selected: ["ship"] },
      }),
      payload,
    );
    expect(text).toContain("1. 这次主要想达成什么？：实现新功能、做一个导出按钮");
    expect(text).toContain("2. 改动范围希望控制在？：最小改动、补充测试");
    expect(text).toContain("3. 怎样算做完了？：达到可上线质量");
  });

  it("显式跳过与未回答分别标注", () => {
    const payload = createClarifyQuestionnaire();
    const text = formatQuestionnaireAnswer(
      submission({ goal: { selected: [] } }, ["scope"]),
      payload,
    );
    expect(text).toContain("1. 这次主要想达成什么？：未回答");
    expect(text).toContain("2. 改动范围希望控制在？：跳过");
    expect(text).toContain("3. 怎样算做完了？：未回答");
  });
});

describe("createQuestionCard", () => {
  it("初始为 pending，且不携带提交记录", () => {
    const card = createQuestionCard(createClarifyQuestionnaire());
    expect(card.status).toBe("pending");
    expect(card.result).toBe("");
    expect(card.error).toBe("");
    expect(card.lastSubmission).toBeNull();
  });
});

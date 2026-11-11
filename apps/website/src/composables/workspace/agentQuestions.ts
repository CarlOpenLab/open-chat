/**
 * Agent 提问环节的数据模型与纯函数。
 *
 * 与权限审批（PermissionRequest / chat_permission）是两条独立链路：
 * - 权限审批由工具调用触发，回复走 `/api/chat/permission`，默认 full 模式自动批准；
 * - 提问卡由 `chat_question` SSE 事件或前端空状态入口触发，答案是结构化问卷，
 *   提交后原地保留回执，并整理成一条自然语言需求发回当前会话。
 *
 * UI 由 `@antdv-next/x-pro` 的 Questionnaire 承载（见 AgentQuestionCard.vue）。
 */
import { validateQuestionnaire } from "@antdv-next/x-pro";
import type {
  QuestionnairePayload,
  QuestionnaireQuestion,
  QuestionnaireStatus,
  QuestionnaireSubmission,
} from "@antdv-next/x-pro";

/** 一张提问卡的完整状态，按会话 key 存放；刷新不持久化（与审批请求一致）。 */
export interface QuestionCardState {
  payload: QuestionnairePayload;
  status: QuestionnaireStatus;
  result: string;
  error: string;
  /** 最近一次提交，供失败重试复用同一个 submissionId（幂等）。 */
  lastSubmission: QuestionnaireSubmission | null;
  /** agent：由服务端 elicitation 驱动；clarify：欢迎页自带的需求澄清问卷。 */
  source: "agent" | "clarify";
}

/** 运行时校验：SSE 事件带来的 payload 可能不完整；空题目列表也不渲染。 */
export function isQuestionPayload(value: unknown): value is QuestionnairePayload {
  const validation = validateQuestionnaire(value);
  return (
    validation.valid && !validation.empty && typeof (value as QuestionnairePayload).id === "string"
  );
}

export function createQuestionCard(
  payload: QuestionnairePayload,
  source: "agent" | "clarify" = "agent",
): QuestionCardState {
  return { payload, status: "pending", result: "", error: "", lastSubmission: null, source };
}

const CLARIFY_QUESTIONS: QuestionnaireQuestion[] = [
  {
    id: "goal",
    title: "这次主要想达成什么？",
    description: "选一个方向，或直接写一句话描述。",
    type: "single",
    options: [
      { value: "understand", label: "理解现有代码", description: "梳理结构、数据流与关键实现" },
      { value: "fix", label: "修复一个问题", description: "定位并修复 bug" },
      { value: "feature", label: "实现新功能", description: "按需求新增能力" },
      { value: "review", label: "评审改动", description: "检查近期改动的风险" },
    ],
    allowCustom: true,
    customLabel: "其他目标",
    customPlaceholder: "用一句话描述你想做的事",
    autoAdvance: false,
  },
  {
    id: "scope",
    title: "改动范围希望控制在？",
    description: "可多选，也可以整题跳过。",
    type: "multiple",
    required: false,
    minSelections: 0,
    options: [
      { value: "minimal", label: "最小改动" },
      { value: "refactor", label: "允许顺手重构" },
      { value: "tests", label: "补充测试" },
      { value: "docs", label: "同步文档" },
    ],
  },
  {
    id: "acceptance",
    title: "怎样算做完了？",
    type: "single",
    options: [
      { value: "runnable", label: "能跑通即可" },
      { value: "tested", label: "有测试覆盖" },
      { value: "ship", label: "达到可上线质量" },
    ],
    allowCustom: true,
    customLabel: "自己的验收标准",
    customPlaceholder: "例如：构建通过、无新增 lint 错误",
    autoAdvance: false,
  },
];

/**
 * 前端自带的「澄清需求」问卷。空状态入口触发，不需要服务端事件也能用起来；
 * revision 每次递增，保证新一轮问卷不会复用上一轮的回执与答案。
 */
export function createClarifyQuestionnaire(revision = 1): QuestionnairePayload {
  return {
    id: "open-chat-clarify",
    revision,
    title: "先确认几个问题",
    description: "回答后会整理成一条需求发给 Agent；也可以跳过，直接在输入框里说。",
    submitLabel: "发送需求",
    allowSkip: true,
    questions: CLARIFY_QUESTIONS,
  };
}

/** 结构化答案 → 发给 Agent 的自然语言需求（气泡里也保留这份可读文本）。 */
export function formatQuestionnaireAnswer(
  submission: QuestionnaireSubmission,
  payload: QuestionnairePayload,
): string {
  const lines: string[] = ["【需求确认】"];
  payload.questions.forEach((question, index) => {
    const answer = submission.answers[question.id];
    const parts: string[] = [];
    for (const value of answer?.selected ?? []) {
      const option = question.options?.find((item) => item.value === value);
      parts.push(option?.label ?? value);
    }
    const custom = answer?.custom?.trim();
    if (custom) parts.push(custom);
    const skipped = submission.skipped.includes(question.id);
    lines.push(
      `${index + 1}. ${question.title}：${skipped ? "跳过" : parts.join("、") || "未回答"}`,
    );
  });
  return lines.join("\n");
}

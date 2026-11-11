/**
 * ACP elicitation（`chat_question`）→ x-pro Questionnaire 的适配层。
 *
 * 服务端转发的是桥接原样的 form schema（字段名 `question_<n>` 与
 * `question_<n>_custom`）；这里把它翻译成问答卡的数据模型，并把用户提交的
 * 结构化答案映射回 elicitation content。字段名保留为题目 id，提交时无需再
 * 维护一张映射表。
 */
import type { QuestionnairePayload, QuestionnaireQuestion } from "@antdv-next/x-pro";

interface ElicitationEnumOption {
  const?: string;
  title?: string;
  description?: string;
}

interface ElicitationProperty {
  type?: string;
  title?: string;
  description?: string;
  oneOf?: ElicitationEnumOption[];
  items?: { anyOf?: ElicitationEnumOption[] };
}

/** 服务端 `chat_question` 事件负载。 */
export interface ElicitationQuestionPayload {
  id: string;
  version: string;
  agentId?: string;
  sessionId?: string;
  message: string;
  requestedSchema?: {
    type?: string;
    properties?: Record<string, ElicitationProperty>;
    required?: string[];
  };
  toolCallId?: string;
  metadata?: Record<string, unknown>;
}

export function isElicitationQuestionPayload(value: unknown): value is ElicitationQuestionPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as { id?: unknown; message?: unknown; requestedSchema?: unknown };
  return (
    typeof candidate.id === "string" &&
    candidate.id.length > 0 &&
    typeof candidate.message === "string" &&
    !!candidate.requestedSchema &&
    typeof candidate.requestedSchema === "object"
  );
}

const QUESTION_KEY = /^question_(\d+)$/;

const optionsOf = (property: ElicitationProperty): ElicitationEnumOption[] =>
  property.oneOf ?? property.items?.anyOf ?? [];

export function questionnaireFromElicitation(
  payload: ElicitationQuestionPayload,
): QuestionnairePayload | null {
  const properties = payload.requestedSchema?.properties ?? {};
  const keys = Object.keys(properties)
    .filter((key) => QUESTION_KEY.test(key))
    .sort(
      (a, b) => Number(QUESTION_KEY.exec(a)?.[1] ?? 0) - Number(QUESTION_KEY.exec(b)?.[1] ?? 0),
    );
  const questions: QuestionnaireQuestion[] = [];

  for (const key of keys) {
    const property = properties[key];
    const options = optionsOf(property);
    if (options.length === 0) continue;
    const multiple = property.type === "array";
    const customKey = `${key}_custom`;
    const custom = properties[customKey];
    const single = keys.length === 1;
    const title = single
      ? property.title || property.description || payload.message
      : property.description || property.title || `问题 ${questions.length + 1}`;
    const required = payload.requestedSchema?.required?.includes(key) ?? false;

    questions.push({
      id: key,
      title,
      ...(!single && property.description && property.title ? { description: property.title } : {}),
      type: multiple ? "multiple" : "single",
      required,
      ...(multiple ? { minSelections: required ? 1 : 0 } : {}),
      options: options
        .filter((option) => typeof option.const === "string" || typeof option.title === "string")
        .map((option) => ({
          value: option.const ?? option.title ?? "",
          label: option.title ?? option.const ?? "",
          ...(option.description ? { description: option.description } : {}),
        })),
      allowCustom: !!custom,
      ...(custom
        ? {
            customLabel: custom.title || "其他",
            customPlaceholder: custom.description || "输入自己的答案",
          }
        : {}),
      autoAdvance: false,
    });
  }

  if (questions.length === 0) return null;
  return {
    id: payload.id,
    revision: 1,
    title: "Agent 提问",
    description: payload.message || "Agent 想先确认几个问题。",
    submitLabel: "提交回答",
    allowSkip: true,
    questions,
  };
}

export type ElicitationAnswer =
  | { action: "accept"; content: Record<string, string | string[]> }
  | { action: "decline" };

/**
 * 把问卷提交映射回 elicitation content。全部题目都跳过时回 decline，
 * 桥接会把“用户跳过”告诉模型而不是中止回合。
 */
export function elicitationAnswerFromSubmission(
  submission: {
    answers: Record<string, { selected?: string[]; custom?: string } | undefined>;
  },
  payload: QuestionnairePayload,
): ElicitationAnswer {
  const content: Record<string, string | string[]> = {};
  for (const question of payload.questions) {
    const answer = submission.answers[question.id];
    const selected = answer?.selected ?? [];
    const custom = answer?.custom?.trim() ?? "";
    if (selected.length > 0) {
      content[question.id] = question.type === "multiple" ? [...selected] : selected[0];
    }
    if (custom) content[`${question.id}_custom`] = custom;
  }
  return Object.keys(content).length > 0 ? { action: "accept", content } : { action: "decline" };
}

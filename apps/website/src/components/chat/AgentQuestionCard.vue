<script setup lang="ts">
/**
 * Agent 提问卡：用 @antdv-next/x-pro 的 Questionnaire 收集结构化答案。
 *
 * 组件只负责数据收集，不发请求、不生成聊天气泡。生命周期状态由外层
 * （WorkspacePage → ChatMessages）受控下发，提交后原地保留回执，失败可复用
 * 同一 submissionId 重试。与权限审批面板互不干扰。
 */
import { computed, ref, watch } from "vue";
import { Questionnaire } from "@antdv-next/x-pro";
import type {
  QuestionnaireAnswers,
  QuestionnairePayload,
  QuestionnaireStatus,
  QuestionnaireStylesType,
  QuestionnaireSubmission,
} from "@antdv-next/x-pro";

interface Props {
  payload: QuestionnairePayload;
  status: QuestionnaireStatus;
  result?: string;
  error?: string;
  /** 会话不可用 / 正在提交时锁住卡片 */
  disabled?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  result: "",
  error: "",
  disabled: false,
});

const emit = defineEmits<{
  (e: "submit", submission: QuestionnaireSubmission): void;
  (e: "skip"): void;
  (e: "retry"): void;
  (e: "dismiss"): void;
}>();

const answers = ref<QuestionnaireAnswers>({});
const step = ref(0);
const identity = computed(() => `${props.payload.id}:${props.payload.revision}`);

// 新的 id / revision 是独立问卷，答案与题号必须清空（文档约定）。
watch(identity, () => {
  answers.value = {};
  step.value = 0;
});

/** 外层 section 已提供卡片外观，内层只保留内容与回执。 */
const questionnaireStyles: QuestionnaireStylesType = {
  root: {
    border: "none",
    background: "transparent",
    boxShadow: "none",
    padding: "0",
  },
};
</script>

<template>
  <section class="agent-question-card" aria-label="Agent 提问卡">
    <Questionnaire
      :key="identity"
      :payload="payload"
      v-model:answers="answers"
      v-model:step="step"
      :status="status"
      :result="result"
      :error="error"
      :disabled="disabled || status === 'submitting'"
      :dismissible="true"
      :styles="questionnaireStyles"
      @submit="emit('submit', $event)"
      @retry="emit('retry')"
      @skip="emit('skip')"
      @dismiss="emit('dismiss')"
    />
  </section>
</template>

<style scoped>
.agent-question-card {
  width: 100%;
  min-width: 0;
  border: 1px solid var(--brand-border);
  border-radius: 12px;
  background: var(--brand-surface);
  padding: 10px 12px;
  box-shadow: 0 6px 18px rgb(0 0 0 / 8%);
}

.agent-question-card :deep(*) {
  min-width: 0;
}
</style>

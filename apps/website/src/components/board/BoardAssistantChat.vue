<script setup lang="ts">
/**
 * 看板助手聊天面板（展示层）：头部（标题 + agent 选择 + 关闭）、消息流、
 * 工具执行计数、权限审批、输入区。
 * 会话状态与请求全部在容器（BoardAssistantDrawer）侧，本组件只做 props 入 / emit 出。
 */
import { Bubble, Sender } from "@antdv-next/x";
import { Bot, X } from "@lucide/vue";
import { Alert, Badge, Button, Empty, Flex, Select, Space, TypographyText } from "antdv-next";
import { computed, nextTick, ref, watch } from "vue";

/** 一条消息（与 useBoardAssistant 的 BoardAssistantMessage 同构）。 */
interface ChatMessage {
  role: "user" | "assistant" | "error";
  content: string;
  /** 流式接收中。 */
  streaming?: boolean;
}

/** 权限询问（与 services/boardAssistant 的 BoardAssistantPermission 同构）。 */
interface PendingPermission {
  id: string;
  title: string;
  options: Array<{ optionId: string; name: string; kind: string }>;
}

/** agent 下拉项（可用性过滤与标注由容器完成）。 */
interface AgentOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface Props {
  /** 输入框草稿（v-model）：由容器持有，关抽屉后不丢 */
  modelValue: string;
  /** 消息流 */
  messages: ChatMessage[];
  /** 回合进行中：发送键变停止，禁止再次提交 */
  running: boolean;
  /** 本回合已发生的工具调用数 */
  toolActivityCount: number;
  /** 待审批的权限询问；null 时不渲染 */
  pendingPermission?: PendingPermission | null;
  /** 当前 agent id */
  agentId: string;
  /** agent 下拉选项 */
  agentOptions?: AgentOption[];
  /** 输入框占位文案 */
  placeholder?: string;
}

const props = withDefaults(defineProps<Props>(), {
  pendingPermission: null,
  agentOptions: () => [],
  placeholder: "告诉助手怎么调整看板…（Enter 发送，Shift+Enter 换行）",
});

interface Emits {
  (e: "update:modelValue", value: string): void;
  /** 提交一轮对话（已去空白，运行中不触发） */
  (e: "send", text: string): void;
  (e: "stop"): void;
  (e: "replyPermission", response: "once" | "always" | "reject"): void;
  (e: "agentChange", value: string): void;
  (e: "close"): void;
}

const emit = defineEmits<Emits>();

const scrollBox = ref<HTMLElement | null>(null);

function scrollToBottom() {
  nextTick(() => {
    const box = scrollBox.value;
    if (box) box.scrollTop = box.scrollHeight;
  });
}

watch(() => props.messages.length, scrollToBottom);
watch(() => props.messages.at(-1)?.content, scrollToBottom);

function handleSubmit(text: string) {
  const value = text.trim();
  if (!value || props.running) return;
  emit("update:modelValue", "");
  emit("send", value);
}

/** 权限标签（与 chat/PermissionRequestPanel 同文案）。 */
const permissionLabels = { once: "允许一次", always: "总是允许", reject: "拒绝" } as const;

/** ACP 选项 kind → 网关回复值（映射规则同 chat/PermissionRequestPanel）。 */
function responseOfKind(kind: string): "once" | "always" | "reject" {
  if (kind.startsWith("reject")) return "reject";
  return kind === "allow_always" ? "always" : "once";
}

/** 权限动作：按回复值去重（reject_once / reject_always 合并为「拒绝」）；无选项时退回标准三项。 */
const permissionActions = computed(() => {
  const responses = (props.pendingPermission?.options ?? []).map((option) =>
    responseOfKind(option.kind),
  );
  const unique = [...new Set(responses)];
  const fallback: Array<"once" | "always" | "reject"> = ["once", "always", "reject"];
  return (unique.length > 0 ? unique : fallback).map((response) => ({
    response,
    label: permissionLabels[response],
  }));
});
</script>

<template>
  <Flex vertical class="h-full min-h-0">
    <!-- 头部：标题 + agent 选择 -->
    <Flex align="center" gap="small" class="border-b border-brand-border px-4 py-3">
      <Bot class="h-4 w-4 text-brand-accent" />
      <TypographyText strong>看板助手</TypographyText>
      <Flex align="center" gap="small" class="ml-auto">
        <Select
          size="small"
          class="w-32"
          :value="agentId"
          :options="agentOptions"
          @change="(value: string) => emit('agentChange', value)"
        />
        <Button
          type="text"
          size="small"
          aria-label="关闭"
          class="text-brand-muted"
          @click="emit('close')"
        >
          <X class="h-4 w-4" />
        </Button>
      </Flex>
    </Flex>

    <!-- 消息流 -->
    <div ref="scrollBox" class="board-assistant-scroll min-h-0 flex-1 overflow-y-auto px-4 py-3">
      <Empty
        v-if="messages.length === 0"
        :image="Empty.PRESENTED_IMAGE_SIMPLE"
        :image-style="{ height: '56px' }"
      >
        <template #description>
          <div class="text-[13px] leading-6 text-brand-muted">
            用自然语言管理看板：<br />「把 X 拆成 3 个任务，明天截止，P1」<br />「看板现在有什么任务」「那个
            bug 改成今天截止」
          </div>
        </template>
      </Empty>

      <template v-else>
        <div
          v-for="(message, index) in messages"
          :key="index"
          class="mb-3 flex"
          :class="message.role === 'user' ? 'justify-end' : 'justify-start'"
        >
          <Alert
            v-if="message.role === 'error'"
            class="w-full"
            type="error"
            show-icon
            :message="message.content"
          />
          <Bubble
            v-else
            :placement="message.role === 'user' ? 'end' : 'start'"
            :variant="message.role === 'user' ? 'filled' : 'outlined'"
            shape="round"
            :content="message.content"
            :class="message.role === 'user' ? 'max-w-[85%]' : 'max-w-[92%]'"
          >
            <template #contentRender="{ content }">
              <span class="whitespace-pre-wrap break-words">{{ content }}</span>
              <span
                v-if="message.streaming && !message.content"
                class="inline-block h-4 w-1.5 animate-pulse bg-brand-accent align-text-bottom"
              />
            </template>
          </Bubble>
        </div>

        <!-- 工具执行中指示 -->
        <div v-if="running && toolActivityCount > 0" class="mb-2">
          <Badge status="processing" :text="`工具执行中（${toolActivityCount}）`" />
        </div>

        <!-- 权限审批 -->
        <Alert
          v-if="pendingPermission"
          class="mb-3"
          type="warning"
          show-icon
          message="需要你的批准"
          :description="pendingPermission.title"
        >
          <template #action>
            <Space wrap :size="4">
              <Button
                v-for="action in permissionActions"
                :key="action.response"
                size="small"
                :type="action.response === 'once' ? 'primary' : 'default'"
                :danger="action.response === 'reject'"
                @click="emit('replyPermission', action.response)"
              >
                {{ action.label }}
              </Button>
            </Space>
          </template>
        </Alert>
      </template>
    </div>

    <!-- 输入区：Sender（Enter 发送 / Shift+Enter 换行，加载中自动变停止） -->
    <div class="border-t border-brand-border px-4 pt-2">
      <Sender
        :value="modelValue"
        :loading="running"
        :placeholder="placeholder"
        :on-change="(value: string) => emit('update:modelValue', value)"
        :on-submit="handleSubmit"
        :on-cancel="() => emit('stop')"
      />
      <TypographyText type="secondary" class="!text-[11px]">
        助手通过本地 agent 操作看板；删除任务前会先向你确认。
      </TypographyText>
    </div>
  </Flex>
</template>

<style scoped>
.board-assistant-scroll {
  scrollbar-width: thin;
  overscroll-behavior-y: contain;
}
</style>

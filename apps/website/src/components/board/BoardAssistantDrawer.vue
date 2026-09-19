<script setup lang="ts">
/**
 * 看板 AI 助手：右下悬浮按钮 + 聊天抽屉。
 * 本地 ACP agent（默认 Oh My Pi）经 /api/board/tasks 读写看板任务，
 * 回合结束后触发看板刷新。
 * 组件全部使用 antdv-next / @antdv-next/x，跟随 XProvider 品牌主题。
 */
import { Bubble, Sender } from "@antdv-next/x";
import { Bot, X } from "@lucide/vue";
import {
  Alert,
  Badge,
  Button,
  Drawer,
  Empty,
  Flex,
  FloatButton,
  Select,
  Space,
  TypographyText,
} from "antdv-next";
import { computed, nextTick, ref, watch } from "vue";
import { useBoardAssistant } from "../../composables/useBoardAssistant";
import type { AgentView } from "../../services/acp";

interface Props {
  agents: AgentView[];
}

const props = defineProps<Props>();
interface Emits {
  (e: "tasks-mutated"): void;
}
const emit = defineEmits<Emits>();

const open = ref(false);
const assistant = useBoardAssistant({ onTasksMutated: () => emit("tasks-mutated") });
void assistant.init();

const acpAgents = computed(() => props.agents.filter((agent) => agent.kind === "acp"));

const inputText = ref("");
const scrollBox = ref<HTMLElement | null>(null);

function scrollToBottom() {
  nextTick(() => {
    const box = scrollBox.value;
    if (box) box.scrollTop = box.scrollHeight;
  });
}

watch(open, (isOpen) => {
  if (isOpen) void assistant.hydrate();
});
watch(
  () => assistant.messages.value.length,
  () => scrollToBottom(),
);
watch(
  () => assistant.messages.value.at(-1)?.content,
  () => scrollToBottom(),
);

function handleSubmit(text: string) {
  const value = text.trim();
  if (!value || assistant.running.value) return;
  inputText.value = "";
  void assistant.send(value);
}
</script>

<template>
  <!-- 悬浮入口 -->
  <FloatButton class="board-assistant-fab" aria-label="打开看板 AI 助手" @click="open = true">
    <template #icon>
      <Bot class="h-5 w-5" />
    </template>
  </FloatButton>

  <Drawer
    class="board-assistant-drawer"
    :open="open"
    placement="right"
    :width="400"
    :keyboard="true"
    :body-style="{ padding: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }"
    :header-style="{ display: 'none' }"
    destroy-on-close
    @close="open = false"
  >
    <Flex vertical class="h-full min-h-0">
      <!-- 头部：标题 + agent 选择 -->
      <Flex align="center" gap="small" class="border-b border-brand-border px-4 py-3">
        <Bot class="h-4 w-4 text-brand-accent" />
        <TypographyText strong>看板助手</TypographyText>
        <Flex align="center" gap="small" class="ml-auto">
          <Select
            size="small"
            class="w-32"
            :value="assistant.agentId.value"
            :options="
              acpAgents.map((agent) => ({
                value: agent.id,
                label: agent.available ? agent.name : `${agent.name}（不可用）`,
                disabled: !agent.available,
              }))
            "
            @change="(value: string) => assistant.setAgent(value)"
          />
          <Button
            type="text"
            size="small"
            aria-label="关闭"
            class="text-brand-muted"
            @click="open = false"
          >
            <X class="h-4 w-4" />
          </Button>
        </Flex>
      </Flex>

      <!-- 消息流 -->
      <div ref="scrollBox" class="board-assistant-scroll min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <Empty
          v-if="assistant.messages.value.length === 0"
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
            v-for="(message, index) in assistant.messages.value"
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
          <div v-if="assistant.running.value && assistant.toolActivityCount.value > 0" class="mb-2">
            <Badge
              status="processing"
              :text="`工具执行中（${assistant.toolActivityCount.value}）`"
            />
          </div>

          <!-- 权限审批 -->
          <Alert
            v-if="assistant.pendingPermission.value"
            class="mb-3"
            type="warning"
            show-icon
            message="需要你的批准"
            :description="assistant.pendingPermission.value.title"
          >
            <template #action>
              <Space wrap :size="4">
                <Button size="small" type="primary" @click="assistant.replyPermission('once')">
                  允许一次
                </Button>
                <Button size="small" @click="assistant.replyPermission('always')">总是允许</Button>
                <Button size="small" danger @click="assistant.replyPermission('reject')">
                  拒绝
                </Button>
              </Space>
            </template>
          </Alert>
        </template>
      </div>

      <!-- 输入区：Sender（Enter 发送 / Shift+Enter 换行，加载中自动变停止） -->
      <div class="border-t border-brand-border px-4 pt-2">
        <Sender
          :value="inputText"
          :loading="assistant.running.value"
          placeholder="告诉助手怎么调整看板…（Enter 发送，Shift+Enter 换行）"
          :on-change="(value: string) => (inputText = value)"
          :on-submit="handleSubmit"
          :on-cancel="() => assistant.stop()"
        />
        <TypographyText type="secondary" class="!text-[11px]">
          助手通过本地 agent 操作看板；删除任务前会先向你确认。
        </TypographyText>
      </div>
    </Flex>
  </Drawer>
</template>

<style scoped>
/* 品牌色圆形悬浮按钮（FloatButton 底层是 .ant-btn，直接刷按钮本身） */
.board-assistant-fab {
  right: 20px;
  bottom: 20px;
  z-index: 60;
  width: 44px;
  height: 44px;
  box-shadow: 0 4px 14px rgba(200, 95, 68, 0.4);
}
.board-assistant-fab,
.board-assistant-fab:not(:disabled):hover,
.board-assistant-fab:not(:disabled):focus {
  background: var(--brand-accent);
  border-color: var(--brand-accent);
  color: #fff;
}
.board-assistant-fab:not(:disabled):hover {
  filter: brightness(1.08);
}

.board-assistant-scroll {
  scrollbar-width: thin;
  overscroll-behavior-y: contain;
}

/* 移动端：抽屉全屏 */
@media (max-width: 768px) {
  :deep(.board-assistant-drawer) {
    width: 100vw !important;
    max-width: 100vw !important;
  }
}
</style>

<script setup lang="ts">
/**
 * 看板 AI 助手：右下悬浮按钮 + 聊天抽屉。
 * 本地 ACP agent（默认 Oh My Pi）经 /api/board/tasks 读写看板任务，
 * 回合结束后触发看板刷新。
 */
import { Bot, Send, Square, X } from "@lucide/vue";
import { Button, Drawer, Select, TextArea } from "antdv-next";
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

function handleSend() {
  const text = inputText.value;
  if (!text.trim() || assistant.running.value) return;
  inputText.value = "";
  void assistant.send(text);
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    handleSend();
  }
}
</script>

<template>
  <!-- 悬浮入口 -->
  <button
    type="button"
    class="board-assistant-fab"
    aria-label="打开看板 AI 助手"
    @click="open = true"
  >
    <Bot class="h-5 w-5" />
  </button>

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
    <div class="flex h-full min-h-0 flex-col">
      <!-- 头部：标题 + agent 选择 -->
      <div class="flex items-center gap-2 border-b border-brand-border px-4 py-3">
        <Bot class="h-4 w-4 text-brand-accent" />
        <span class="text-sm font-semibold text-brand-foreground">看板助手</span>
        <div class="ml-auto flex items-center gap-2">
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
          <button
            type="button"
            class="rounded p-1 text-brand-muted hover:bg-brand-surface-subtle hover:text-brand-foreground"
            aria-label="关闭"
            @click="open = false"
          >
            <X class="h-4 w-4" />
          </button>
        </div>
      </div>

      <!-- 消息流 -->
      <div ref="scrollBox" class="board-assistant-scroll min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <div v-if="assistant.messages.value.length === 0" class="board-assistant-empty">
          <Bot class="mx-auto mb-2 h-6 w-6 text-brand-muted" />
          <p class="text-center text-[13px] leading-5 text-brand-muted">
            用自然语言管理看板：<br />「把 X 拆成 3 个任务，明天截止，P1」<br />「看板现在有什么任务」「那个
            bug 改成今天截止」
          </p>
        </div>

        <div
          v-for="(message, index) in assistant.messages.value"
          :key="index"
          class="mb-3 flex"
          :class="message.role === 'user' ? 'justify-end' : 'justify-start'"
        >
          <div
            v-if="message.role === 'user'"
            class="max-w-[85%] rounded-2xl rounded-br-sm bg-brand-accent px-3 py-2 text-[13px] leading-5 text-white"
          >
            <span class="whitespace-pre-wrap break-words">{{ message.content }}</span>
          </div>
          <div
            v-else-if="message.role === 'error'"
            class="max-w-[85%] rounded-lg border border-brand-danger bg-brand-danger-subtle px-3 py-2 text-[12.5px] leading-5 text-brand-danger"
          >
            {{ message.content }}
          </div>
          <div
            v-else
            class="max-w-[92%] rounded-xl rounded-bl-sm border border-brand-border bg-brand-surface px-3 py-2 text-[13px] leading-5 text-brand-foreground"
          >
            <span class="whitespace-pre-wrap break-words">{{ message.content }}</span>
            <span
              v-if="message.streaming && !message.content"
              class="inline-block h-4 w-1.5 animate-pulse bg-brand-accent align-text-bottom"
            />
          </div>
        </div>

        <!-- 工具执行中指示 -->
        <div
          v-if="assistant.running.value && assistant.toolActivityCount.value > 0"
          class="text-[11.5px] font-medium text-brand-muted"
        >
          工具执行中（{{ assistant.toolActivityCount.value }}）…
        </div>

        <!-- 权限审批 -->
        <div
          v-if="assistant.pendingPermission.value"
          class="mb-3 rounded-lg border border-brand-border bg-brand-surface-subtle px-3 py-2"
        >
          <p class="mb-2 text-[12.5px] font-medium text-brand-foreground">
            {{ assistant.pendingPermission.value.title }}
          </p>
          <div class="flex gap-2">
            <Button size="small" type="primary" @click="assistant.replyPermission('once')">
              允许一次
            </Button>
            <Button size="small" @click="assistant.replyPermission('always')">总是允许</Button>
            <Button size="small" danger @click="assistant.replyPermission('reject')">拒绝</Button>
          </div>
        </div>
      </div>

      <!-- 输入区 -->
      <div class="border-t border-brand-border px-4 py-3">
        <div class="flex items-end gap-2">
          <TextArea
            v-model:value="inputText"
            :auto-size="{ minRows: 1, maxRows: 5 }"
            placeholder="告诉助手怎么调整看板…（Enter 发送，Shift+Enter 换行）"
            class="flex-1"
            @keydown="handleKeydown"
          />
          <Button
            v-if="!assistant.running.value"
            type="primary"
            class="board-assistant-send"
            :disabled="!inputText.trim()"
            aria-label="发送"
            @click="handleSend"
          >
            <Send class="h-4 w-4" />
          </Button>
          <Button v-else danger aria-label="停止" @click="assistant.stop()">
            <Square class="h-4 w-4" />
          </Button>
        </div>
        <p class="mt-1.5 text-[11px] leading-4 text-brand-muted">
          助手通过本地 agent 操作看板；删除任务前会先向你确认。
        </p>
      </div>
    </div>
  </Drawer>
</template>

<style scoped>
.board-assistant-fab {
  position: fixed;
  right: 20px;
  bottom: 20px;
  z-index: 60;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: 9999px;
  border: none;
  color: #fff;
  background: var(--brand-accent);
  box-shadow: 0 4px 14px rgba(200, 95, 68, 0.4);
  cursor: pointer;
  transition:
    transform 160ms ease,
    box-shadow 160ms ease;
}
.board-assistant-fab:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 18px rgba(200, 95, 68, 0.5);
}

.board-assistant-scroll {
  scrollbar-width: thin;
  overscroll-behavior-y: contain;
}

.board-assistant-empty {
  padding: 48px 12px;
}

/* 移动端：抽屉全屏 */
@media (max-width: 768px) {
  :deep(.board-assistant-drawer) {
    width: 100vw !important;
    max-width: 100vw !important;
  }
}
</style>

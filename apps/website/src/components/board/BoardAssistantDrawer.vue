<script setup lang="ts">
/**
 * 看板 AI 助手（容器）：右下悬浮按钮 + 聊天抽屉。
 * 本地 ACP agent（默认 Oh My Pi）经 /api/board/tasks 读写看板任务，
 * 回合结束后触发看板刷新。
 * 会话状态由 useBoardAssistant 持有，展示与交互全部交给 BoardAssistantChat；
 * 组件全部使用 antdv-next / @antdv-next/x，跟随 XProvider 品牌主题。
 */
import { Bot } from "@lucide/vue";
import { Drawer, FloatButton } from "antdv-next";
import { computed, ref, watch } from "vue";
import { useBoardAssistant } from "../../composables/useBoardAssistant";
import type { AgentView } from "../../services/acp";
import BoardAssistantChat from "./BoardAssistantChat.vue";

interface Props {
  agents: AgentView[];
  /** 初始即展开（静态呈现用）：打开动作才建立会话，挂载本身不发请求。 */
  defaultOpen?: boolean;
}

const props = withDefaults(defineProps<Props>(), { defaultOpen: false });

interface Emits {
  (e: "tasks-mutated"): void;
}
const emit = defineEmits<Emits>();

const open = ref(props.defaultOpen);
const inputText = ref("");
const assistant = useBoardAssistant({ onTasksMutated: () => emit("tasks-mutated") });

/** agent 下拉选项：只看板可用的 ACP agent。 */
const agentOptions = computed(() =>
  props.agents
    .filter((agent) => agent.kind === "acp")
    .map((agent) => ({
      value: agent.id,
      label: agent.available ? agent.name : `${agent.name}（不可用）`,
      disabled: !agent.available,
    })),
);

/**
 * 会话按需建立：首次打开读持久化状态（agent + ACP 会话 id），之后每次打开水合历史。
 * 挂载本身不发起任何请求，抽屉可在无网关环境下静态渲染。
 */
let sessionReady = false;
watch(open, async (isOpen) => {
  if (!isOpen) return;
  if (!sessionReady) {
    sessionReady = true;
    await assistant.init();
  }
  await assistant.hydrate();
});
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
    <BoardAssistantChat
      v-model="inputText"
      :messages="assistant.messages.value"
      :running="assistant.running.value"
      :tool-activity-count="assistant.toolActivityCount.value"
      :pending-permission="assistant.pendingPermission.value"
      :agent-id="assistant.agentId.value"
      :agent-options="agentOptions"
      @send="assistant.send($event)"
      @stop="assistant.stop()"
      @reply-permission="assistant.replyPermission($event)"
      @agent-change="assistant.setAgent($event)"
      @close="open = false"
    />
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

/* 移动端：抽屉全屏 */
@media (max-width: 768px) {
  :deep(.board-assistant-drawer) {
    width: 100vw !important;
    max-width: 100vw !important;
  }
}
</style>

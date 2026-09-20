<script setup lang="ts">
import { ChevronDown, Circle, Plus } from "@lucide/vue";
import { Button, Dropdown } from "antdv-next";
import { computed, h, ref } from "vue";
import type { OpenChatConversation } from "../../composables/useChatPersistence";
import type { AgentView } from "../../services/acp";
import { deriveBoardStatus, type SessionStatus } from "../../utils/sessionStatus";
import type { SessionStatusSignals } from "../../utils/sessionStatus";
import TaskSessionRow from "./TaskSessionRow.vue";

interface Props {
  /** 已按更新时间排好序的会话列表。 */
  sessions: OpenChatConversation[];
  /** 会话运行信号：决定每一行的状态徽标。 */
  statusSignals: SessionStatusSignals;
  /** 全局时钟 tick：驱动运行中会话的耗时展示。 */
  nowTick: number;
  activeSessionKey?: string;
  agents?: AgentView[];
  activeAgentId?: string;
}

const props = withDefaults(defineProps<Props>(), {
  activeSessionKey: "",
  agents: () => [],
  activeAgentId: "api",
});

const emit = defineEmits<{
  (e: "createSession"): void;
  (e: "openSession", sessionKey: string): void;
  (e: "deleteSession", sessionKey: string): void;
  (e: "renameSession", sessionKey: string, title: string): void;
  (e: "agentChange", agentId: string): void;
}>();

/** 同一时刻只允许一行处于标题编辑态。 */
const editingKey = ref("");
const editingDraft = ref("");

const statusOf = (conv: OpenChatConversation): SessionStatus =>
  deriveBoardStatus(
    conv as unknown as Record<string, unknown> & { key: string },
    props.statusSignals,
  );

const elapsedOf = (key: string): string => {
  const startedAt = props.statusSignals.busyStates[key]?.startedAt;
  if (!startedAt) return "";
  const s = Math.max(0, Math.floor((props.nowTick - startedAt) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

const agentNameOf = (agentId?: string): string => {
  if (!agentId) return "API";
  const a = props.agents.find((x) => x.id === agentId);
  return a?.name || (agentId === "api" ? "API" : agentId);
};

const activeAgent = computed(
  () => props.agents.find((a) => a.id === props.activeAgentId) ?? props.agents[0],
);

const activeAgentLabel = computed(() => {
  if (activeAgent.value?.id === "api") return "模型 (API)";
  return activeAgent.value?.name || "选择供应商";
});

const agentMenu = computed(() => ({
  items: props.agents.map((agent) => ({
    key: agent.id,
    label: agent.name || (agent.id === "api" ? "模型 (API)" : agent.id),
    icon: h(Circle, {
      class: [
        "!w-2 !h-2",
        agent.available ? "text-emerald-500 fill-emerald-500" : "text-zinc-400 fill-zinc-400",
      ],
    }),
  })),
  onClick: ({ key }: { key: string | number }) => {
    emit("agentChange", String(key));
  },
}));

const handleOpen = (sessionKey: string) => {
  emit("openSession", sessionKey);
};

const handleDelete = (sessionKey: string) => {
  emit("deleteSession", sessionKey);
};

const startEdit = (sessionKey: string) => {
  const conv = props.sessions.find((c) => String(c.key) === sessionKey);
  editingKey.value = sessionKey;
  editingDraft.value = String(conv?.label ?? "");
};

const confirmEdit = (sessionKey: string) => {
  if (!editingKey.value) return;
  const conv = props.sessions.find((c) => String(c.key) === sessionKey);
  const newTitle = editingDraft.value.trim();
  if (conv && newTitle && newTitle !== conv.label) {
    emit("renameSession", sessionKey, newTitle);
  }
  editingKey.value = "";
  editingDraft.value = "";
};

const cancelEdit = () => {
  editingKey.value = "";
  editingDraft.value = "";
};
</script>

<template>
  <div class="flex flex-col gap-2.5 border-t border-border pt-3">
    <div class="flex items-center justify-between gap-2">
      <span class="text-12px font-semibold">AI 会话 · {{ sessions.length }}</span>
      <!-- 供应商切换器 -->
      <Dropdown :menu="agentMenu" :trigger="['click']">
        <Button
          size="small"
          class="!inline-flex !items-center !gap-1.5 !text-xs !h-[24px] !px-2"
          :title="activeAgent?.description || '切换 AI 供应商'"
        >
          <span
            class="w-1.5 h-1.5 rounded-full flex-none"
            :class="activeAgent?.available ? 'bg-emerald-500 shadow-xs' : 'bg-zinc-400'"
          />
          <span class="truncate max-w-24">{{ activeAgentLabel }}</span>
          <ChevronDown class="h-3 w-3 opacity-60 flex-none" />
        </Button>
      </Dropdown>
    </div>

    <div
      v-if="sessions.length === 0"
      class="text-12px text-muted-foreground p-3 border border-dashed border-border rounded-8 text-center bg-muted/50"
    >
      还没有会话，点击下方新建
    </div>

    <TaskSessionRow
      v-for="conv in sessions"
      :key="String(conv.key)"
      v-model:draft="editingDraft"
      :conv="conv"
      :status="statusOf(conv)"
      :agent-name="agentNameOf(conv.agentId)"
      :elapsed="elapsedOf(String(conv.key))"
      :active="String(conv.key) === activeSessionKey"
      :editing="editingKey === String(conv.key)"
      @open="handleOpen"
      @delete="handleDelete"
      @start-edit="startEdit"
      @confirm-edit="confirmEdit"
      @cancel-edit="cancelEdit"
    />

    <div class="pt-2 border-t border-border/50">
      <Button type="primary" :icon="h(Plus)" block @click="emit('createSession')">
        新建会话（{{ activeAgentLabel }}）
      </Button>
    </div>
  </div>
</template>

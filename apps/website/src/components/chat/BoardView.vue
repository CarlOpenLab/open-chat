<script setup lang="ts">
import { Archive, Bot, Cpu, Ellipsis, Folder, LoaderCircle, Pin, Trash2 } from "@lucide/vue";
import { Button, Dropdown, Tooltip } from "antdv-next";
import { computed, h, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { OpenChatConversation } from "../../composables/useChatPersistence";
import type { AgentView } from "../../services/acp";
import {
  SESSION_STATUS_META,
  SESSION_STATUS_ORDER,
  deriveBoardStatus,
  type SessionStatus,
  type SessionStatusSignals,
} from "../../utils/sessionStatus";

interface Props {
  conversationList: OpenChatConversation[];
  /** 当前抽屉打开的会话 key；空串表示无。 */
  openKey: string;
  statusSignals: SessionStatusSignals;
  agents?: AgentView[];
}

interface Emits {
  (e: "openConversation", key: string): void;
  (e: "moveConversation", key: string, status: SessionStatus): void;
  (e: "pinConversation", key: string): void;
  (e: "archiveConversation", key: string): void;
  (e: "deleteConversation", key: string): void;
}

const props = withDefaults(defineProps<Props>(), { agents: () => [] });
const emit = defineEmits<Emits>();

/** 副行计时需要随时间走动：运行中每秒刷新，空闲 30 秒足够。 */
const nowTick = ref(Date.now());
let tickTimer: ReturnType<typeof setInterval> | undefined;

const stopTick = () => {
  if (!tickTimer) return;
  clearInterval(tickTimer);
  tickTimer = undefined;
};

const startTick = (periodMs: number) => {
  stopTick();
  tickTimer = setInterval(() => {
    nowTick.value = Date.now();
  }, periodMs);
};

const hasBusy = computed(() => Object.keys(props.statusSignals.busyStates).length > 0);

watch(hasBusy, (busy) => startTick(busy ? 1000 : 30000), { immediate: true });
onBeforeUnmount(stopTick);
const agentNameMap = computed(() => {
  const map = new Map<string, string>();
  for (const agent of props.agents) map.set(agent.id, agent.name);
  map.set("api", "API");
  return map;
});

const getConversationAgentLabel = (conversation: OpenChatConversation): string => {
  const agentId = (conversation.agentId || "api") as string;
  return agentNameMap.value.get(agentId) ?? agentId;
};

const isCpuAgent = (conversation: OpenChatConversation): boolean => {
  const id = String(conversation.agentId || "api").toLowerCase();
  return id === "pi" || id === "omp" || id === "api";
};

const projectNameOf = (conversation: OpenChatConversation): string => {
  const projectPath = conversation.projectPath?.trim();
  return projectPath ? (projectPath.split(/[\\/]/).filter(Boolean).pop() ?? "") : "";
};

const relativeTime = (timestamp: number | undefined, now: number): string => {
  if (!timestamp) return "";
  const diffMs = Math.max(0, now - timestamp);
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
};

const elapsedDuration = (startedAt: number | undefined, now: number): string => {
  if (!startedAt) return "";
  const totalSeconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  return `${minutes}:${String(totalSeconds % 60).padStart(2, "0")}`;
};

const statusOf = (conversation: OpenChatConversation): SessionStatus =>
  deriveBoardStatus(conversation, props.statusSignals);

const columns = computed(() =>
  SESSION_STATUS_ORDER.map((status) => ({
    status,
    meta: SESSION_STATUS_META[status],
    items: props.conversationList.filter((item) => statusOf(item) === status),
  })),
);

const countsSummary = computed(() => {
  const map: Record<string, number> = {};
  for (const column of columns.value) map[column.status] = column.items.length;
  return `运行中 ${map.running ?? 0} · 待操作 ${map.permission ?? 0}`;
});

// ============ 拖拽归列 ============

const dragKey = ref("");
const dragOverColumn = ref<SessionStatus | "">("");

const handleDragStart = (conversation: OpenChatConversation, event: DragEvent) => {
  dragKey.value = String(conversation.key);
  event.dataTransfer?.setData("text/plain", String(conversation.key));
  if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
};

const handleDragEnd = () => {
  dragKey.value = "";
  dragOverColumn.value = "";
};

const handleDragOver = (status: SessionStatus, event: DragEvent) => {
  if (!dragKey.value) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  dragOverColumn.value = status;
};

const handleDragLeave = (event: DragEvent) => {
  if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
  dragOverColumn.value = "";
};

const handleDrop = (status: SessionStatus, event: DragEvent) => {
  event.preventDefault();
  const key = event.dataTransfer?.getData("text/plain") || dragKey.value;
  handleDragEnd();
  if (key) emit("moveConversation", key, status);
};

// ============ 卡片菜单（沿用原侧栏：置顶 / 归档 / 删除） ============

const cardMenu = (conversation: OpenChatConversation) => ({
  items: [
    { key: "pin", label: conversation.group === "置顶" ? "取消置顶" : "置顶对话", icon: h(Pin) },
    { key: "archive", label: "归档对话", icon: h(Archive) },
    { type: "divider" as const },
    { key: "delete", label: "删除对话", icon: h(Trash2), danger: true },
  ],
  onClick: ({ key }: { key: string | number }) => {
    const conversationKey = String(conversation.key);
    if (key === "pin") emit("pinConversation", conversationKey);
    if (key === "archive") emit("archiveConversation", conversationKey);
    if (key === "delete") emit("deleteConversation", conversationKey);
  },
});
</script>

<template>
  <div class="board-wrap">
    <header class="board-header">
      <h1 class="board-title">任务看板</h1>
      <span class="board-meta">{{ conversationList.length }} 个会话 · {{ countsSummary }}</span>
    </header>

    <div class="board-scroll">
      <div class="board">
        <section
          v-for="column in columns"
          :key="column.status"
          class="column"
          :class="{ 'is-drag-over': dragOverColumn === column.status }"
          :aria-label="`${column.meta.name}列，${column.items.length}个任务`"
          @dragover="handleDragOver(column.status, $event)"
          @dragleave="handleDragLeave"
          @drop="handleDrop(column.status, $event)"
        >
          <header class="column-head">
            <span class="col-dot" :class="`col-dot-${column.status}`" />
            <span class="col-name">{{ column.meta.name }}</span>
            <span class="col-count">{{ column.items.length }}</span>
            <span class="col-hint">{{ column.meta.hint }}</span>
          </header>
          <div class="column-body">
            <div v-if="column.items.length === 0" class="empty-col">
              {{ dragKey ? "松开移动到这里" : "暂无任务" }}
            </div>
            <article
              v-for="conversation in column.items"
              :key="String(conversation.key)"
              :data-key="String(conversation.key)"
              class="card"
              :class="{ 'is-open': String(conversation.key) === openKey }"
              role="button"
              tabindex="0"
              draggable="true"
              :aria-label="`打开会话：${conversation.label}`"
              @click="emit('openConversation', String(conversation.key))"
              @keydown.enter.prevent="emit('openConversation', String(conversation.key))"
              @keydown.space.prevent="emit('openConversation', String(conversation.key))"
              @dragstart="handleDragStart(conversation, $event)"
              @dragend="handleDragEnd"
            >
              <div class="card-title-row">
                <Tooltip :title="conversation.label" placement="top">
                  <span class="card-title">{{ conversation.label }}</span>
                </Tooltip>
                <Pin v-if="conversation.group === '置顶'" class="card-pin" />
              </div>
              <div v-if="projectNameOf(conversation)" class="card-project">
                <Folder class="!h-[12px] !w-[12px] flex-none" />
                <span>{{ projectNameOf(conversation) }}</span>
              </div>
              <div class="card-foot">
                <span class="card-agent-chip">
                  <Cpu v-if="isCpuAgent(conversation)" class="!h-[12px] !w-[12px] flex-none" />
                  <Bot v-else class="!h-[12px] !w-[12px] flex-none" />
                  <span>{{ getConversationAgentLabel(conversation) }}</span>
                </span>

                <Dropdown :menu="cardMenu(conversation)" :trigger="['click']">
                  <Button
                    type="text"
                    size="small"
                    :icon="h(Ellipsis)"
                    class="!w-5 !h-5 !p-0 !border-none text-muted-foreground hover:!text-foreground"
                    :aria-label="`会话操作：${conversation.label}`"
                    @click.stop
                  />
                </Dropdown>

                <template v-if="statusOf(conversation) === 'running'">
                  <span class="card-busy">
                    <LoaderCircle class="spin !h-[12px] !w-[12px]" />
                    {{
                      elapsedDuration(
                        props.statusSignals.busyStates[String(conversation.key)]?.startedAt,
                        nowTick,
                      )
                    }}
                  </span>
                </template>
                <span v-else-if="statusOf(conversation) === 'queued'" class="badge badge-queue"
                  >排队 ·
                  {{ (conversation.queuedMessages as unknown[] | undefined)?.length ?? 0 }}</span
                >
                <span
                  v-else-if="statusOf(conversation) === 'permission'"
                  class="badge badge-permission"
                  >待确认权限</span
                >
                <Tooltip
                  v-else-if="statusOf(conversation) === 'stopped'"
                  :title="conversation.lastError || '出错或手动停止'"
                  placement="top"
                >
                  <span class="badge badge-stopped">已终止</span>
                </Tooltip>
                <span v-else class="card-time">{{
                  relativeTime(conversation.updatedAt, nowTick)
                }}</span>
              </div>
            </article>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.board-wrap {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  overflow: hidden;
}

.board-header {
  display: flex;
  height: 48px;
  flex: none;
  align-items: center;
  gap: 10px;
  padding: 0 16px;
  border-bottom: 1px solid var(--border);
}

.board-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--brand-foreground);
}

.board-meta {
  font-size: 12px;
  color: var(--brand-muted);
}

.board-scroll {
  flex: 1;
  min-height: 0;
  padding: 14px 16px 16px;
  overflow-x: auto;
  overflow-y: hidden;
}

.board {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(264px, 1fr);
  gap: 10px;
  height: 100%;
}

.column {
  display: flex;
  min-width: 0;
  flex-direction: column;
  border-radius: 10px;
  outline: 1px solid transparent;
  background: var(--subtle);
  transition:
    background-color 150ms ease,
    outline-color 150ms ease;
}

html[data-theme="dark"] .column {
  background: #141416;
}

.column.is-drag-over {
  background: var(--muted);
  outline: 1px dashed var(--border-strong);
}

.column-head {
  display: flex;
  flex: none;
  align-items: center;
  gap: 7px;
  padding: 10px 10px 6px;
  font-size: 13px;
  font-weight: 600;
}

.col-count {
  display: inline-grid;
  min-width: 18px;
  height: 18px;
  place-items: center;
  padding: 0 5px;
  border-radius: 9px;
  background: var(--muted);
  color: var(--muted-foreground);
  font-size: 11px;
  font-weight: 500;
}

.col-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex: none;
}

.col-dot-running {
  background: var(--success);
}
.col-dot-queued {
  background: #b45309;
}
.col-dot-permission {
  background: var(--danger);
}
.col-dot-done {
  background: var(--muted-foreground);
}
.col-dot-stopped {
  background: var(--input);
}

.col-hint {
  margin-left: auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  font-weight: 400;
  color: var(--muted-foreground);
}

.column-body {
  display: flex;
  min-height: 0;
  flex-direction: column;
  gap: 8px;
  padding: 4px 8px 10px;
  overflow-y: auto;
}

.empty-col {
  padding: 18px 10px;
  border: 1px dashed var(--border);
  border-radius: 8px;
  color: var(--muted-foreground);
  font-size: 12px;
  text-align: center;
}

.card {
  position: relative;
  cursor: pointer;
  user-select: none;
  padding: 10px 12px 11px;
  border: 1px solid transparent;
  border-radius: 10px;
  background: var(--background);
  box-shadow: var(--shadow-sm);
  transition:
    box-shadow 140ms ease,
    border-color 140ms ease;
}

html[data-theme="dark"] .card {
  background: #1b1b1e;
}

.card:hover {
  border-color: var(--border-strong);
  box-shadow:
    0 0 0 1px var(--border-strong),
    var(--shadow-lg);
}

.card:focus-visible {
  outline: 2px solid var(--brand-ring);
  outline-offset: 1px;
}

.card.is-open {
  border-color: var(--border-strong);
}

.card.is-dragging,
.card[aria-grabbed="true"] {
  opacity: 0.45;
}

.card-title-row {
  display: flex;
  align-items: flex-start;
  gap: 6px;
}

.card-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 550;
  line-height: 1.55;
}

.card-pin {
  width: 12px;
  height: 12px;
  margin-top: 3px;
  flex: none;
  color: var(--brand-accent);
}

.card-project {
  display: inline-flex;
  align-items: center;
  max-width: 100%;
  margin-top: 5px;
  gap: 5px;
  color: var(--muted-foreground);
  font-size: 12px;
}

.card-project span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 9px;
  color: var(--muted-foreground);
  font-size: 12px;
}

.card-agent-chip {
  display: inline-flex;
  max-width: 130px;
  align-items: center;
  gap: 4px;
}

.card-agent-chip span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card-time {
  margin-left: auto;
  white-space: nowrap;
}

.card-busy {
  display: inline-flex;
  margin-left: auto;
  align-items: center;
  gap: 5px;
  white-space: nowrap;
  color: var(--success);
  font-variant-numeric: tabular-nums;
}

.badge {
  display: inline-flex;
  margin-left: auto;
  align-items: center;
  gap: 4px;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 11px;
  line-height: 1.7;
  white-space: nowrap;
}

.badge-queue {
  color: #b45309;
  background: rgba(180, 83, 9, 0.12);
}

.badge-permission {
  color: #b91c1c;
  background: #fee2e2;
}

html[data-theme="dark"] .badge-queue {
  color: #fbbf24;
}

html[data-theme="dark"] .badge-permission {
  color: #fca5a5;
  background: rgba(248, 113, 113, 0.14);
}

.badge-stopped {
  color: var(--muted-foreground);
  background: var(--muted);
}

.card-menu-trigger {
  display: grid;
  width: 20px;
  height: 20px;
  flex: none;
  place-items: center;
  padding: 0;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--muted-foreground);
  opacity: 0;
  transition:
    opacity 120ms ease,
    background-color 150ms ease;
}

.card:hover .card-menu-trigger,
.card-menu-trigger:focus-visible {
  opacity: 1;
}

.card-menu-trigger:hover {
  background: var(--muted);
  color: var(--foreground);
}

.spin {
  animation: board-spin 900ms linear infinite;
}

@keyframes board-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .spin {
    animation: none;
  }
  .card:hover {
    transform: none;
  }
}
</style>

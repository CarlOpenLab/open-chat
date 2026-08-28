<script setup lang="ts">
import { computed, h, ref, watch } from "vue";
import { Button, Drawer, Dropdown, Input, Select, Tag, Tooltip } from "antdv-next";
import { TextArea } from "antdv-next";
import type { Task } from "../../services/taskStorage";
import type { OpenChatConversation } from "../../composables/useChatPersistence";
import type { AgentView } from "../../services/acp";
import { createStyles } from "../../theme/antdvStyle";
import { TASK_STATUS_META } from "../../utils/taskStatus";
import type { TaskStatus } from "../../utils/taskStatus";
import { deriveBoardStatus, type SessionStatusSignals } from "../../utils/sessionStatus";
import {
  Bot,
  ChevronDown,
  Circle,
  Copy,
  ExternalLink,
  Folder,
  LoaderCircle,
  Pencil,
  Plus,
  Trash2,
} from "@lucide/vue";

interface Props {
  open: boolean;
  task: Task | null;
  conversationList: OpenChatConversation[];
  statusSignals: SessionStatusSignals;
  nowTick: number;
  split?: boolean;
  activeSessionKey?: string;
  projectPathOptions?: string[];
  agents?: AgentView[];
  activeAgentId?: string;
}

const props = withDefaults(defineProps<Props>(), {
  split: false,
  activeSessionKey: "",
  projectPathOptions: () => [],
  agents: () => [],
  activeAgentId: "api",
});
const emit = defineEmits<{
  (e: "close"): void;
  (e: "updateTask", id: string, patch: Partial<Task>): void;
  (e: "createSession", taskId: string): void;
  (e: "openSession", sessionKey: string): void;
  (e: "retrySession", taskId: string, sessionKey: string): void;
  (e: "removeSessionLink", taskId: string, sessionKey: string): void;
  (e: "deleteSession", sessionKey: string): void;
  (e: "agentChange", agentId: string): void;
  (e: "renameSession", sessionKey: string, title: string): void;
}>();

const useStyles = createStyles(({ token, css }) => ({
  immutableHint: css`
    border: 1px solid ${token.colorBorder};
    color: ${token.colorTextSecondary};
    background: ${token.colorFillQuaternary};
  `,
  sessionRow: css`
    background: ${token.colorBgContainer};
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: ${token.borderRadiusLG}px;
    transition: all ${token.motionDurationMid} ${token.motionEaseInOut};
    &:hover {
      border-color: ${token.colorBorder};
      background: ${token.colorFillQuaternary};
    }
    &.is-active {
      border-color: ${token.colorPrimary};
      background: ${token.colorPrimaryBg};
    }
  `,
}));

const { styles } = useStyles();

const localTitle = ref("");
const localDescription = ref("");
const localTagsInput = ref("");

watch(
  () => props.task,
  (t) => {
    if (!t) return;
    localTitle.value = t.title;
    localDescription.value = t.description;
    localTagsInput.value = t.tags.join(", ");
  },
  { immediate: true },
);

const saveTitle = () => {
  if (!props.task) return;
  const title = localTitle.value.trim() || "未命名任务";
  if (title !== props.task.title) emit("updateTask", props.task.id, { title });
};

const saveDescription = () => {
  if (!props.task) return;
  if (localDescription.value !== props.task.description)
    emit("updateTask", props.task.id, { description: localDescription.value });
};

const saveTags = () => {
  if (!props.task) return;
  const tags = localTagsInput.value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  emit("updateTask", props.task.id, { tags });
};

const sessionList = computed(() => {
  if (!props.task) return [];
  const map = new Map<string, OpenChatConversation>();
  for (const c of props.conversationList) map.set(String(c.key), c);
  return props.task.sessionKeys
    .map((k) => map.get(k))
    .filter((c): c is OpenChatConversation => Boolean(c))
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
});

const handleCreateSession = () => {
  if (!props.task) return;
  emit("createSession", props.task.id);
};
const statusOf = (conv: OpenChatConversation) =>
  deriveBoardStatus(
    conv as unknown as Record<string, unknown> & { key: string },
    props.statusSignals,
  );
const elapsed = (key: string): string => {
  const startedAt = props.statusSignals.busyStates[key]?.startedAt;
  if (!startedAt) return "";
  const s = Math.max(0, Math.floor((props.nowTick - startedAt) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const projectName = computed(() => {
  const p = props.task?.projectPath;
  return p ? (p.split(/[\\/]/).filter(Boolean).pop() ?? p) : "未关联项目";
});
const projectPathSelectOptions = computed(() => {
  const set = new Set<string>();
  for (const p of props.projectPathOptions) if (p) set.add(p);
  if (props.task?.projectPath) set.add(props.task.projectPath);
  return Array.from(set).map((p) => ({
    value: p,
    label: p.split(/[\\/]/).filter(Boolean).pop() ?? p,
  }));
});

const handlePickDirectory = async () => {
  try {
    const { aiService } = await import("../../services/ai");
    const res = await aiService.pickProjectPath();
    if (res?.path && props.task) emit("updateTask", props.task.id, { projectPath: res.path });
  } catch {
    // ignore
  }
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

const getAgentName = (agentId?: string): string => {
  if (!agentId) return "API";
  const a = props.agents.find((x) => x.id === agentId);
  return a?.name || (agentId === "api" ? "API" : agentId);
};

const hasChatted = (conv: OpenChatConversation): boolean => {
  return Boolean(conv.messages && conv.messages.length > 0);
};

const handleDeleteSession = (sessionKey: string) => {
  emit("deleteSession", sessionKey);
};

const formatTime = (ts?: number): string => {
  if (!ts) return "";
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

const editingSessionKey = ref("");
const editingSessionDraft = ref("");

const startEditSession = (conv: OpenChatConversation) => {
  editingSessionKey.value = String(conv.key);
  editingSessionDraft.value = conv.label || "";
};

const confirmEditSession = (conv: OpenChatConversation) => {
  if (!editingSessionKey.value) return;
  const newTitle = editingSessionDraft.value.trim();
  if (newTitle && newTitle !== conv.label) {
    emit("renameSession", String(conv.key), newTitle);
  }
  editingSessionKey.value = "";
  editingSessionDraft.value = "";
};

const cancelEditSession = () => {
  editingSessionKey.value = "";
  editingSessionDraft.value = "";
};
</script>

<template>
  <Drawer
    :open="open"
    placement="right"
    :width="split ? 980 : 560"
    :body-style="{ padding: '0', display: 'flex', flexDirection: 'column', overflow: 'hidden' }"
    :header-style="{ display: 'none' }"
    destroy-on-close
    @close="emit('close')"
  >
    <template v-if="task">
      <!-- Split 模式：左任务｜右对话 -->
      <div v-if="split" class="flex h-100vh min-h-0">
        <!-- 左：任务信息 -->
        <div
          class="w-90 flex-none border-r border-border overflow-auto flex flex-col bg-background"
        >
          <header
            class="flex items-center justify-between px-4 py-3 border-b border-border shrink-0"
          >
            <span
              class="inline-flex items-center gap-1.5 text-12px text-muted-foreground"
              :title="task.projectPath ?? ''"
            >
              <Folder class="!h-3 !w-3" /> {{ projectName }}
            </span>
            <Button type="text" size="small" @click="emit('close')">×</Button>
          </header>

          <div class="flex-1 overflow-auto p-4 flex flex-col gap-4">
            <Input
              v-model:value="localTitle"
              placeholder="任务标题"
              class="!text-18px !font-bold !border-0 !px-0 !py-1 focus:!border-b focus:!border-border !rounded-none"
              @blur="saveTitle"
              @press-enter="($event.target as HTMLInputElement).blur()"
            />

            <div class="grid grid-cols-2 gap-2.5">
              <div class="flex flex-col gap-1">
                <span class="text-11px text-muted-foreground">状态</span>
                <Select
                  :value="task.status"
                  class="w-full"
                  :options="
                    Object.entries(TASK_STATUS_META).map(([k, v]) => ({ value: k, label: v.name }))
                  "
                  @change="(v: TaskStatus) => emit('updateTask', task!.id, { status: v })"
                />
              </div>
              <div class="flex flex-col gap-1">
                <span class="text-11px text-muted-foreground">优先级</span>
                <Select
                  :value="task.priority ?? ''"
                  class="w-full"
                  :options="[
                    { value: '', label: '无' },
                    { value: 'P0', label: 'P0 紧急' },
                    { value: 'P1', label: 'P1 高' },
                    { value: 'P2', label: 'P2 中' },
                    { value: 'P3', label: 'P3 低' },
                  ]"
                  @change="
                    (v: string) =>
                      emit('updateTask', task!.id, { priority: (v || null) as Task['priority'] })
                  "
                />
              </div>
              <div class="flex flex-col gap-1">
                <span class="text-11px text-muted-foreground">截止</span>
                <Input
                  type="date"
                  :value="task.dueAt ? new Date(task.dueAt).toISOString().slice(0, 10) : ''"
                  class="w-full"
                  @change="
                    (e: Event) => {
                      const v = (e.target as HTMLInputElement).value;
                      emit('updateTask', task!.id, { dueAt: v ? new Date(v).getTime() : null });
                    }
                  "
                />
              </div>
              <div class="flex flex-col gap-1">
                <span class="text-11px text-muted-foreground">标签（逗号分隔）</span>
                <Input
                  v-model:value="localTagsInput"
                  placeholder="逗号分隔"
                  @blur="saveTags"
                  @press-enter="($event.target as HTMLInputElement).blur()"
                />
              </div>
            </div>

            <div class="flex flex-col gap-1">
              <span class="text-11px text-muted-foreground">工作目录</span>
              <div class="flex gap-1.5">
                <Select
                  :value="task.projectPath ?? ''"
                  class="flex-1"
                  allowClear
                  showSearch
                  placeholder="未关联（可选）"
                  :options="projectPathSelectOptions"
                  @change="(v: string) => emit('updateTask', task!.id, { projectPath: v || null })"
                />
                <Button size="small" class="h-full" @click="handlePickDirectory">浏览</Button>
              </div>
            </div>

            <div class="flex flex-col gap-2">
              <span class="text-12px font-semibold">备注 / 需求</span>
              <TextArea
                v-model:value="localDescription"
                placeholder="记录需求或备注，不会在新建会话时自动发送"
                :rows="4"
                @blur="saveDescription"
              />
            </div>

            <div class="flex flex-col gap-2.5 border-t border-border pt-3">
              <div class="flex items-center justify-between gap-2">
                <span class="text-12px font-semibold">AI 会话 · {{ sessionList.length }}</span>
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
                v-if="sessionList.length === 0"
                class="text-12px text-muted-foreground p-3 border border-dashed border-border rounded-8 text-center bg-muted/50"
              >
                还没有会话，点击下方新建
              </div>

              <div
                v-for="conv in sessionList"
                :key="String(conv.key)"
                :class="[
                  'group relative flex flex-col gap-1.5 p-2.5 cursor-pointer',
                  styles.sessionRow,
                  { 'is-active': String(conv.key) === activeSessionKey },
                ]"
                @click="emit('openSession', String(conv.key))"
              >
                <!-- 顶部：标题 (支持双击 / 悬浮铅笔图标修改) + 状态/删除按钮 -->
                <div class="flex items-center justify-between gap-2 min-w-0">
                  <div
                    v-if="editingSessionKey === String(conv.key)"
                    class="flex items-center gap-1.5 flex-1 min-w-0"
                    @click.stop
                  >
                    <Input
                      v-model:value="editingSessionDraft"
                      size="small"
                      class="!text-xs !py-0.5"
                      autofocus
                      placeholder="输入新标题，按 Enter 保存..."
                      @keydown.enter.prevent="confirmEditSession(conv)"
                      @keydown.esc.prevent="cancelEditSession"
                      @blur="confirmEditSession(conv)"
                    />
                  </div>
                  <div v-else class="flex items-center gap-1.5 flex-1 min-w-0">
                    <span
                      class="text-12px font-medium text-foreground truncate cursor-pointer hover:text-primary transition-colors"
                      :title="`点击打开会话，双击修改标题：${conv.label}`"
                      @dblclick.stop="startEditSession(conv)"
                    >
                      {{ conv.label }}
                    </span>
                    <Tooltip title="修改标题">
                      <Button
                        type="text"
                        size="small"
                        :icon="h(Pencil)"
                        class="!w-4.5 !h-4.5 !p-0 opacity-0 group-hover:opacity-100 text-muted-foreground hover:!text-foreground transition-opacity flex-none"
                        @click.stop="startEditSession(conv)"
                      />
                    </Tooltip>
                  </div>
                  <div class="flex items-center gap-1 flex-none" @click.stop>
                    <!-- 没聊天过的支持删除；发过消息的不支持删除 -->
                    <Tooltip v-if="!hasChatted(conv)" title="删除未使用的会话">
                      <Button
                        type="text"
                        size="small"
                        danger
                        :icon="h(Trash2)"
                        class="!w-5.5 !h-5.5 !p-0 opacity-0 group-hover:opacity-100 hover:!bg-red-500/10 text-muted-foreground hover:!text-red-500 transition-opacity"
                        @click="handleDeleteSession(String(conv.key))"
                      />
                    </Tooltip>

                    <Tag
                      v-if="statusOf(conv) === 'running'"
                      color="blue"
                      class="!m-0 !inline-flex !items-center !gap-1"
                    >
                      <LoaderCircle class="animate-spin !h-2.5 !w-2.5" />
                      {{ elapsed(String(conv.key)) }}
                    </Tag>
                    <Tag v-else-if="statusOf(conv) === 'permission'" color="warning" class="!m-0"
                      >待确认</Tag
                    >
                    <Tag v-else-if="statusOf(conv) === 'queued'" color="purple" class="!m-0"
                      >排队</Tag
                    >
                    <Tag v-else-if="statusOf(conv) === 'stopped'" color="error" class="!m-0"
                      >已终止</Tag
                    >
                  </div>
                </div>

                <!-- 底部：所用模型展示 + 时间戳 + 消息量 -->
                <div
                  class="flex items-center justify-between gap-2 text-[11px] text-muted-foreground pt-1 border-t border-border/30"
                >
                  <div class="flex items-center gap-1.5 min-w-0">
                    <!-- 显示使用的模型 -->
                    <span
                      class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-muted/80 border border-border/50 text-[10px] font-medium text-foreground max-w-36 truncate"
                      :title="`使用的模型：${conv.modelId || getAgentName(conv.agentId)}`"
                    >
                      <Bot class="h-2.5 w-2.5 opacity-70 flex-none" />
                      <span class="truncate">{{ conv.modelId || getAgentName(conv.agentId) }}</span>
                    </span>

                    <span
                      v-if="hasChatted(conv)"
                      class="text-[10px] text-muted-foreground/70"
                      title="已产生对话记录（不支持删除）"
                    >
                      {{ conv.messages?.length }} 条消息
                    </span>
                  </div>

                  <span class="text-[10px] text-muted-foreground/60 flex-none">
                    {{ formatTime(conv.updatedAt) }}
                  </span>
                </div>
              </div>

              <div class="pt-2 border-t border-border/50">
                <Button type="primary" :icon="h(Plus)" block @click="handleCreateSession">
                  新建会话（{{ activeAgentLabel }}）
                </Button>
              </div>
            </div>
          </div>
        </div>

        <!-- 右：AI Chat -->
        <div class="flex-1 flex flex-col min-w-0 bg-background">
          <slot name="chat">
            <div class="flex-1 grid place-items-center p-8 text-center">
              <div class="flex flex-col items-center gap-3 max-w-sm">
                <div class="h-10 w-10 rounded-full bg-muted grid place-items-center">
                  <Plus class="h-5 w-5 text-muted-foreground" />
                </div>
                <div class="text-14px font-medium">在左侧选择或新建会话</div>
                <div class="text-12px text-muted-foreground leading-5">
                  会话将在此展示，任务信息保持在左侧，不用来回切换抽屉
                </div>
              </div>
            </div>
          </slot>
        </div>
      </div>

      <!-- 非 split 兼容 -->
      <div v-else class="flex flex-col h-100vh bg-background">
        <header class="flex items-center justify-between px-4 py-3 border-b border-border">
          <span class="inline-flex items-center gap-1.5 text-12px text-muted-foreground">
            <Folder class="!h-3 !w-3" /> {{ projectName }}
            <span :class="['text-11px rounded-full px-1.5 py-0.5', styles.immutableHint]"
              >创建后项目不可更改</span
            >
          </span>
          <Button type="text" size="small" @click="emit('close')">×</Button>
        </header>
        <div class="flex-1 overflow-auto p-4 flex flex-col gap-4">
          <Input
            v-model:value="localTitle"
            placeholder="任务标题"
            class="!text-20px !font-bold !border-0 !px-0 !py-1.5"
            @blur="saveTitle"
          />
          <TextArea v-model:value="localDescription" :rows="5" @blur="saveDescription" />
          <div
            v-for="conv in sessionList"
            :key="String(conv.key)"
            :class="['p-2.5', styles.sessionRow]"
            @click="emit('openSession', String(conv.key))"
          >
            {{ conv.label }}
          </div>
        </div>
      </div>
    </template>
  </Drawer>
</template>

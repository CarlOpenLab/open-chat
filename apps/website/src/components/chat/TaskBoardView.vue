<script setup lang="ts">
import { computed, h, onBeforeUnmount, ref, watch } from "vue";
import { Button, Dropdown, Input, Modal, Select, Tooltip } from "antdv-next";
import {
  Archive,
  CheckCircle2,
  Clock,
  Folder,
  FolderOpen,
  Layers,
  Moon,
  Plus,
  RotateCcw,
  Search,
  Settings,
  Sparkles,
  Sun,
  X,
} from "@lucide/vue";
import type { AgentView } from "../../services/acp";
import type { Task } from "../../services/taskStorage";
import type { OpenChatConversation } from "../../composables/useChatPersistence";
import { createStyles } from "../../theme/antdvStyle";
import {
  TASK_STATUS_META,
  TASK_STATUS_ORDER,
  type TaskPriority,
  type TaskStatus,
} from "../../utils/taskStatus";
import {
  deriveBoardStatus,
  hasPersistedError,
  type SessionStatus,
  type SessionStatusSignals,
} from "../../utils/sessionStatus";
import TaskCard from "./TaskCard.vue";

interface Props {
  tasks?: Task[];
  conversationList?: OpenChatConversation[];
  openTaskId?: string;
  statusSignals?: SessionStatusSignals;
  agents?: AgentView[];
  projectPathOptions?: string[];
  currentProjectPath?: string;
  dark?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  tasks: () => [],
  conversationList: () => [],
  openTaskId: "",
  statusSignals: () =>
    ({ busyStates: {}, permissionKeys: new Set(), stoppedKeys: new Set() }) as SessionStatusSignals,
  agents: () => [],
  projectPathOptions: () => [],
  currentProjectPath: "",
  dark: true,
});
const emit = defineEmits<{
  (e: "openTask", id: string): void;
  (e: "moveTask", id: string, status: TaskStatus): void;
  (
    e: "createTask",
    payload: {
      title: string;
      projectPath: string | null;
      templateId?: string;
      status?: TaskStatus;
    },
  ): void;
  (e: "updateTaskTitle", id: string, title: string): void;
  (e: "archiveTask", id: string): void;
  (e: "duplicateTask", id: string): void;
  (e: "deleteTask", id: string): void;
  (e: "createTaskForColumn", status: TaskStatus): void;
  (e: "openSettings"): void;
  (e: "toggleTheme"): void;
}>();

const useStyles = createStyles(({ token, css }) => ({
  boardWrap: css`
    background: var(--subtle, #f8f9fa);
  `,
  column: css`
    background: ${token.colorFillQuaternary};
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: 14px;
    width: 300px;
    transition: all ${token.motionDurationMid} ${token.motionEaseInOut};

    &.is-drag-over {
      background: ${token.colorPrimaryBgHover};
      border-color: ${token.colorPrimary};
      box-shadow: 0 0 0 2px ${token.colorPrimaryBg};
    }
  `,
  colDot: {
    todo: css`
      background: #94a3b8;
    `,
    doing: css`
      background: #3b82f6;
      box-shadow: 0 0 8px rgba(59, 130, 246, 0.6);
    `,
    review: css`
      background: #f59e0b;
      box-shadow: 0 0 8px rgba(245, 158, 11, 0.6);
    `,
    done: css`
      background: #10b981;
    `,
    archived: css`
      background: #94a3b8;
    `,
  },
  inlineCard: css`
    background: var(--card, #ffffff);
    border: 1px solid ${token.colorPrimaryBorder};
    border-radius: 12px;
    box-shadow: 0 4px 12px -2px rgba(0, 0, 0, 0.08);
  `,
}));

const { styles } = useStyles();

const nowTick = ref(Date.now());
let tickTimer: ReturnType<typeof setInterval> | undefined;
const stopTick = () => {
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = undefined;
};
const startTick = (periodMs: number) => {
  stopTick();
  tickTimer = setInterval(() => (nowTick.value = Date.now()), periodMs);
};
const hasBusy = computed(
  () => Object.keys((props.statusSignals ?? {}).busyStates ?? {}).length > 0,
);
watch(hasBusy, (busy) => startTick(busy ? 1000 : 30000), { immediate: true });
onBeforeUnmount(stopTick);

const search = ref("");
const selectedPriority = ref<TaskPriority | "">("");
const selectedProject = ref<string>("");
const sortBy = ref<"updatedAt" | "dueAt" | "priority" | "createdAt">("updatedAt");

const projectOptions = computed(() => {
  const set = new Set<string>();
  for (const t of props.tasks ?? []) if (t.projectPath) set.add(t.projectPath);
  for (const c of props.conversationList ?? []) if (c.projectPath) set.add(c.projectPath);
  return Array.from(set).map((p) => ({
    value: p,
    label: p.split(/[\\/]/).filter(Boolean).pop() ?? p,
  }));
});

const editingTaskId = ref("");

const conversationByKey = computed(() => {
  const map = new Map<string, OpenChatConversation>();
  for (const c of props.conversationList ?? []) map.set(String(c.key), c);
  return map;
});

const sessionStatusOfTask = (
  task: Task,
): { status: SessionStatus | "idle"; busyDuration: string; queued: number; error: string } => {
  if (!task.sessionKeys.length) return { status: "idle", busyDuration: "", queued: 0, error: "" };
  const lastKey = task.sessionKeys[task.sessionKeys.length - 1];
  const conv = conversationByKey.value.get(lastKey);
  if (!conv) return { status: "idle", busyDuration: "", queued: 0, error: "" };
  const status = deriveBoardStatus(
    conv as unknown as Record<string, unknown> & { key: string },
    props.statusSignals,
  );
  const busy = props.statusSignals.busyStates[lastKey];
  let busyDuration = "";
  if (busy?.startedAt) {
    const s = Math.max(0, Math.floor((nowTick.value - busy.startedAt) / 1000));
    busyDuration = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }
  const queued = (conv as unknown as { queuedMessages?: unknown[] })?.queuedMessages?.length ?? 0;
  const error = hasPersistedError(conv)
    ? ((conv as unknown as { lastError?: string }).lastError ?? "已终止")
    : "";
  return { status, busyDuration, queued, error };
};

const filteredTasks = computed(() => {
  let list = [...(props.tasks ?? [])];
  const q = search.value.trim().toLowerCase();
  if (q) {
    list = list.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.tags.some((tag) => tag.toLowerCase().includes(q)),
    );
  }
  if (selectedPriority.value) list = list.filter((t) => t.priority === selectedPriority.value);
  if (selectedProject.value) list = list.filter((t) => t.projectPath === selectedProject.value);
  list.sort((a, b) => {
    if (sortBy.value === "updatedAt") return b.updatedAt - a.updatedAt;
    if (sortBy.value === "createdAt") return b.createdAt - a.createdAt;
    if (sortBy.value === "dueAt") {
      const da = a.dueAt ?? Infinity;
      const db = b.dueAt ?? Infinity;
      return da - db;
    }
    if (sortBy.value === "priority") {
      const order: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
      const pa = a.priority ? (order[a.priority] ?? 9) : 9;
      const pb = b.priority ? (order[b.priority] ?? 9) : 9;
      return pa - pb;
    }
    return 0;
  });
  return list;
});

const showArchived = ref(false);
const archivedCount = computed(
  () => (props.tasks ?? []).filter((t) => t.status === "archived").length,
);

const visibleStatusList = computed(() => {
  if (showArchived.value) return TASK_STATUS_ORDER;
  return TASK_STATUS_ORDER.filter((s) => s !== "archived");
});

const columns = computed(() =>
  visibleStatusList.value.map((status) => ({
    status,
    meta: TASK_STATUS_META[status],
    items: filteredTasks.value.filter((t) => t.status === status),
  })),
);

const countsMap = computed(() => {
  const map: Record<string, number> = {};
  for (const t of props.tasks ?? []) {
    map[t.status] = (map[t.status] ?? 0) + 1;
  }
  return map;
});

const countsSummary = computed(() => {
  return `进行中 ${countsMap.value.doing ?? 0} · 待验收 ${countsMap.value.review ?? 0} · 已完成 ${countsMap.value.done ?? 0}`;
});

const inlineCreatingStatus = ref<TaskStatus | "">("");
const inlineTitle = ref("");

const startInlineCreate = (status: TaskStatus) => {
  inlineCreatingStatus.value = status;
  inlineTitle.value = "";
};

const cancelInlineCreate = () => {
  inlineCreatingStatus.value = "";
  inlineTitle.value = "";
};

const submitInlineCreate = (status: TaskStatus) => {
  const title = inlineTitle.value.trim();
  if (!title) {
    cancelInlineCreate();
    return;
  }
  emit("createTask", {
    title,
    projectPath: selectedProject.value || props.currentProjectPath || null,
    status,
  });
  cancelInlineCreate();
};

const hasActiveFilter = computed(() =>
  Boolean(search.value.trim() || selectedPriority.value || selectedProject.value),
);

const resetFilters = () => {
  search.value = "";
  selectedPriority.value = "";
  selectedProject.value = "";
};

const dragId = ref("");
const dragOverColumn = ref<TaskStatus | "">("");

const handleDragStart = (task: Task, event: DragEvent) => {
  dragId.value = task.id;
  event.dataTransfer?.setData("text/plain", task.id);
  if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
};
const handleDragEnd = () => {
  dragId.value = "";
  dragOverColumn.value = "";
};
const handleDragOver = (status: TaskStatus, event: DragEvent) => {
  if (!dragId.value) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  dragOverColumn.value = status;
};
const handleDragLeave = (event: DragEvent) => {
  const current = event.currentTarget as HTMLElement;
  if (current.contains(event.relatedTarget as Node | null)) return;
  dragOverColumn.value = "";
};
const handleDrop = (status: TaskStatus, event: DragEvent) => {
  event.preventDefault();
  const id = event.dataTransfer?.getData("text/plain") || dragId.value;
  handleDragEnd();
  if (id) emit("moveTask", id, status);
};

const showCreateModal = ref(false);
const createTitle = ref("");
const createStatus = ref<TaskStatus>("todo");
const createProjectPath = ref("");

const createProjectOptions = computed(() => {
  const set = new Set<string>();
  for (const p of props.projectPathOptions ?? []) if (p) set.add(p);
  for (const t of props.tasks ?? []) if (t.projectPath) set.add(t.projectPath);
  for (const c of props.conversationList ?? []) if (c.projectPath) set.add(c.projectPath);
  if (props.currentProjectPath) set.add(props.currentProjectPath);
  return Array.from(set).map((p) => ({
    value: p,
    label: p.split(/[\\/]/).filter(Boolean).pop() ?? p,
  }));
});

const openCreateModal = (status: TaskStatus = "todo") => {
  createStatus.value = status;
  createTitle.value = "";
  createProjectPath.value = props.currentProjectPath || selectedProject.value || "";
  showCreateModal.value = true;
};

const handleCreateFromModal = () => {
  const title = createTitle.value.trim();
  if (!title) return;
  emit("createTask", {
    title,
    projectPath: createProjectPath.value || null,
    status: createStatus.value,
  });
  showCreateModal.value = false;
};

const pickCreateProjectPath = async () => {
  try {
    const { aiService } = await import("../../services/ai");
    const res = await aiService.pickProjectPath();
    if (res?.path) createProjectPath.value = res.path;
  } catch {
    // ignore
  }
};

// 兼容旧逻辑：保留 quick 状态以免模板菜单等引用报错，实际走 modal
const quickTitle = ref("");
const showQuickCreate = ref(false);
const quickCreateStatus = ref<TaskStatus>("todo");
const quickProjectPath = ref("");
const quickProjectOptions = createProjectOptions;
const submitQuickCreate = handleCreateFromModal;
const pickQuickProjectPath = pickCreateProjectPath;

const templateMenu = computed(() => ({
  items: [
    { key: "blank", label: "空白任务" },
    { key: "bug", label: "修 Bug 模板" },
    { key: "feature", label: "新功能模板" },
    { key: "refactor", label: "重构模板" },
  ],
  onClick: ({ key }: { key: string | number }) => {
    emit("createTask", { title: "", projectPath: null, templateId: String(key) });
  },
}));
</script>

<template>
  <div :class="['flex min-h-0 flex-1 flex-col overflow-hidden', styles.boardWrap]">
    <!-- 现代两段式工具栏 -->
    <header
      class="sticky top-0 z-10 flex flex-col border-b border-border/80 bg-background/85 backdrop-blur-md shrink-0"
    >
      <!-- 首行：标题 + 核心指标胶囊 + 主操作 -->
      <div class="flex items-center justify-between gap-3 px-5 py-3">
        <div class="flex items-center gap-3">
          <div class="flex items-center gap-2">
            <h1 class="text-[16px] font-bold tracking-tight text-foreground m-0">任务看板</h1>
            <span
              class="text-[12px] font-medium text-muted-foreground bg-muted/70 px-2 py-0.5 rounded-full border border-border/40"
            >
              {{ (tasks ?? []).length }}
            </span>
          </div>

          <!-- 核心状态指标胶囊 -->
          <div
            class="hidden md:flex items-center gap-1.5 pl-3 border-l border-border/60 text-[12px]"
          >
            <span
              class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 font-medium"
            >
              <span class="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
              进行中 {{ countsMap.doing ?? 0 }}
            </span>
            <span
              class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 font-medium"
            >
              <span class="w-1.5 h-1.5 rounded-full bg-amber-500" />
              待验收 {{ countsMap.review ?? 0 }}
            </span>
            <span
              class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-medium"
            >
              <span class="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              已完成 {{ countsMap.done ?? 0 }}
            </span>
          </div>
        </div>

        <!-- 右侧主按钮组 -->
        <div class="flex items-center gap-2">
          <!-- 显示/隐藏已归档开关 -->
          <Button
            size="middle"
            :type="showArchived ? 'primary' : 'default'"
            :ghost="showArchived"
            :icon="h(Archive)"
            class="!text-xs"
            @click="showArchived = !showArchived"
          >
            {{ showArchived ? "隐藏归档" : `显示归档 (${archivedCount})` }}
          </Button>

          <!-- 模板下拉 -->
          <Dropdown :menu="templateMenu" :trigger="['click']">
            <Button :icon="h(Layers)" class="!text-xs">模板 ▾</Button>
          </Dropdown>

          <!-- 主操作：新建任务 -->
          <Button
            type="primary"
            :icon="h(Plus)"
            class="!font-medium !shadow-xs"
            @click="openCreateModal()"
          >
            新建任务
          </Button>

          <!-- 浅色/深色主题切换 -->
          <Tooltip :title="dark ? '切换为浅色模式' : '切换为深色模式'">
            <Button
              type="text"
              :icon="dark ? h(Sun) : h(Moon)"
              class="!w-8 !h-8 !p-0 !text-muted-foreground hover:!text-foreground hover:!bg-muted"
              @click="emit('toggleTheme')"
            />
          </Tooltip>

          <!-- 设置 -->
          <Tooltip title="设置">
            <Button
              type="text"
              :icon="h(Settings)"
              class="!w-8 !h-8 !p-0 !text-muted-foreground hover:!text-foreground hover:!bg-muted"
              @click="emit('openSettings')"
            />
          </Tooltip>
        </div>
      </div>

      <!-- 次行：检索与筛选条 -->
      <div
        class="flex items-center justify-between gap-3 px-5 py-2 bg-muted/20 border-t border-border/40 text-xs"
      >
        <div class="flex flex-wrap items-center gap-2.5">
          <Input
            v-model:value="search"
            placeholder="搜索标题、备注、标签..."
            allow-clear
            class="!w-56 !rounded-md !text-xs"
          >
            <template #prefix><Search class="!h-3.5 !w-3.5 text-muted-foreground mr-1" /></template>
          </Input>

          <Select
            v-model:value="selectedProject"
            placeholder="全部项目"
            allow-clear
            class="!min-w-32 !text-xs"
            :options="[{ value: '', label: '全部项目' }, ...projectOptions]"
          />

          <Select
            v-model:value="selectedPriority"
            placeholder="全部优先级"
            allow-clear
            class="!min-w-28 !text-xs"
            :options="[
              { value: '', label: '全部优先级' },
              { value: 'P0', label: 'P0 紧急' },
              { value: 'P1', label: 'P1 高' },
              { value: 'P2', label: 'P2 中' },
              { value: 'P3', label: 'P3 低' },
            ]"
          />

          <Select
            v-model:value="sortBy"
            class="!min-w-28 !text-xs"
            :options="[
              { value: 'updatedAt', label: '按更新时间' },
              { value: 'dueAt', label: '按截止时间' },
              { value: 'priority', label: '按优先级' },
              { value: 'createdAt', label: '按创建时间' },
            ]"
          />

          <Button
            v-if="hasActiveFilter"
            size="small"
            type="link"
            :icon="h(RotateCcw)"
            class="!text-xs !p-0 !text-muted-foreground hover:!text-foreground"
            @click="resetFilters"
          >
            重置筛选
          </Button>
        </div>

        <div v-if="hasActiveFilter" class="text-xs text-muted-foreground flex-none">
          找到 {{ filteredTasks.length }} 个任务
        </div>
      </div>
    </header>

    <!-- 泳道看板主体区域 -->
    <div class="flex-1 overflow-x-auto overflow-y-hidden p-5">
      <div class="flex gap-4.5 h-full min-w-max items-start">
        <section
          v-for="column in columns"
          :key="column.status"
          :class="[
            'flex flex-col max-h-full p-3 rounded-2xl flex-none shadow-xs',
            styles.column,
            { 'is-drag-over': dragOverColumn === column.status },
          ]"
          :style="{ width: '310px' }"
          :aria-label="`${column.meta.name}列，${column.items.length}个任务`"
          @dragover="handleDragOver(column.status, $event)"
          @dragleave="handleDragLeave"
          @drop="handleDrop(column.status, $event)"
        >
          <!-- 列头部 -->
          <header class="flex items-center justify-between pb-2.5 mb-2.5 border-b border-border/50">
            <div class="flex items-center gap-2 min-w-0">
              <span
                :class="[
                  'w-2 h-2 rounded-full flex-none',
                  (styles.colDot as Record<string, string>)[column.status],
                ]"
              />
              <span class="font-semibold text-[13px] tracking-tight text-foreground">{{
                column.meta.name
              }}</span>
              <span
                class="bg-background/90 border border-border/80 rounded-full px-2 py-0.2 text-[11px] font-semibold text-muted-foreground"
              >
                {{ column.items.length }}
              </span>
            </div>

            <div class="flex items-center gap-1">
              <span class="text-muted-foreground/70 text-[11px] mr-1 hidden sm:inline">{{
                column.meta.hint
              }}</span>
              <Tooltip :title="`在【${column.meta.name}】添加任务`">
                <Button
                  type="text"
                  size="small"
                  :icon="h(Plus)"
                  class="!w-6 !h-6 !p-0 !text-muted-foreground hover:!text-foreground hover:!bg-background"
                  @click="startInlineCreate(column.status)"
                />
              </Tooltip>
            </div>
          </header>

          <!-- 任务卡片列表（独立纵向滚动区） -->
          <div class="flex-1 overflow-y-auto p-1 pr-1.5 flex flex-col gap-2.5 min-h-32">
            <!-- 空状态 -->
            <div
              v-if="column.items.length === 0 && inlineCreatingStatus !== column.status"
              class="flex flex-col items-center justify-center p-6 border border-dashed border-border/70 rounded-xl text-center bg-background/30 transition-colors"
            >
              <span v-if="dragId" class="text-[12px] text-primary font-medium">松开移动到这里</span>
              <template v-else>
                <p class="text-[12px] text-muted-foreground/80 mb-2">
                  暂无{{ column.meta.name }}任务
                </p>
                <Button size="small" :icon="h(Plus)" @click="startInlineCreate(column.status)"
                  >添加任务</Button
                >
              </template>
            </div>

            <!-- 卡片项 -->
            <TaskCard
              v-for="task in column.items"
              :key="task.id"
              :task="task"
              :now-tick="nowTick"
              :session-status="sessionStatusOfTask(task).status"
              :session-busy-duration="sessionStatusOfTask(task).busyDuration"
              :session-queued-count="sessionStatusOfTask(task).queued"
              :session-error="sessionStatusOfTask(task).error"
              :is-open="task.id === openTaskId"
              :editing-title="editingTaskId === task.id"
              @open="emit('openTask', $event)"
              @drag-start="handleDragStart"
              @drag-end="handleDragEnd"
              @start-title-edit="editingTaskId = $event"
              @confirm-title-edit="
                (id: string, title: string) => {
                  editingTaskId = '';
                  emit('updateTaskTitle', id, title);
                }
              "
              @cancel-title-edit="editingTaskId = ''"
              @move-status="(id: string, status: TaskStatus) => emit('moveTask', id, status)"
              @archive="emit('archiveTask', $event)"
              @duplicate="emit('duplicateTask', $event)"
              @delete="emit('deleteTask', $event)"
            />

            <!-- 内联快捷创建卡片 -->
            <div
              v-if="inlineCreatingStatus === column.status"
              :class="['flex flex-col gap-2 p-3 mt-1', styles.inlineCard]"
            >
              <Input
                v-model:value="inlineTitle"
                placeholder="输入任务标题，按 Enter 保存..."
                autofocus
                size="small"
                class="!rounded-md"
                @press-enter="submitInlineCreate(column.status)"
                @keydown.esc="cancelInlineCreate"
              />
              <div class="flex items-center justify-between">
                <span class="text-[11px] text-muted-foreground">Esc 取消 · Enter 保存</span>
                <div class="flex items-center gap-1.5">
                  <Button size="small" type="text" @click="cancelInlineCreate">取消</Button>
                  <Button
                    size="small"
                    type="primary"
                    :disabled="!inlineTitle.trim()"
                    @click="submitInlineCreate(column.status)"
                  >
                    添加
                  </Button>
                </div>
              </div>
            </div>
          </div>

          <!-- 列底部快捷添加按钮（非内联编辑且非空时展示） -->
          <div
            v-if="inlineCreatingStatus !== column.status && column.items.length > 0"
            class="pt-2 mt-auto"
          >
            <Button
              type="dashed"
              block
              size="small"
              :icon="h(Plus)"
              class="!text-xs !text-muted-foreground hover:!text-foreground !rounded-lg"
              @click="startInlineCreate(column.status)"
            >
              添加任务
            </Button>
          </div>
        </section>
      </div>
    </div>

    <!-- 弹窗式完整创建 -->
    <Modal
      v-model:open="showCreateModal"
      title="新建任务"
      :ok-button-props="{ disabled: !createTitle.trim() }"
      ok-text="创建"
      cancel-text="取消"
      destroy-on-close
      @ok="handleCreateFromModal"
    >
      <div class="flex flex-col gap-4 py-2">
        <div class="flex flex-col gap-1.5">
          <span class="text-12px font-medium">任务标题</span>
          <Input
            v-model:value="createTitle"
            placeholder="输入任务标题"
            allow-clear
            autofocus
            @press-enter="handleCreateFromModal"
          />
        </div>
        <div class="flex flex-col gap-1.5">
          <span class="text-12px font-medium">工作目录</span>
          <div class="flex gap-2">
            <Select
              v-model:value="createProjectPath"
              :options="createProjectOptions"
              allowClear
              showSearch
              placeholder="未关联（可选）"
              class="flex-1"
            />
            <Button @click="pickCreateProjectPath">
              <template #icon><FolderOpen class="h-3.5 w-3.5" /></template>浏览
            </Button>
          </div>
          <span class="text-11px text-muted-foreground"
            >将创建到：{{ TASK_STATUS_META[createStatus].name }}</span
          >
        </div>
      </div>
    </Modal>
  </div>
</template>

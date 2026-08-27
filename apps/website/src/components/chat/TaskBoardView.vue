<script setup lang="ts">
import { computed, h, onBeforeUnmount, ref, watch } from "vue";
import { Button, Divider, Dropdown, Input, Modal, Select } from "antdv-next";
import { FolderOpen, Plus, Search } from "@lucide/vue";
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
}>();

const useStyles = createStyles(({ token, css }) => ({
  boardWrap: css`
    background: var(--brand-workspace);
  `,
  column: css`
    border-radius: 12px;
    transition: all ${token.motionDurationMid} ${token.motionEaseInOut};
    &.is-drag-over {
      background: ${token.colorPrimaryBgHover};
      border-color: ${token.colorPrimaryBorder};
      outline: 2px dashed ${token.colorPrimary};
      outline-offset: -2px;
    }
  `,
  colDot: {
    todo: css`
      background: ${token.colorTextQuaternary};
    `,
    doing: css`
      background: ${token.colorInfo};
    `,
    review: css`
      background: ${token.colorWarning};
    `,
    done: css`
      background: ${token.colorSuccess};
    `,
    archived: css`
      background: ${token.colorTextDisabled};
    `,
  },
  emptyIdle: css`
    border: 1px dashed ${token.colorBorder};
    background: transparent;
    color: ${token.colorTextSecondary};
    border-radius: 8px;
    transition:
      background ${token.motionDurationMid} ${token.motionEaseInOut},
      border-color ${token.motionDurationMid} ${token.motionEaseInOut},
      color ${token.motionDurationMid} ${token.motionEaseInOut};
    &:hover {
      border-color: ${token.colorBorder};
      background: ${token.colorFillQuaternary};
      color: ${token.colorText};
    }
  `,
  emptyDragOver: css`
    background: ${token.colorPrimaryBg};
    border: 1px dashed ${token.colorPrimary};
    color: ${token.colorPrimary};
    border-radius: 8px;
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

const columns = computed(() =>
  TASK_STATUS_ORDER.map((status) => ({
    status,
    meta: TASK_STATUS_META[status],
    items: filteredTasks.value.filter((t) => t.status === status),
  })),
);

const countsSummary = computed(() => {
  const map: Record<string, number> = {};
  for (const col of columns.value) map[col.status] = col.items.length;
  return `进行中 ${map.doing ?? 0} · 待验收 ${map.review ?? 0} · 已完成 ${map.done ?? 0}`;
});

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
    <header
      class="sticky top-0 z-10 flex min-h-13 flex-wrap items-center justify-between gap-3 px-4 py-2.5 border-b border-border bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60"
    >
      <div class="flex items-center gap-2.5">
        <h1 class="text-15px font-bold tracking-tight">任务看板</h1>
        <span class="text-12px text-muted-foreground"
          >{{ (tasks ?? []).length }} 个任务 · {{ countsSummary }}</span
        >
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <Input
          v-model:value="search"
          placeholder="搜索标题、备注、标签"
          allow-clear
          class="!w-45 !rounded-full"
        >
          <template #prefix><Search class="!h-3.5 !w-3.5 text-muted-foreground" /></template>
        </Input>
        <Select
          v-model:value="selectedProject"
          placeholder="全部项目"
          allow-clear
          class="!min-w-32"
          :options="[{ value: '', label: '全部项目' }, ...projectOptions]"
        />
        <Select
          v-model:value="selectedPriority"
          placeholder="全部优先级"
          allow-clear
          class="!min-w-30"
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
          class="!min-w-30"
          :options="[
            { value: 'updatedAt', label: '按更新时间' },
            { value: 'dueAt', label: '按截止时间' },
            { value: 'priority', label: '按优先级' },
            { value: 'createdAt', label: '按创建时间' },
          ]"
        />
        <Dropdown :menu="templateMenu" :trigger="['click']">
          <Button>模板 ▾</Button>
        </Dropdown>
        <Button type="primary" :icon="h(Plus)" @click="openCreateModal()">新建任务</Button>
      </div>
    </header>

    <div class="flex-1 overflow-auto p-4">
      <div class="flex gap-4 min-w-max h-full">
        <template v-for="column in columns" :key="column.status">
          <section
            :class="[
              'w-75 flex-none flex flex-col gap-3 p-3 rounded-12 min-h-130 ',
              styles.column,
              { 'is-drag-over': dragOverColumn === column.status },
            ]"
            :aria-label="`${column.meta.name}列，${column.items.length}个任务`"
            @dragover="handleDragOver(column.status, $event)"
            @dragleave="handleDragLeave"
            @drop="handleDrop(column.status, $event)"
          >
            <header class="flex items-center gap-1.5 text-12px pb-2 border-b border-border/40">
              <span
                :class="[
                  'w-2 h-2 rounded-full flex-none',
                  (styles.colDot as Record<string, string>)[column.status],
                ]"
              />
              <span class="font-semibold tracking-tight">{{ column.meta.name }}</span>
              <span
                class="bg-background border border-border rounded-full px-1.5 text-11px font-medium"
                >{{ column.items.length }}</span
              >
              <span class="text-muted-foreground text-11px ml-auto">{{ column.meta.hint }}</span>
            </header>
            <div class="flex flex-col gap-2.5 min-h-100">
              <div v-if="column.items.length === 0" class="min-h-24 flex flex-col">
                <div
                  v-if="dragId"
                  :class="[
                    'flex-1 grid place-items-center text-sm rounded-lg',
                    styles.emptyDragOver,
                  ]"
                >
                  松开移动到这里
                </div>
                <button
                  v-else
                  :class="[
                    'group flex w-full items-center justify-center gap-2 rounded-lg border border-dashed bg-transparent px-3 py-6 text-sm',
                    styles.emptyIdle,
                  ]"
                  @click="openCreateModal(column.status)"
                >
                  <span
                    class="grid h-7 w-7 place-items-center rounded-full bg-muted text-muted-foreground group-hover:bg-background group-hover:text-foreground border border-border/50 transition-colors"
                    ><Plus class="h-4 w-4"
                  /></span>
                  <span class="font-medium">新建</span>
                </button>
              </div>
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
            </div>
          </section>
          <Divider :vertical="true" class="h-full" dashed />
        </template>
      </div>
    </div>

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

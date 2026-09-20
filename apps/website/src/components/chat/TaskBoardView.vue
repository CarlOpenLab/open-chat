<script setup lang="ts">
import { computed, ref } from "vue";
import { useNow } from "../../composables/useNow";
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
import BoardColumn from "./BoardColumn.vue";
import BoardSkeleton from "./BoardSkeleton.vue";
import BoardToolbar from "./BoardToolbar.vue";
import TaskCreateModal from "./TaskCreateModal.vue";

interface Props {
  tasks?: Task[];
  conversationList?: OpenChatConversation[];
  openTaskId?: string;
  statusSignals?: SessionStatusSignals;
  agents?: AgentView[];
  projectPathOptions?: string[];
  currentProjectPath?: string;
  dark?: boolean;
  /** 本地状态水合中：显示骨架屏避免看板闪现空态 */
  loading?: boolean;
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
  loading: false,
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
  (e: "openSettings"): void;
  (e: "toggleTheme"): void;
}>();

const useStyles = createStyles(({ css }) => ({
  boardWrap: css`
    background: var(--subtle, #f8f9fa);
  `,
}));

const { styles } = useStyles();

const hasBusy = computed(
  () => Object.keys((props.statusSignals ?? {}).busyStates ?? {}).length > 0,
);
const nowTick = useNow(hasBusy);

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

/** 模板菜单：空标题 + 模板 id 交给业务层预填 */
const handleTemplateCreate = (templateId: string) => {
  emit("createTask", { title: "", projectPath: null, templateId });
};

/** 标题编辑提交：先退出编辑态，再把新标题上抛给业务层 */
const confirmTitleEdit = (id: string, title: string) => {
  editingTaskId.value = "";
  emit("updateTaskTitle", id, title);
};

/** 浏览工作目录：动态加载 aiService 选择目录（唯一服务依赖，留在容器层） */
const pickCreateProjectPath = async () => {
  try {
    const { aiService } = await import("../../services/ai");
    const res = await aiService.pickProjectPath();
    if (res?.path) createProjectPath.value = res.path;
  } catch {
    // ignore
  }
};
</script>

<template>
  <div :class="['flex min-h-0 flex-1 flex-col overflow-hidden', styles.boardWrap]">
    <!-- 现代两段式工具栏 -->
    <BoardToolbar
      :total-count="(tasks ?? []).length"
      :counts="countsMap"
      :archived-count="archivedCount"
      :show-archived="showArchived"
      :dark="dark"
      v-model:search="search"
      v-model:priority="selectedPriority"
      v-model:project="selectedProject"
      v-model:sort-by="sortBy"
      :project-options="projectOptions"
      :has-active-filter="hasActiveFilter"
      :filtered-count="filteredTasks.length"
      @reset="resetFilters"
      @toggle-archived="showArchived = !showArchived"
      @create="openCreateModal()"
      @template="handleTemplateCreate"
      @toggle-theme="emit('toggleTheme')"
      @open-settings="emit('openSettings')"
    />

    <!-- 泳道看板主体区域 -->
    <div class="flex-1 overflow-x-auto overflow-y-hidden p-5">
      <!-- 骨架屏：本地状态水合中 -->
      <BoardSkeleton v-if="loading" />

      <div v-else class="flex gap-4.5 h-full min-w-max items-start">
        <BoardColumn
          v-for="column in columns"
          :key="column.status"
          :status="column.status"
          :name="column.meta.name"
          :hint="column.meta.hint"
          :items="column.items"
          :now-tick="nowTick"
          :open-task-id="openTaskId"
          :editing-task-id="editingTaskId"
          :dragging="Boolean(dragId)"
          :drag-over="dragOverColumn === column.status"
          :resolve-session="sessionStatusOfTask"
          @open="emit('openTask', $event)"
          @drag-start="handleDragStart"
          @drag-end="handleDragEnd"
          @start-title-edit="editingTaskId = $event"
          @confirm-title-edit="confirmTitleEdit"
          @cancel-title-edit="editingTaskId = ''"
          @move-status="(id, status) => emit('moveTask', id, status)"
          @archive="emit('archiveTask', $event)"
          @duplicate="emit('duplicateTask', $event)"
          @delete="emit('deleteTask', $event)"
          @create="openCreateModal($event)"
          @dragover="handleDragOver"
          @dragleave="handleDragLeave"
          @drop="handleDrop"
        />
      </div>
    </div>

    <!-- 弹窗式完整创建 -->
    <TaskCreateModal
      v-model:open="showCreateModal"
      v-model:title="createTitle"
      :status="createStatus"
      v-model:project-path="createProjectPath"
      :project-options="createProjectOptions"
      @submit="handleCreateFromModal"
      @browse="pickCreateProjectPath"
    />
  </div>
</template>

<script setup lang="ts">
import { Archive, Copy, Ellipsis, Folder, LoaderCircle, Trash2 } from "@lucide/vue";
import { Button, Dropdown, Tag, Tooltip } from "antdv-next";
import { computed, h, ref } from "vue";
import type { Task } from "../../services/taskStorage";
import { createStyles } from "../../theme/antdvStyle";
import { TASK_PRIORITY_META } from "../../utils/taskStatus";
import type { SessionStatus } from "../../utils/sessionStatus";
import { SESSION_STATUS_META } from "../../utils/sessionStatus";

interface Props {
  task: Task;
  nowTick: number;
  sessionStatus: SessionStatus | "idle";
  sessionBusyDuration?: string;
  sessionQueuedCount?: number;
  sessionError?: string;
  isOpen: boolean;
  editingTitle: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  sessionBusyDuration: "",
  sessionQueuedCount: 0,
  sessionError: "",
  editingTitle: false,
});

const emit = defineEmits<{
  (e: "open", id: string): void;
  (e: "dragStart", task: Task, event: DragEvent): void;
  (e: "dragEnd"): void;
  (e: "startTitleEdit", id: string): void;
  (e: "confirmTitleEdit", id: string, title: string): void;
  (e: "cancelTitleEdit"): void;
  (e: "moveStatus", id: string, status: Task["status"]): void;
  (e: "archive", id: string): void;
  (e: "duplicate", id: string): void;
  (e: "delete", id: string): void;
}>();

const useStyles = createStyles(({ token, css }) => ({
  card: css`
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 10px;
    box-shadow: ${token.boxShadowTertiary};
    transition: all ${token.motionDurationMid} ${token.motionEaseInOut};
    &:hover {
      border-color: ${token.colorPrimaryBorder};
      box-shadow: ${token.boxShadow};
      transform: translateY(-1px);
    }
    &.is-open {
      border-color: ${token.colorPrimary};
      box-shadow:
        0 0 0 2px ${token.colorPrimaryBg},
        ${token.boxShadow};
    }
  `,
  dueOverdue: css`
    background: ${token.colorErrorBg};
    color: ${token.colorError};
    border-color: ${token.colorErrorBorder};
  `,
  dueToday: css`
    background: ${token.colorWarningBg};
    color: ${token.colorWarning};
    border-color: ${token.colorWarningBorder};
  `,
  priorityDot: css`
    width: 8px;
    height: 8px;
    border-radius: 999px;
    flex: none;
    box-shadow: 0 0 0 2px var(--card);
  `,
}));

const { styles } = useStyles();

const titleDraft = ref("");

const startEdit = () => {
  titleDraft.value = props.task.title;
  emit("startTitleEdit", props.task.id);
};

const confirm = () => {
  emit("confirmTitleEdit", props.task.id, titleDraft.value);
};

const projectName = computed(() => {
  const p = props.task.projectPath?.trim();
  return p ? (p.split(/[\\/]/).filter(Boolean).pop() ?? "") : "";
});

const relativeTime = (ts: number | null | undefined, now: number): string => {
  if (!ts) return "";
  const diff = Math.max(0, now - ts);
  const m = Math.floor(diff / 60000);
  if (m < 1) return "刚刚";
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  return `${Math.floor(h / 24)} 天前`;
};

const dueLabel = computed(() => {
  if (!props.task.dueAt) return "";
  const diff = props.task.dueAt - props.nowTick;
  const days = Math.floor(diff / 86400000);
  if (diff < 0) return `已逾期 ${Math.abs(days) || 1} 天`;
  if (days === 0) return "今天到期";
  if (days === 1) return "明天到期";
  return `${days} 天后到期`;
});

const dueClass = computed(() => {
  if (!props.task.dueAt) return "";
  if (props.task.dueAt < props.nowTick) return styles.dueOverdue;
  if (props.task.dueAt - props.nowTick < 86400000) return styles.dueToday;
  return "";
});

const priorityMeta = computed(() => {
  if (!props.task.priority) return null;
  return TASK_PRIORITY_META[props.task.priority];
});

const sessionBadgeText = computed(() => {
  if (props.sessionStatus === "idle") return "";
  if (props.sessionStatus === "running") return props.sessionBusyDuration || "运行中";
  return SESSION_STATUS_META[props.sessionStatus as SessionStatus]?.name ?? "";
});

const visibleTags = computed(() => props.task.tags.slice(0, 3));
const extraTagCount = computed(() => Math.max(0, props.task.tags.length - 3));

const menu = computed(() => ({
  items: [
    { key: "doing", label: "移至 进行中" },
    { key: "review", label: "移至 待验收" },
    { key: "done", label: "移至 已完成" },
    { key: "archived", label: "归档", icon: h(Archive) },
    { type: "divider" as const },
    { key: "duplicate", label: "基于此再建", icon: h(Copy) },
    { type: "divider" as const },
    { key: "delete", label: "删除任务", icon: h(Trash2), danger: true },
  ],
  onClick: ({ key }: { key: string | number }) => {
    const k = String(key);
    if (k === "delete") emit("delete", props.task.id);
    else if (k === "duplicate") emit("duplicate", props.task.id);
    else if (k === "archived") emit("archive", props.task.id);
    else if (["todo", "doing", "review", "done", "archived"].includes(k))
      emit("moveStatus", props.task.id, k as Task["status"]);
  },
}));
</script>

<template>
  <article
    :class="['flex flex-col gap-2.5 p-3.5 cursor-pointer', styles.card, { 'is-open': isOpen }]"
    role="button"
    tabindex="0"
    draggable="true"
    :data-task-id="task.id"
    :aria-label="`打开任务：${task.title}`"
    @click="!editingTitle && emit('open', task.id)"
    @keydown.enter.prevent="!editingTitle && emit('open', task.id)"
    @keydown.space.prevent="!editingTitle && emit('open', task.id)"
    @dragstart="emit('dragStart', task, $event)"
    @dragend="emit('dragEnd')"
  >
    <!-- 标题行：unocss 布局 + token 样式 -->
    <div class="flex items-center gap-2 min-w-0">
      <span
        v-if="priorityMeta"
        :class="styles.priorityDot"
        :style="{ background: priorityMeta.color }"
        :title="priorityMeta.label"
      ></span>
      <template v-if="editingTitle">
        <input
          v-model="titleDraft"
          class="flex-1 min-w-0 text-[13px] font-semibold border border-primary rounded-6 px-1.5 py-0.5 outline-none bg-background"
          autofocus
          @click.stop
          @keydown.enter.prevent="confirm"
          @keydown.esc.prevent="emit('cancelTitleEdit')"
          @blur="confirm"
        />
      </template>
      <template v-else>
        <Tooltip :title="task.title" placement="top">
          <span
            class="flex-1 min-w-0 text-[14px] font-medium leading-5 truncate"
            @dblclick.stop="startEdit"
            >{{ task.title }}</span
          >
        </Tooltip>
      </template>
      <Dropdown :menu="menu" :trigger="['click']">
        <Button
          type="text"
          size="small"
          :icon="h(Ellipsis)"
          class="!w-5.5 !h-5.5 !p-0"
          :aria-label="`任务操作：${task.title}`"
          @click.stop
        />
      </Dropdown>
    </div>

    <!-- 标签/项目：复用 Tag 组件 -->
    <div v-if="task.tags.length || projectName" class="flex flex-wrap items-center gap-1.5">
      <Tag
        v-for="tag in visibleTags"
        :key="tag"
        size="small"
        class="!m-0 !text-12px !rounded-4 !border-0 !bg-fill-quaternary !text-text-secondary"
        >{{ tag }}</Tag
      >
      <span v-if="extraTagCount > 0" class="text-12px text-muted-foreground"
        >+{{ extraTagCount }}</span
      >
      <span
        v-if="projectName"
        class="inline-flex items-center gap-1 text-12px text-muted-foreground"
      >
        <Folder class="!h-3 !w-3 flex-none" />
        {{ projectName }}
      </span>
    </div>

    <div v-if="task.description" class="text-[13px] leading-5.5 text-text-secondary line-clamp-2">
      {{ task.description.slice(0, 90) }}
    </div>

    <div class="flex flex-wrap items-center gap-1.5 text-12px">
      <Tag
        v-if="dueLabel"
        :class="dueClass"
        class="!text-11px !px-1.5 !py-0 !leading-4 !rounded-full !border"
        >{{ dueLabel }}</Tag
      >
      <span class="text-muted-foreground">{{ relativeTime(task.updatedAt, nowTick) }}</span>
      <span v-if="task.sessionKeys.length" class="text-muted-foreground"
        >{{ task.sessionKeys.length }} 个会话</span
      >
      <Tag
        v-if="sessionStatus === 'running'"
        color="blue"
        class="!inline-flex !items-center !gap-1 !m-0"
        ><LoaderCircle class="animate-spin !h-2.5 !w-2.5" />{{ sessionBadgeText }}</Tag
      >
      <Tag v-else-if="sessionStatus === 'queued'" color="purple" class="!m-0"
        >排队 · {{ sessionQueuedCount }}</Tag
      >
      <Tag v-else-if="sessionStatus === 'permission'" color="warning" class="!m-0">待确认</Tag>
      <Tooltip
        v-else-if="sessionStatus === 'stopped'"
        :title="sessionError || '已终止'"
        placement="top"
        ><Tag color="error" class="!m-0">已终止</Tag></Tooltip
      >
      <Tag v-else-if="sessionStatus === 'done'" color="success" class="!m-0">已完成</Tag>
      <Tag v-else class="!m-0">未开始</Tag>
    </div>
  </article>
</template>

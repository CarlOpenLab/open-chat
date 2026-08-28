<script setup lang="ts">
import {
  Archive,
  Bot,
  Calendar,
  Clock,
  Copy,
  Ellipsis,
  Folder,
  LoaderCircle,
  Trash2,
} from "@lucide/vue";
import { Button, Dropdown, Tooltip } from "antdv-next";
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
    background: var(--card, #ffffff);
    border: 1px solid var(--border);
    border-radius: 12px;
    box-shadow:
      0 1px 3px rgba(0, 0, 0, 0.04),
      0 1px 2px rgba(0, 0, 0, 0.02);
    transition: all ${token.motionDurationMid} ${token.motionEaseInOut};
    cursor: grab;
    user-select: none;

    &:hover {
      border-color: ${token.colorPrimaryBorder};
      box-shadow:
        0 0 0 1px ${token.colorPrimaryBorder},
        0 4px 12px -2px rgba(0, 0, 0, 0.08),
        0 2px 6px -1px rgba(0, 0, 0, 0.04);
    }

    &:active {
      cursor: grabbing;
    }

    &.is-open {
      border-color: ${token.colorPrimary};
      box-shadow:
        0 0 0 2px ${token.colorPrimaryBg},
        0 4px 12px rgba(0, 0, 0, 0.06);
    }

    &.is-dragging {
      opacity: 0.5;
      transform: scale(0.98);
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
  dueNormal: css`
    background: ${token.colorFillQuaternary};
    color: ${token.colorTextSecondary};
    border-color: ${token.colorBorderSecondary};
  `,
}));

const { styles } = useStyles();

const isDragging = ref(false);
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
  if (m < 60) return `${m}m 前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h 前`;
  return `${Math.floor(h / 24)}d 前`;
};

const dueLabel = computed(() => {
  if (!props.task.dueAt) return "";
  const diff = props.task.dueAt - props.nowTick;
  const days = Math.floor(diff / 86400000);
  if (diff < 0) return `逾期 ${Math.abs(days) || 1} 天`;
  if (days === 0) return "今天截止";
  if (days === 1) return "明天截止";
  return `${days} 天后`;
});

const dueClass = computed(() => {
  if (!props.task.dueAt) return "";
  if (props.task.dueAt < props.nowTick) return styles.dueOverdue;
  if (props.task.dueAt - props.nowTick < 86400000) return styles.dueToday;
  return styles.dueNormal;
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
    { key: "todo", label: "移至 待办" },
    { key: "doing", label: "移至 进行中" },
    { key: "review", label: "移至 待验收" },
    { key: "done", label: "移至 已完成" },
    { key: "archived", label: "移至 归档", icon: h(Archive) },
    { type: "divider" as const },
    { key: "duplicate", label: "复制此任务", icon: h(Copy) },
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

const onDragStart = (e: DragEvent) => {
  isDragging.value = true;
  emit("dragStart", props.task, e);
};

const onDragEnd = () => {
  isDragging.value = false;
  emit("dragEnd");
};
</script>

<template>
  <article
    :class="[
      'group relative flex flex-col gap-2.5 p-3.5',
      styles.card,
      { 'is-open': isOpen, 'is-dragging': isDragging },
    ]"
    role="button"
    tabindex="0"
    draggable="true"
    :data-task-id="task.id"
    :aria-label="`打开任务：${task.title}`"
    @click="!editingTitle && emit('open', task.id)"
    @keydown.enter.prevent="!editingTitle && emit('open', task.id)"
    @keydown.space.prevent="!editingTitle && emit('open', task.id)"
    @dragstart="onDragStart"
    @dragend="onDragEnd"
  >
    <!-- 第一行：元信息（优先级勋章 + 关联项目 + 操作菜单） -->
    <div class="flex items-center justify-between gap-2 min-w-0">
      <div class="flex items-center gap-1.5 min-w-0 flex-wrap">
        <!-- 优先级勋章（Linear 风格） -->
        <span
          v-if="priorityMeta"
          class="inline-flex items-center gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded-md border"
          :style="{
            color: priorityMeta.color,
            borderColor: `${priorityMeta.color}33`,
            backgroundColor: `${priorityMeta.color}12`,
          }"
          :title="`优先级：${priorityMeta.label}`"
        >
          <span class="w-1.5 h-1.5 rounded-full" :style="{ backgroundColor: priorityMeta.color }" />
          {{ task.priority }}
        </span>

        <!-- 关联项目标签 -->
        <span
          v-if="projectName"
          class="inline-flex items-center gap-1 text-[11px] text-muted-foreground bg-muted/60 border border-border/40 px-1.5 py-0.5 rounded-md max-w-35 truncate"
          :title="task.projectPath ?? ''"
        >
          <Folder class="h-3 w-3 flex-none opacity-70" />
          <span class="truncate">{{ projectName }}</span>
        </span>
      </div>

      <!-- 右侧操作菜单（悬浮展示或低调常驻） -->
      <Dropdown :menu="menu" :trigger="['click']">
        <Button
          type="text"
          size="small"
          :icon="h(Ellipsis)"
          class="!w-6 !h-6 !p-0 opacity-0 group-hover:opacity-100 transition-opacity !text-muted-foreground hover:!text-foreground hover:!bg-muted"
          :aria-label="`任务操作：${task.title}`"
          @click.stop
        />
      </Dropdown>
    </div>

    <!-- 第二行：任务标题 -->
    <div class="min-w-0">
      <template v-if="editingTitle">
        <input
          v-model="titleDraft"
          class="w-full text-[13px] font-medium border border-primary rounded-md px-2 py-1 outline-none bg-background shadow-sm"
          autofocus
          @click.stop
          @keydown.enter.prevent="confirm"
          @keydown.esc.prevent="emit('cancelTitleEdit')"
          @blur="confirm"
        />
      </template>
      <template v-else>
        <Tooltip :title="task.title" placement="top" :mouse-enter-delay="0.6">
          <h3
            class="text-[13.5px] font-medium leading-snug text-foreground tracking-tight line-clamp-2 hover:text-primary transition-colors m-0"
            @dblclick.stop="startEdit"
          >
            {{ task.title }}
          </h3>
        </Tooltip>
      </template>
    </div>

    <!-- 第三行：描述摘要预览 -->
    <div
      v-if="task.description"
      class="text-[12px] leading-relaxed text-muted-foreground/80 line-clamp-2"
    >
      {{ task.description }}
    </div>

    <!-- 第四行：标签组 -->
    <div v-if="task.tags.length" class="flex flex-wrap items-center gap-1.5">
      <span
        v-for="tag in visibleTags"
        :key="tag"
        class="text-[11px] px-1.5 py-0.5 rounded-md bg-muted/60 text-muted-foreground border border-border/40 font-normal"
      >
        #{{ tag }}
      </span>
      <span
        v-if="extraTagCount > 0"
        class="text-[11px] px-1 py-0.5 text-muted-foreground font-medium"
      >
        +{{ extraTagCount }}
      </span>
    </div>

    <!-- 第五行：底部栏（日期/更新时间 + AI 会话状态） -->
    <div
      class="pt-2 border-t border-border/40 flex items-center justify-between gap-2 text-[11px] mt-auto"
    >
      <!-- 左侧：截止状态与更新时间 -->
      <div class="flex items-center gap-2 min-w-0">
        <span
          v-if="dueLabel"
          :class="[
            dueClass,
            'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-[10.5px] font-medium',
          ]"
        >
          <Calendar class="h-3 w-3 opacity-80" />
          {{ dueLabel }}
        </span>
        <span
          class="text-muted-foreground/70 text-[11px] flex items-center gap-1"
          :title="task.updatedAt ? `更新于 ${new Date(task.updatedAt).toLocaleString()}` : ''"
        >
          <Clock class="h-3 w-3 opacity-60" />
          {{ relativeTime(task.updatedAt, nowTick) }}
        </span>
      </div>

      <!-- 右侧：AI 伴生会话状态（核心能力展示） -->
      <div class="flex items-center gap-1.5 flex-none">
        <!-- 运行中：呼吸发光动效 + 实时执行时长 -->
        <span
          v-if="sessionStatus === 'running'"
          class="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 shadow-xs animate-pulse"
        >
          <LoaderCircle class="animate-spin h-3 w-3 text-blue-500" />
          {{ sessionBadgeText }}
        </span>

        <!-- 等待确认权限 -->
        <span
          v-else-if="sessionStatus === 'permission'"
          class="inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20"
        >
          <span class="w-1.5 h-1.5 rounded-full bg-amber-500 animate-ping" />
          待确认
        </span>

        <!-- 排队中 -->
        <span
          v-else-if="sessionStatus === 'queued'"
          class="inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded-full bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20"
        >
          排队 · {{ sessionQueuedCount }}
        </span>

        <!-- 异常终止 -->
        <Tooltip
          v-else-if="sessionStatus === 'stopped'"
          :title="sessionError || '会话已终止'"
          placement="top"
        >
          <span
            class="inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded-full bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20 cursor-help"
          >
            异常终止
          </span>
        </Tooltip>

        <!-- 已完成 -->
        <span
          v-else-if="sessionStatus === 'done'"
          class="inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
        >
          已完成
        </span>

        <!-- 空闲状态下，若有关联会话，仅展示会话数徽章；若无，不展示多余的'未开始'标签 -->
        <span
          v-else-if="task.sessionKeys.length"
          class="inline-flex items-center gap-1 text-[11px] text-muted-foreground/80 bg-muted/60 px-1.5 py-0.5 rounded-md border border-border/40"
          :title="`${task.sessionKeys.length} 个关联 AI 会话`"
        >
          <Bot class="h-3 w-3 opacity-70" />
          {{ task.sessionKeys.length }}
        </span>
      </div>
    </div>
  </article>
</template>

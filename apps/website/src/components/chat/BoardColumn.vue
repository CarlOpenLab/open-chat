<script setup lang="ts">
/**
 * BoardColumn：看板单列（纯展示）。
 *
 * 结构：列头（状态点 / 名称 / 数量 / 提示）+ 独立纵向滚动区 + TaskCard 列表 + 空态。
 * 卡片的会话徽标信号由容器通过 resolveSession 注入；拖拽落点判定也由容器持有，
 * 本列只把原生拖拽事件与状态上抛，并按 dragOver 回显悬停高亮。
 */
import { Plus } from "@lucide/vue";
import { Button } from "antdv-next";
import { computed, h } from "vue";
import type { Task } from "../../services/taskStorage";
import { createStyles } from "../../theme/antdvStyle";
import type { SessionStatus } from "../../utils/sessionStatus";
import type { TaskStatus } from "../../utils/taskStatus";
import TaskCard from "./TaskCard.vue";

/** TaskCard 会话徽标所需的信号（由容器从会话数据 + 运行信号推导） */
interface CardSession {
  status: SessionStatus | "idle";
  busyDuration: string;
  queued: number;
  error: string;
}

interface Props {
  /** 本列对应的任务状态 */
  status: TaskStatus;
  /** 状态名称 */
  name: string;
  /** 状态提示语（列头右侧） */
  hint: string;
  /** 本列任务（已筛选排序） */
  items: Task[];
  /** 全局时间刻度：驱动相对时间与截止日 */
  nowTick: number;
  /** 当前展开（抽屉打开）的任务 id */
  openTaskId: string;
  /** 正在内联编辑标题的任务 id */
  editingTaskId: string;
  /** 是否有卡片正在被拖拽：空态文案切换为落点提示 */
  dragging: boolean;
  /** 当前拖拽悬停在本列 */
  dragOver: boolean;
  /** 卡片会话徽标解析：容器负责状态推导，列组件保持无状态 */
  resolveSession: (task: Task) => CardSession;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  (e: "open", id: string): void;
  (e: "dragStart", task: Task, event: DragEvent): void;
  (e: "dragEnd"): void;
  (e: "startTitleEdit", id: string): void;
  (e: "confirmTitleEdit", id: string, title: string): void;
  (e: "cancelTitleEdit"): void;
  (e: "moveStatus", id: string, status: TaskStatus): void;
  (e: "archive", id: string): void;
  (e: "duplicate", id: string): void;
  (e: "delete", id: string): void;
  /** 空态「添加任务」：容器按本列状态打开创建弹窗 */
  (e: "create", status: TaskStatus): void;
  (e: "dragover", status: TaskStatus, event: DragEvent): void;
  (e: "dragleave", event: DragEvent): void;
  (e: "drop", status: TaskStatus, event: DragEvent): void;
}>();

const useStyles = createStyles(({ token, css }) => ({
  column: css`
    background: var(--fill-faint);
    border: 1px solid var(--border);
    border-radius: 14px;
    width: 300px;
    transition: all ${token.motionDurationMid} ${token.motionEaseInOut};

    &.is-drag-over {
      background: var(--primary-subtle-hover);
      border-color: var(--brand-accent);
      box-shadow:
        0 0 0 1px var(--brand-accent),
        inset 0 0 24px hsla(14, 62%, 62%, 0.08);
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
}));

const { styles } = useStyles();

/** 卡片渲染模型：会话信号每个任务只解析一次，避免模板内重复推导 */
const cards = computed(() =>
  props.items.map((task) => ({ task, session: props.resolveSession(task) })),
);
</script>

<template>
  <section
    :class="[
      'flex flex-col max-h-full p-3 rounded-2xl flex-none shadow-xs',
      styles.column,
      { 'is-drag-over': dragOver },
    ]"
    :style="{ width: '310px' }"
    :aria-label="`${name}列，${items.length}个任务`"
    @dragover="emit('dragover', status, $event)"
    @dragleave="emit('dragleave', $event)"
    @drop="emit('drop', status, $event)"
  >
    <!-- 列头部 -->
    <header class="flex items-center justify-between pb-2.5 mb-2.5 border-b border-border/50">
      <div class="flex items-center gap-2 min-w-0">
        <span
          :class="[
            'w-2 h-2 rounded-full flex-none',
            (styles.colDot as Record<string, string>)[status],
          ]"
        />
        <span class="font-semibold text-[13px] tracking-tight text-foreground">{{ name }}</span>
        <span
          class="bg-background/90 border border-border/80 rounded-full px-2 py-0.2 text-[11px] font-semibold text-muted-foreground"
        >
          {{ items.length }}
        </span>
      </div>

      <div class="flex items-center gap-1">
        <span class="text-muted-foreground/70 text-[11px] mr-1 hidden sm:inline">{{ hint }}</span>
      </div>
    </header>

    <!-- 任务卡片列表（独立纵向滚动区） -->
    <div class="flex-1 overflow-y-auto p-1 pr-1.5 flex flex-col gap-2.5 min-h-32">
      <!-- 空状态：提示 + 快捷创建入口 -->
      <div
        v-if="items.length === 0"
        class="flex flex-col items-center justify-center p-6 border border-dashed border-border/70 rounded-xl text-center bg-background/30 transition-colors"
      >
        <span v-if="dragging" class="text-[12px] text-brand-accent font-medium"
          >松开移动到这里</span
        >
        <template v-else>
          <p class="text-[12px] text-muted-foreground/80">暂无{{ name }}任务</p>
          <Button
            size="small"
            type="link"
            :icon="h(Plus)"
            class="!text-xs !p-0 mt-1 !text-brand-accent"
            @click="emit('create', status)"
          >
            添加任务
          </Button>
        </template>
      </div>

      <!-- 卡片项 -->
      <TaskCard
        v-for="card in cards"
        :key="card.task.id"
        :task="card.task"
        :now-tick="nowTick"
        :session-status="card.session.status"
        :session-busy-duration="card.session.busyDuration"
        :session-queued-count="card.session.queued"
        :session-error="card.session.error"
        :is-open="card.task.id === openTaskId"
        :editing-title="editingTaskId === card.task.id"
        @open="emit('open', $event)"
        @drag-start="(task, event) => emit('dragStart', task, event)"
        @drag-end="emit('dragEnd')"
        @start-title-edit="emit('startTitleEdit', $event)"
        @confirm-title-edit="(id, title) => emit('confirmTitleEdit', id, title)"
        @cancel-title-edit="emit('cancelTitleEdit')"
        @move-status="(id, status) => emit('moveStatus', id, status)"
        @archive="emit('archive', $event)"
        @duplicate="emit('duplicate', $event)"
        @delete="emit('delete', $event)"
      />
    </div>
  </section>
</template>

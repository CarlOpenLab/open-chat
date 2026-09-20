<script setup lang="ts">
/**
 * BoardToolbar：看板顶部两段式工具栏（纯展示）。
 *
 * 上段：标题 + 任务总数 + 进行中/待验收/已完成指标胶囊，以及显示归档、模板、
 * 新建任务、主题切换、设置等主操作；
 * 下段：搜索、项目、优先级、排序筛选条 + 命中数量 + 重置入口。
 *
 * 所有筛选值均为受控 prop（v-model:xxx），筛选计算、归档开关与创建弹窗由容器
 * （TaskBoardView）持有；模板菜单只上抛模板 id，由容器转成 createTask 载荷。
 */
import { Archive, Layers, Moon, Plus, RotateCcw, Search, Settings, Sun } from "@lucide/vue";
import { Button, Dropdown, Input, Select, Tooltip } from "antdv-next";
import { computed, h } from "vue";
import type { TaskPriority } from "../../utils/taskStatus";

interface Props {
  /** 任务总数（含归档） */
  totalCount: number;
  /** 各状态任务数（按任务状态聚合） */
  counts: Record<string, number>;
  /** 已归档任务数 */
  archivedCount: number;
  /** 是否显示已归档列 */
  showArchived: boolean;
  /** 当前为深色主题：决定主题切换按钮的图标与提示文案 */
  dark: boolean;
  /** 搜索关键词（受控） */
  search: string;
  /** 优先级筛选，空值表示全部（受控） */
  priority: TaskPriority | "";
  /** 项目筛选，空值表示全部（受控） */
  project: string;
  /** 排序方式（受控） */
  sortBy: "updatedAt" | "dueAt" | "priority" | "createdAt";
  /** 项目下拉选项 */
  projectOptions: { value: string; label: string }[];
  /** 是否有生效中的筛选条件 */
  hasActiveFilter: boolean;
  /** 当前筛选命中数量 */
  filteredCount: number;
}

defineProps<Props>();

const emit = defineEmits<{
  (e: "update:search", value: string): void;
  (e: "update:priority", value: TaskPriority | ""): void;
  (e: "update:project", value: string): void;
  (e: "update:sortBy", value: "updatedAt" | "dueAt" | "priority" | "createdAt"): void;
  /** 重置全部筛选条件 */
  (e: "reset"): void;
  /** 切换已归档列的显示 */
  (e: "toggleArchived"): void;
  /** 新建任务（默认待办列） */
  (e: "create"): void;
  /** 模板菜单选中：容器负责把模板 id 转成 createTask 载荷 */
  (e: "template", id: string): void;
  (e: "toggleTheme"): void;
  (e: "openSettings"): void;
}>();

/** 模板下拉：只上抛模板 id，预填内容由业务层的模板表决定 */
const templateMenu = computed(() => ({
  items: [
    { key: "blank", label: "空白任务" },
    { key: "bug", label: "修 Bug 模板" },
    { key: "feature", label: "新功能模板" },
    { key: "refactor", label: "重构模板" },
  ],
  onClick: ({ key }: { key: string | number }) => {
    emit("template", String(key));
  },
}));
</script>

<template>
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
            {{ totalCount }}
          </span>
        </div>

        <!-- 核心状态指标胶囊 -->
        <div class="hidden md:flex items-center gap-1.5 pl-3 border-l border-border/60 text-[12px]">
          <span
            class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 font-medium"
          >
            <span class="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
            进行中 {{ counts.doing ?? 0 }}
          </span>
          <span
            class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 font-medium"
          >
            <span class="w-1.5 h-1.5 rounded-full bg-amber-500" />
            待验收 {{ counts.review ?? 0 }}
          </span>
          <span
            class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-medium"
          >
            <span class="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            已完成 {{ counts.done ?? 0 }}
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
          @click="emit('toggleArchived')"
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
          @click="emit('create')"
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
          :value="search"
          placeholder="搜索标题、备注、标签..."
          allow-clear
          class="!w-56 !rounded-md !text-xs"
          @update:value="emit('update:search', $event)"
        >
          <template #prefix><Search class="!h-3.5 !w-3.5 text-muted-foreground mr-1" /></template>
        </Input>

        <Select
          :value="project"
          placeholder="全部项目"
          allow-clear
          class="!min-w-32 !text-xs"
          :options="[{ value: '', label: '全部项目' }, ...projectOptions]"
          @update:value="emit('update:project', $event)"
        />

        <Select
          :value="priority"
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
          @update:value="emit('update:priority', $event)"
        />

        <Select
          :value="sortBy"
          class="!min-w-28 !text-xs"
          :options="[
            { value: 'updatedAt', label: '按更新时间' },
            { value: 'dueAt', label: '按截止时间' },
            { value: 'priority', label: '按优先级' },
            { value: 'createdAt', label: '按创建时间' },
          ]"
          @update:value="emit('update:sortBy', $event)"
        />

        <Button
          v-if="hasActiveFilter"
          size="small"
          type="link"
          :icon="h(RotateCcw)"
          class="!text-xs !p-0 !text-muted-foreground hover:!text-foreground"
          @click="emit('reset')"
        >
          重置筛选
        </Button>
      </div>

      <div v-if="hasActiveFilter" class="text-xs text-muted-foreground flex-none">
        找到 {{ filteredCount }} 个任务
      </div>
    </div>
  </header>
</template>

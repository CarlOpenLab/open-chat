<script setup lang="ts">
import { Button, DatePicker, Input, Select, TextArea } from "antdv-next";
import { computed, ref, watch } from "vue";
import type { Task } from "../../services/taskStorage";
import { TASK_STATUS_META } from "../../utils/taskStatus";
import type { TaskStatus } from "../../utils/taskStatus";

interface Props {
  task: Task;
  /** 可选工作目录：与任务当前目录合并去重后作为下拉选项。 */
  projectPathOptions?: string[];
  /** 非 split 抽屉的精简表单：仅标题 + 备注。 */
  compact?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  projectPathOptions: () => [],
  compact: false,
});

const emit = defineEmits<{
  (e: "patch", patch: Partial<Task>): void;
  (e: "pickDirectory"): void;
}>();

const localTitle = ref("");
const localDescription = ref("");
const localTagsInput = ref("");

watch(
  () => props.task,
  (t: Task) => {
    localTitle.value = t.title;
    localDescription.value = t.description;
    localTagsInput.value = t.tags.join(", ");
  },
  { immediate: true },
);

const saveTitle = () => {
  const title = localTitle.value.trim() || "未命名任务";
  if (title !== props.task.title) emit("patch", { title });
};

const saveDescription = () => {
  if (localDescription.value !== props.task.description)
    emit("patch", { description: localDescription.value });
};

const saveTags = () => {
  const tags = localTagsInput.value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  emit("patch", { tags });
};

/** 本地时区日期，避免 toISOString 的 UTC 偏移导致日期串移位 */
const localDateOf = (ts: number): string => {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

/** 截止日期存当天本地 23:59:59.999：当天截止当天内不算逾期 */
const dueAtFromPicker = (v: string): number => new Date(`${v}T23:59:59.999`).getTime();

const projectPathSelectOptions = computed(() => {
  const set = new Set<string>();
  for (const p of props.projectPathOptions) if (p) set.add(p);
  if (props.task.projectPath) set.add(props.task.projectPath);
  return Array.from(set).map((p) => ({
    value: p,
    label: p.split(/[\\/]/).filter(Boolean).pop() ?? p,
  }));
});
</script>

<template>
  <!-- split：完整任务表单 -->
  <template v-if="!compact">
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
          :options="Object.entries(TASK_STATUS_META).map(([k, v]) => ({ value: k, label: v.name }))"
          @change="(v: TaskStatus) => emit('patch', { status: v })"
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
          @change="(v: string) => emit('patch', { priority: (v || null) as Task['priority'] })"
        />
      </div>
      <div class="flex flex-col gap-1">
        <span class="text-11px text-muted-foreground">截止</span>
        <DatePicker
          :value="task.dueAt ? localDateOf(task.dueAt) : null"
          value-format="YYYY-MM-DD"
          format="YYYY-MM-DD"
          placeholder="选择日期"
          class="w-full"
          allow-clear
          @change="(v: string | null) => emit('patch', { dueAt: v ? dueAtFromPicker(v) : null })"
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
          @change="(v: string) => emit('patch', { projectPath: v || null })"
        />
        <Button size="small" class="h-full" @click="emit('pickDirectory')">浏览</Button>
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
  </template>

  <!-- 非 split 兼容：仅标题 + 备注 -->
  <template v-else>
    <Input
      v-model:value="localTitle"
      placeholder="任务标题"
      class="!text-20px !font-bold !border-0 !px-0 !py-1.5"
      @blur="saveTitle"
    />
    <TextArea v-model:value="localDescription" :rows="5" @blur="saveDescription" />
  </template>
</template>

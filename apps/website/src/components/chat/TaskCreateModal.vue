<script setup lang="ts">
/**
 * TaskCreateModal：看板「新建任务」弹窗（纯表单展示）。
 *
 * 标题 / 工作目录两段输入 + 目标列提示；所有字段受控（v-model:xxx），提交与关闭
 * 均只上抛事件。「浏览」按钮只上抛 browse，目录选择由容器动态加载 services/ai
 * 完成——弹窗自身不依赖任何服务，便于在 Storybook 中独立预览。
 */
import { FolderOpen } from "@lucide/vue";
import { Button, Input, Modal, Select } from "antdv-next";
import { TASK_STATUS_META, type TaskStatus } from "../../utils/taskStatus";

interface Props {
  /** 弹窗显隐（受控） */
  open: boolean;
  /** 任务标题（受控） */
  title: string;
  /** 新建到哪一列：仅用于目标列提示 */
  status: TaskStatus;
  /** 工作目录（受控） */
  projectPath: string;
  /** 工作目录下拉选项 */
  projectOptions: { value: string; label: string }[];
}

defineProps<Props>();

const emit = defineEmits<{
  (e: "update:open", value: boolean): void;
  (e: "update:title", value: string): void;
  (e: "update:projectPath", value: string): void;
  /** 点击创建 / 标题框回车：容器负责校验并落库 */
  (e: "submit"): void;
  /** 点击浏览：容器动态加载 services/ai 选择目录 */
  (e: "browse"): void;
}>();
</script>

<template>
  <Modal
    :open="open"
    title="新建任务"
    :ok-button-props="{ disabled: !title.trim() }"
    ok-text="创建"
    cancel-text="取消"
    destroy-on-close
    @update:open="emit('update:open', $event)"
    @ok="emit('submit')"
  >
    <div class="flex flex-col gap-4 py-2">
      <div class="flex flex-col gap-1.5">
        <span class="text-12px font-medium">任务标题</span>
        <Input
          :value="title"
          placeholder="输入任务标题"
          allow-clear
          autofocus
          @update:value="emit('update:title', $event)"
          @press-enter="emit('submit')"
        />
      </div>
      <div class="flex flex-col gap-1.5">
        <span class="text-12px font-medium">工作目录</span>
        <div class="flex gap-2">
          <Select
            :value="projectPath"
            :options="projectOptions"
            allowClear
            showSearch
            placeholder="未关联（可选）"
            class="flex-1"
            @update:value="emit('update:projectPath', $event)"
          />
          <Button @click="emit('browse')">
            <template #icon><FolderOpen class="h-3.5 w-3.5" /></template>浏览
          </Button>
        </div>
        <span class="text-11px text-muted-foreground"
          >将创建到：{{ TASK_STATUS_META[status].name }}</span
        >
      </div>
    </div>
  </Modal>
</template>

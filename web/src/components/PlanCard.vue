<script setup lang="ts">
import { TodoList } from "@antdv-next/x-pro";
import type { TodoItem, TodoItemStatus } from "@antdv-next/x-pro";
import { computed } from "vue";
import type { PlanEntry } from "../types";

const props = defineProps<{ entries: PlanEntry[] }>();

function mapStatus(s: string | undefined): TodoItemStatus {
  if (s === "completed") return "completed";
  if (s === "in_progress" || s === "in-progress") return "in-progress";
  if (s === "cancelled" || s === "canceled") return "cancelled";
  return "pending";
}

const todoItems = computed<TodoItem[]>(() =>
  props.entries.map((e, i) => ({
    id: `${i}-${e.content.slice(0, 24)}`,
    title: e.content,
    status: mapStatus(e.status),
    detail: e.priority && e.priority !== "medium" ? e.priority : undefined,
  })),
);
</script>

<template>
  <TodoList
    class="oc-todo-list"
    title="执行计划"
    :items="todoItems"
    :default-open="true"
    :collapse-on-complete="false"
    :max-height="260"
  />
</template>

<style scoped>
.oc-todo-list {
  margin: 2px 0 12px;
  border-radius: 12px;
  background: var(--surface-2);
  backdrop-filter: var(--glass-blur-sm);
  -webkit-backdrop-filter: var(--glass-blur-sm);
}
</style>

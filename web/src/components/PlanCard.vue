<script setup lang="ts">
import { CheckCircleFilled, LoadingOutlined, RightOutlined } from "@antdv-next/icons";
import { computed, ref } from "vue";
import type { PlanEntry } from "../types";

const props = defineProps<{ entries: PlanEntry[] }>();
const open = ref(true);

const done = computed(() => props.entries.filter((e) => e.status === "completed").length);
const running = computed(() => props.entries.some((e) => e.status === "in_progress"));
</script>

<template>
  <div class="plan" :class="{ done: done === entries.length }">
    <button class="head" @click="open = !open">
      <RightOutlined class="caret" :class="{ open }" />
      <span class="label">计划</span>
      <span class="progress">{{ done }}/{{ entries.length }}</span>
      <span v-if="done === entries.length" class="finished">已完成</span>
    </button>
    <Transition name="fold">
      <ol v-if="open" class="steps">
        <li v-for="(e, i) in entries" :key="i" :class="e.status">
          <span class="mark">
            <CheckCircleFilled v-if="e.status === 'completed'" />
            <LoadingOutlined v-else-if="e.status === 'in_progress'" spin />
            <span v-else class="todo-dot" />
          </span>
          <span class="text">{{ e.content }}</span>
        </li>
      </ol>
    </Transition>
  </div>
</template>

<style scoped>
.plan {
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface-2);
  margin: 2px 0 12px;
  overflow: hidden;
}
.head {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  border: none;
  background: transparent;
  padding: 8px 11px;
  cursor: pointer;
  font-size: 12.5px;
  color: var(--text-2);
}
.caret {
  font-size: 9px;
  transition: transform 0.18s var(--ease);
  color: var(--text-3);
}
.caret.open {
  transform: rotate(90deg);
}
.label {
  font-weight: 550;
  color: var(--text);
}
.progress {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--text-3);
  margin-left: auto;
}
.finished {
  font-size: 11px;
  color: var(--ok);
}
.steps {
  list-style: none;
  margin: 0;
  padding: 0 12px 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.steps li {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  font-size: 12.8px;
  line-height: 1.6;
  color: var(--text-2);
}
.steps li.completed .text {
  color: var(--text-3);
  text-decoration: line-through;
  text-decoration-color: var(--border-strong);
}
.steps li.in_progress .text {
  color: var(--text);
}
.mark {
  flex: none;
  margin-top: 3px;
  font-size: 11px;
  color: var(--text-3);
  display: inline-grid;
  place-items: center;
}
.todo-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  border: 1.5px solid var(--border-strong);
  margin: 2px 0;
}
.steps li.completed .mark {
  color: var(--ok);
}
.steps li.in_progress .mark {
  color: var(--accent);
}
.fold-enter-active,
.fold-leave-active {
  transition: opacity 0.16s var(--ease), transform 0.16s var(--ease);
}
.fold-enter-from,
.fold-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>

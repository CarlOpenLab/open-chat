<script setup lang="ts">
import { CheckCircleOutlined, CloseCircleOutlined, LoadingOutlined } from "@antdv-next/icons";
import { computed, ref } from "vue";
import type { PlanEntry } from "../types";

const props = defineProps<{ entries: PlanEntry[] }>();

type StepStatus = "completed" | "in_progress" | "cancelled" | "pending";

function normalizeStatus(s: string | undefined): StepStatus {
  if (s === "completed") return "completed";
  if (s === "in_progress" || s === "in-progress") return "in_progress";
  if (s === "cancelled" || s === "canceled") return "cancelled";
  return "pending";
}

const items = computed(() =>
  props.entries.map((e, i) => ({
    key: `${i}-${e.content.slice(0, 24)}`,
    content: e.content,
    status: normalizeStatus(e.status),
    priority: e.priority,
  })),
);

const doneCount = computed(() => items.value.filter((i) => i.status === "completed").length);
const totalCount = computed(() => items.value.length);
const progressPct = computed(() => (totalCount.value ? Math.round((doneCount.value / totalCount.value) * 100) : 0));
const allDone = computed(() => totalCount.value > 0 && doneCount.value === totalCount.value);

const open = ref(true);
</script>

<template>
  <div v-if="items.length" class="plan-card" :class="{ open, done: allDone }">
    <button type="button" class="plan-head" :aria-expanded="open" @click="open = !open">
      <span class="plan-ic" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round">
          <path d="m3 17 2 2 4-4" />
          <path d="m3 7 2 2 4-4" />
          <path d="M13 6h8" />
          <path d="M13 12h8" />
          <path d="M13 18h8" />
        </svg>
      </span>
      <span class="plan-title">执行计划</span>
      <span class="plan-spacer" />
      <span class="plan-bar" aria-hidden="true">
        <span class="plan-bar-fill" :style="{ width: `${progressPct}%` }" />
      </span>
      <span class="plan-count mono">{{ doneCount }}/{{ totalCount }}</span>
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        class="plan-chev"
      >
        <polyline points="9 18 15 12 9 6" />
      </svg>
    </button>

    <div class="plan-collapse" :class="{ open }">
      <div class="plan-collapse-inner">
        <ul class="plan-list">
          <li v-for="item in items" :key="item.key" class="plan-row" :class="item.status">
            <span class="step-ic" :class="item.status">
              <CheckCircleOutlined v-if="item.status === 'completed'" />
              <LoadingOutlined v-else-if="item.status === 'in_progress'" spin />
              <CloseCircleOutlined v-else-if="item.status === 'cancelled'" />
              <span v-else class="step-dot" />
            </span>
            <span class="step-text">{{ item.content }}</span>
            <span v-if="item.priority === 'high' && item.status !== 'completed'" class="step-prio">高</span>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>

<style scoped>
.plan-card {
  margin: 4px 0 12px;
  border-radius: 11px;
  border: 1px solid var(--border);
  background: var(--surface-2);
  backdrop-filter: var(--glass-blur-sm);
  -webkit-backdrop-filter: var(--glass-blur-sm);
  overflow: hidden;
  transition: border-color 0.16s var(--ease);
}
.plan-card:hover {
  border-color: var(--border-strong);
}

.plan-head {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 9px 12px;
  border: none;
  background: transparent;
  color: var(--text);
  font-size: 12.5px;
  text-align: left;
  cursor: pointer;
  user-select: none;
}

.plan-ic {
  width: 15px;
  height: 15px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--text-2);
  flex: none;
}
.plan-card.done .plan-ic {
  color: var(--ok);
}
.plan-ic svg {
  width: 14px;
  height: 14px;
}

.plan-title {
  font-weight: 560;
  color: var(--text);
  letter-spacing: -0.01em;
}

.plan-spacer {
  flex: 1;
}

.plan-bar {
  width: 44px;
  height: 4px;
  border-radius: 999px;
  background: var(--border-strong);
  overflow: hidden;
  flex: none;
}
.plan-bar-fill {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: var(--ok);
  transition: width 0.28s var(--ease);
}

.plan-count {
  font-size: 11px;
  color: var(--text-3);
  min-width: 24px;
  text-align: right;
  flex: none;
}

.plan-chev {
  width: 13px;
  height: 13px;
  color: var(--text-3);
  flex: none;
  transition: transform 0.2s var(--ease), color 0.14s;
}
.plan-card.open .plan-chev {
  transform: rotate(90deg);
}
.plan-head:hover .plan-chev {
  color: var(--text-2);
}

.plan-collapse {
  display: grid;
  grid-template-rows: 0fr;
  opacity: 0;
  transition: grid-template-rows 0.22s var(--ease), opacity 0.18s ease;
}
.plan-collapse.open {
  grid-template-rows: 1fr;
  opacity: 1;
}
.plan-collapse-inner {
  overflow: hidden;
  min-height: 0;
}

.plan-list {
  list-style: none;
  margin: 0;
  padding: 6px 12px 10px;
  border-top: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 5px;
  max-height: 240px;
  overflow-y: auto;
}

.plan-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 24px;
  padding: 2px 4px;
  border-radius: 6px;
  font-size: 12.5px;
  line-height: 1.45;
  color: var(--text-2);
}
.plan-row.in_progress {
  color: var(--text);
  font-weight: 500;
  background: var(--hover);
}
.plan-row.completed .step-text {
  color: var(--text-3);
  text-decoration: line-through;
  text-decoration-color: color-mix(in srgb, var(--text-3) 55%, transparent);
}
.plan-row.cancelled .step-text {
  color: var(--text-3);
  text-decoration: line-through;
}

.step-ic {
  width: 15px;
  height: 15px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  flex: none;
}
.step-ic.completed {
  color: var(--ok);
}
.step-ic.in_progress {
  color: var(--text);
}
.step-ic.cancelled {
  color: var(--err);
}

.step-dot {
  width: 11px;
  height: 11px;
  border-radius: 50%;
  border: 1.5px solid var(--border-strong);
  box-sizing: border-box;
}

.step-text {
  flex: 1;
  min-width: 0;
  word-break: break-word;
}

.step-prio {
  flex: none;
  font-size: 10px;
  line-height: 16px;
  padding: 0 5px;
  border-radius: 4px;
  color: var(--warn);
  background: var(--warn-soft);
  font-weight: 540;
}
</style>

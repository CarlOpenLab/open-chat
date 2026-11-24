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
  <div
    v-if="items.length"
    class="mt-1 mb-3 rounded-[11px] border border-solid border-line bg-surface-2 glass-sm overflow-hidden transition-colors duration-160 ease-oc hover:border-line-strong"
  >
    <button
      type="button"
      class="group flex items-center gap-2 w-full px-3 py-[9px] border-0 bg-transparent text-ink text-[12.5px] text-left cursor-pointer select-none"
      :aria-expanded="open"
      @click="open = !open"
    >
      <span
        class="w-[15px] h-[15px] inline-flex items-center justify-center flex-none"
        :class="allDone ? 'text-ok' : 'text-ink-2'"
        aria-hidden="true"
      >
        <svg viewBox="0 0 24 24" class="w-[14px] h-[14px]" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round">
          <path d="m3 17 2 2 4-4" />
          <path d="m3 7 2 2 4-4" />
          <path d="M13 6h8" />
          <path d="M13 12h8" />
          <path d="M13 18h8" />
        </svg>
      </span>
      <span class="fw-560 text-ink tracking-[-0.01em]">执行计划</span>
      <span class="flex-1" />
      <span class="w-[44px] h-1 rounded-full bg-line-strong overflow-hidden flex-none" aria-hidden="true">
        <span class="block h-full rounded-full bg-ok transition-[width] duration-280 ease-oc" :style="{ width: `${progressPct}%` }" />
      </span>
      <span class="text-[11px] text-ink-3 min-w-6 text-right flex-none font-mono">{{ doneCount }}/{{ totalCount }}</span>
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        class="w-[13px] h-[13px] text-ink-3 flex-none transition-[transform,color] duration-200 ease-oc group-hover:text-ink-2"
        :class="{ 'rotate-90': open }"
      >
        <polyline points="9 18 15 12 9 6" />
      </svg>
    </button>

    <div
      class="grid transition-[grid-template-rows,opacity] duration-220 ease-oc"
      :class="open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'"
    >
      <div class="overflow-hidden min-h-0">
        <ul class="list-none m-0 px-3 pt-[6px] pb-[10px] border-0 border-t border-solid border-line flex flex-col gap-[5px] max-h-[240px] overflow-y-auto">
          <li
            v-for="item in items"
            :key="item.key"
            class="flex items-center gap-2 min-h-6 px-1 py-[2px] rounded-[6px] text-[12.5px] leading-[1.45]"
            :class="item.status === 'in_progress' ? 'text-ink font-medium bg-hover' : 'text-ink-2'"
          >
            <span
              class="w-[15px] h-[15px] inline-flex items-center justify-center text-[13px] flex-none"
              :class="
                item.status === 'completed'
                  ? 'text-ok'
                  : item.status === 'in_progress'
                    ? 'text-ink'
                    : item.status === 'cancelled'
                      ? 'text-err'
                      : ''
              "
            >
              <CheckCircleOutlined v-if="item.status === 'completed'" />
              <LoadingOutlined v-else-if="item.status === 'in_progress'" spin />
              <CloseCircleOutlined v-else-if="item.status === 'cancelled'" />
              <span v-else class="w-[11px] h-[11px] rounded-full border-[1.5px] border-solid border-line-strong box-border" />
            </span>
            <span
              class="flex-1 min-w-0 break-words"
              :class="{ 'text-ink-3 line-through': item.status === 'completed' || item.status === 'cancelled' }"
            >
              {{ item.content }}
            </span>
            <span
              v-if="item.priority === 'high' && item.status !== 'completed'"
              class="flex-none text-[10px] leading-4 px-[5px] py-0 rounded-[4px] text-warn bg-warn-soft fw-540"
            >
              高
            </span>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ClockCircleOutlined } from "@antdv-next/icons";
import { Input, Select } from "antdv-next";
import { computed, ref, watch } from "vue";
import { describeSchedule, formatNextRun, normalizeToCron, parseCron, validateSchedule } from "../botSchedule";

const props = defineProps<{
  value: string;
}>();

const emit = defineEmits<{
  "update:value": [string];
}>();

type PickerTab = "daily" | "weekly" | "interval" | "cron";

const tab = ref<PickerTab>("daily");
const hour = ref(9);
const minute = ref(0);
const weekdays = ref<number[]>([1, 2, 3, 4, 5]);
const intervalUnit = ref<"minute" | "hour">("hour");
const intervalValue = ref(2);
const rawCron = ref("0 9 * * *");

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => ({
  value: i,
  label: String(i).padStart(2, "0") + " 时",
}));

const MINUTE_OPTIONS = Array.from({ length: 60 }, (_, i) => ({
  value: i,
  label: String(i).padStart(2, "0") + " 分",
}));

const INTERVAL_MINUTE_OPTIONS = [5, 10, 15, 20, 30, 45].map((n) => ({ value: n, label: `每 ${n} 分钟` }));
const INTERVAL_HOUR_OPTIONS = [1, 2, 3, 4, 6, 8, 12].map((n) => ({ value: n, label: `每 ${n} 小时` }));

const WEEKDAY_ITEMS = [
  { value: 1, label: "一" },
  { value: 2, label: "二" },
  { value: 3, label: "三" },
  { value: 4, label: "四" },
  { value: 5, label: "五" },
  { value: 6, label: "六" },
  { value: 0, label: "日" },
];

const CRON_PRESETS = [
  { label: "每天 09:00", value: "0 9 * * *" },
  { label: "工作日 09:30", value: "30 9 * * 1-5" },
  { label: "每 30 分钟", value: "*/30 * * * *" },
  { label: "每 2 小时", value: "0 */2 * * *" },
  { label: "每周一 10:00", value: "0 10 * * 1" },
];

let internalUpdate = false;

function syncFromProp(spec: string) {
  const norm = normalizeToCron(spec) || "0 9 * * *";
  rawCron.value = norm;
  const parts = norm.split(/\s+/);
  if (parts.length !== 5) {
    tab.value = "cron";
    return;
  }
  const [fMin, fHour, fDom, fMonth, fDow] = parts;
  const everyMin = /^\*\/(\d+)$/.exec(fMin);
  if (everyMin && fHour === "*" && fDom === "*" && fMonth === "*" && fDow === "*") {
    tab.value = "interval";
    intervalUnit.value = "minute";
    intervalValue.value = Number(everyMin[1]);
    return;
  }
  const everyHour = /^\*\/(\d+)$/.exec(fHour);
  if (everyHour && fMin === "0" && fDom === "*" && fMonth === "*" && fDow === "*") {
    tab.value = "interval";
    intervalUnit.value = "hour";
    intervalValue.value = Number(everyHour[1]);
    return;
  }
  if (/^\d+$/.test(fMin) && /^\d+$/.test(fHour) && fDom === "*" && fMonth === "*") {
    minute.value = Number(fMin);
    hour.value = Number(fHour);
    if (fDow === "*") {
      tab.value = "daily";
      return;
    }
    const parsed = parseCron(norm);
    if (parsed && parsed.dow.size > 0) {
      weekdays.value = [...parsed.dow].sort((a, b) => a - b);
      tab.value = "weekly";
      return;
    }
  }
  tab.value = "cron";
}

watch(
  () => props.value,
  (val) => {
    if (internalUpdate) {
      internalUpdate = false;
      return;
    }
    syncFromProp(val);
  },
  { immediate: true },
);

function emitCron(expr: string) {
  rawCron.value = expr;
  internalUpdate = true;
  emit("update:value", expr);
}

function buildFromTab(active: PickerTab): string {
  if (active === "daily") {
    return `${minute.value} ${hour.value} * * *`;
  }
  if (active === "weekly") {
    const days = weekdays.value.length ? [...new Set(weekdays.value)].sort((a, b) => a - b) : [1];
    const dowExpr = days.join(",") === "1,2,3,4,5" ? "1-5" : days.join(",");
    return `${minute.value} ${hour.value} * * ${dowExpr}`;
  }
  if (active === "interval") {
    if (intervalUnit.value === "minute") {
      return `*/${intervalValue.value} * * * *`;
    }
    return `0 */${intervalValue.value} * * *`;
  }
  return rawCron.value.trim();
}

function switchTab(next: PickerTab) {
  tab.value = next;
  if (next !== "cron") {
    emitCron(buildFromTab(next));
  }
}

function onTimeChange(nextHour: number, nextMinute: number) {
  hour.value = nextHour;
  minute.value = nextMinute;
  emitCron(buildFromTab(tab.value));
}

function toggleWeekday(day: number) {
  const exists = weekdays.value.includes(day);
  if (exists && weekdays.value.length === 1) return; // keep at least 1 weekday selected
  weekdays.value = exists ? weekdays.value.filter((d) => d !== day) : [...weekdays.value, day];
  emitCron(buildFromTab("weekly"));
}

function setWeekdays(days: number[]) {
  weekdays.value = [...days];
  emitCron(buildFromTab("weekly"));
}

function setIntervalUnit(unit: "minute" | "hour") {
  intervalUnit.value = unit;
  intervalValue.value = unit === "minute" ? 30 : 2;
  emitCron(buildFromTab("interval"));
}

function setIntervalValue(val: number) {
  intervalValue.value = val;
  emitCron(buildFromTab("interval"));
}

function onRawCronInput(val: string) {
  rawCron.value = val;
  internalUpdate = true;
  emit("update:value", val.trim());
}

const validation = computed(() => validateSchedule(props.value || rawCron.value));
const summaryText = computed(() => describeSchedule(props.value || rawCron.value));
const nextRunText = computed(() => (validation.value.valid ? formatNextRun(props.value || rawCron.value) : ""));
</script>

<template>
  <div class="rounded-[10px] border border-solid border-line bg-hover p-3 flex flex-col gap-3">
    <!-- Mode Switcher -->
    <div class="flex items-center justify-between gap-2">
      <div class="inline-flex items-center gap-[2px] p-[2px] rounded-[8px] bg-modal border border-solid border-line-strong">
        <button
          v-for="item in [
            { key: 'daily', label: '每天' },
            { key: 'weekly', label: '每周' },
            { key: 'interval', label: '按间隔' },
            { key: 'cron', label: 'Cron' },
          ]"
          :key="item.key"
          type="button"
          class="h-[24px] px-2.5 border-0 rounded-[6px] text-[11.5px] cursor-pointer transition-colors"
          :class="
            tab === item.key
              ? 'bg-ink-solid text-ink-inv fw-560'
              : 'bg-transparent text-ink-2 hover:text-ink'
          "
          @click="switchTab(item.key as PickerTab)"
        >
          {{ item.label }}
        </button>
      </div>

      <span class="text-[11px] font-mono text-ink-3 px-2 py-0.5 rounded-[6px] bg-modal border border-solid border-line">
        {{ rawCron || "—" }}
      </span>
    </div>

    <!-- Daily Picker -->
    <div v-if="tab === 'daily'" class="flex items-center gap-2">
      <span class="text-[12px] text-ink-2 flex-none">触发时间</span>
      <Select
        :value="hour"
        size="small"
        class="w-[92px]"
        :options="HOUR_OPTIONS"
        @change="(v: unknown) => onTimeChange(Number(v), minute)"
      />
      <span class="text-ink-3 font-mono">:</span>
      <Select
        :value="minute"
        size="small"
        class="w-[92px]"
        :options="MINUTE_OPTIONS"
        @change="(v: unknown) => onTimeChange(hour, Number(v))"
      />
    </div>

    <!-- Weekly Picker -->
    <div v-else-if="tab === 'weekly'" class="flex flex-col gap-2.5">
      <div class="flex items-center justify-between gap-2 flex-wrap">
        <div class="flex items-center gap-1">
          <button
            v-for="d in WEEKDAY_ITEMS"
            :key="d.value"
            type="button"
            class="w-7 h-7 rounded-[7px] border border-solid text-[12px] cursor-pointer transition-colors"
            :class="
              weekdays.includes(d.value)
                ? 'border-ink-solid bg-ink-solid text-ink-inv fw-560'
                : 'border-line bg-modal text-ink-2 hover:border-line-strong hover:text-ink'
            "
            @click="toggleWeekday(d.value)"
          >
            {{ d.label }}
          </button>
        </div>
        <div class="flex items-center gap-1.5 text-[11px]">
          <button
            type="button"
            class="border-0 bg-transparent p-0 text-ink-2 cursor-pointer hover:text-ink hover:underline underline-offset-2"
            @click="setWeekdays([1, 2, 3, 4, 5])"
          >
            工作日
          </button>
          <span class="text-ink-3">·</span>
          <button
            type="button"
            class="border-0 bg-transparent p-0 text-ink-2 cursor-pointer hover:text-ink hover:underline underline-offset-2"
            @click="setWeekdays([0, 6])"
          >
            周末
          </button>
        </div>
      </div>

      <div class="flex items-center gap-2">
        <span class="text-[12px] text-ink-2 flex-none">触发时间</span>
        <Select
          :value="hour"
          size="small"
          class="w-[92px]"
          :options="HOUR_OPTIONS"
          @change="(v: unknown) => onTimeChange(Number(v), minute)"
        />
        <span class="text-ink-3 font-mono">:</span>
        <Select
          :value="minute"
          size="small"
          class="w-[92px]"
          :options="MINUTE_OPTIONS"
          @change="(v: unknown) => onTimeChange(hour, Number(v))"
        />
      </div>
    </div>

    <!-- Interval Picker -->
    <div v-else-if="tab === 'interval'" class="flex items-center gap-2 flex-wrap">
      <span class="text-[12px] text-ink-2 flex-none">执行频率</span>
      <div class="inline-flex items-center gap-[2px] p-[2px] rounded-[7px] bg-modal border border-solid border-line-strong">
        <button
          type="button"
          class="h-[22px] px-2 border-0 rounded-[5px] text-[11.5px] cursor-pointer transition-colors"
          :class="intervalUnit === 'minute' ? 'bg-ink-solid text-ink-inv fw-560' : 'bg-transparent text-ink-2 hover:text-ink'"
          @click="setIntervalUnit('minute')"
        >
          按分钟
        </button>
        <button
          type="button"
          class="h-[22px] px-2 border-0 rounded-[5px] text-[11.5px] cursor-pointer transition-colors"
          :class="intervalUnit === 'hour' ? 'bg-ink-solid text-ink-inv fw-560' : 'bg-transparent text-ink-2 hover:text-ink'"
          @click="setIntervalUnit('hour')"
        >
          按小时
        </button>
      </div>
      <Select
        :value="intervalValue"
        size="small"
        class="w-[116px]"
        :options="intervalUnit === 'minute' ? INTERVAL_MINUTE_OPTIONS : INTERVAL_HOUR_OPTIONS"
        @change="(v: unknown) => setIntervalValue(Number(v))"
      />
    </div>

    <!-- Raw 5-field Unix Cron Mode -->
    <div v-else class="flex flex-col gap-2">
      <Input
        :value="rawCron"
        size="small"
        class="font-mono"
        :status="validation.valid ? undefined : 'error'"
        placeholder="分 时 日 月 周（例如：30 9 * * 1-5）"
        @update:value="onRawCronInput"
      />
      <div class="flex items-center gap-1.5 flex-wrap">
        <button
          v-for="p in CRON_PRESETS"
          :key="p.value"
          type="button"
          class="h-[21px] px-2 rounded-full border border-solid text-[11px] cursor-pointer transition-colors"
          :class="
            rawCron.trim() === p.value
              ? 'border-ink-solid bg-active text-ink fw-550'
              : 'border-line bg-modal text-ink-2 hover:border-line-strong hover:text-ink'
          "
          @click="emitCron(p.value)"
        >
          {{ p.label }}
        </button>
      </div>
    </div>

    <!-- Human-readable preview + Next Run -->
    <div
      class="pt-2 border-0 border-t border-solid border-line flex items-center justify-between gap-2 text-[11.5px]"
      :class="validation.valid ? 'text-ink-2' : 'text-err'"
    >
      <template v-if="validation.valid">
        <span class="inline-flex items-center gap-1.5 truncate">
          <ClockCircleOutlined class="text-ink-3 flex-none" />
          <span class="fw-530">{{ summaryText }}</span>
        </span>
        <span v-if="nextRunText" class="text-ink-3 flex-none">下次：{{ nextRunText }}</span>
      </template>
      <span v-else>{{ validation.error }}</span>
    </div>
  </div>
</template>

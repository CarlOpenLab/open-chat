<script setup lang="ts">
import { computed, ref, watch } from "vue";

const props = defineProps<{ text: string; live: boolean; durationSec?: number }>();

const title = computed(() => {
  if (props.live) return "思考中…";
  if (props.durationSec != null && props.durationSec >= 1) return `已思考 ${Math.round(props.durationSec)} 秒`;
  return "思考过程";
});

interface TextRun {
  text: string;
  bold: boolean;
}

/** Normalize raw thought_delta text: trim leading blank space and split concatenated **heading****heading** chunks. */
const lines = computed<TextRun[][]>(() => {
  const raw = (props.text ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\*\*\s*\*\*/g, "**\n**")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!raw) return [];

  return raw.split("\n").map((line) => {
    const runs: TextRun[] = [];
    const regex = /\*\*([^*]+)\*\*/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(line)) !== null) {
      if (match.index > lastIndex) {
        runs.push({ text: line.slice(lastIndex, match.index), bold: false });
      }
      runs.push({ text: match[1], bold: true });
      lastIndex = regex.lastIndex;
    }
    if (lastIndex < line.length) {
      runs.push({ text: line.slice(lastIndex), bold: false });
    }
    return runs;
  });
});

const open = ref(props.live);

watch(
  () => props.live,
  (live) => {
    open.value = live;
  },
);
</script>

<template>
  <div v-if="lines.length || live" class="think" :class="{ open, live }">
    <button type="button" class="think-head" @click="open = !open" :aria-expanded="open">
      <!-- Lucide Sparkles -->
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.85"
        stroke-linecap="round"
        stroke-linejoin="round"
        class="think-ic"
        :class="{ live }"
      >
        <path
          d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"
        />
        <path d="M20 3v4" />
        <path d="M22 5h-4" />
        <path d="M4 17v2" />
        <path d="M5 18H3" />
      </svg>
      <span class="think-title" :class="{ 'shimmer-text': live }">{{ title }}</span>
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        class="think-chev"
      >
        <polyline points="9 18 15 12 9 6" />
      </svg>
    </button>

    <div class="think-collapse" :class="{ open }">
      <div class="think-collapse-inner">
        <div class="think-body selectable">
          <p v-for="(line, i) in lines" :key="i" class="think-line" :class="{ empty: line.length === 0 }">
            <template v-for="(run, j) in line" :key="j">
              <strong v-if="run.bold" class="think-strong">{{ run.text }}</strong>
              <span v-else>{{ run.text }}</span>
            </template>
          </p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.think {
  margin: 0 0 10px;
}

.think-head {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 8px 3px 4px;
  margin-left: -4px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--text-2);
  font-size: 12.5px;
  line-height: 18px;
  cursor: pointer;
  transition: background 0.14s var(--ease), color 0.14s var(--ease);
}
.think-head:hover {
  background: var(--hover);
  color: var(--text);
}

.think-ic {
  width: 14px;
  height: 14px;
  color: #a78bfa;
  flex: none;
}
.think-ic.live {
  animation: oc-pulse 1.4s ease-in-out infinite;
}

.think-title {
  font-weight: 500;
}

.think-chev {
  width: 12px;
  height: 12px;
  color: var(--text-3);
  transition: transform 0.22s var(--ease), color 0.14s;
  flex: none;
}
.think.open .think-chev {
  transform: rotate(90deg);
  color: var(--text-2);
}

/* Smooth CSS Grid collapse transition */
.think-collapse {
  display: grid;
  grid-template-rows: 0fr;
  opacity: 0;
  transition: grid-template-rows 0.24s var(--ease), opacity 0.2s ease;
}
.think-collapse.open {
  grid-template-rows: 1fr;
  opacity: 1;
}
.think-collapse-inner {
  overflow: hidden;
  min-height: 0;
}

.think-body {
  margin: 4px 0 2px 6px;
  padding: 2px 0 2px 12px;
  border-left: 1.5px solid var(--border-strong);
  max-height: 260px;
  overflow-y: auto;
  font-size: 12.5px;
  line-height: 1.65;
  color: var(--text-2);
  word-break: break-word;
}

.think-line {
  margin: 0 0 4px;
}
.think-line:last-child {
  margin-bottom: 0;
}
.think-line.empty {
  height: 6px;
  margin: 0;
}
.think-strong {
  font-weight: 560;
  color: var(--text);
}
</style>

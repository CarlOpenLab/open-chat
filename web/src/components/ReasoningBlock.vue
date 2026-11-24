<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import TextBlock from "./TextBlock.vue";

const props = defineProps<{ text: string; live: boolean; durationSec?: number }>();

const title = computed(() => {
  if (props.live) return "思考中…";
  if (props.durationSec != null && props.durationSec >= 1) return `已思考 ${Math.round(props.durationSec)} 秒`;
  return "思考过程";
});

// Collapsed by default; expansion is user-controlled only (no auto open/close while streaming).
const open = ref(false);
const everOpened = ref(false);
let pendingOpen = false;

function toggleOpen() {
  if (open.value || pendingOpen) {
    pendingOpen = false;
    open.value = false;
    return;
  }
  if (!everOpened.value) {
    everOpened.value = true;
    pendingOpen = true;
    // Mount in 0fr state first, then open on the next paint frame so CSS transition runs.
    void nextTick(() => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (!pendingOpen) return;
          pendingOpen = false;
          open.value = true;
        });
      });
    });
    return;
  }
  open.value = true;
}

const hasContent = computed(() => Boolean(props.text && props.text.trim().length > 0));

/** Normalize raw thought_delta text lazily only after the user opens the block. */
const normalizedText = computed(() => {
  if (!everOpened.value) return "";
  return (props.text ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\*\*\s*\*\*/g, "**\n**")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
});
</script>

<template>
  <div v-if="hasContent || live" class="mb-[10px]">
    <button
      type="button"
      class="inline-flex items-center gap-[6px] py-[3px] pr-2 pl-1 -ml-1 border-0 rounded-[7px] bg-transparent text-ink-2 text-[12.5px] leading-[18px] cursor-pointer transition-colors duration-140 ease-oc hover:bg-hover hover:text-ink"
      @click="toggleOpen"
      :aria-expanded="open"
    >
      <!-- Lucide Sparkles -->
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.85"
        stroke-linecap="round"
        stroke-linejoin="round"
        class="w-[14px] h-[14px] text-[#a78bfa] flex-none"
        :class="{ 'animate-oc-pulse-fast': live }"
      >
        <path
          d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"
        />
        <path d="M20 3v4" />
        <path d="M22 5h-4" />
        <path d="M4 17v2" />
        <path d="M5 18H3" />
      </svg>
      <span class="font-medium" :class="{ 'shimmer-text': live }">{{ title }}</span>
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        class="w-3 h-3 flex-none transition-[transform,color] duration-220 ease-oc"
        :class="open ? 'rotate-90 text-ink-2' : 'text-ink-3'"
      >
        <polyline points="9 18 15 12 9 6" />
      </svg>
    </button>

    <div v-if="everOpened" class="collapse-grid" :class="{ 'collapse-grid-open': open }">
      <div class="overflow-hidden min-h-0">
        <div class="mt-1 mb-[2px] ml-[6px] py-[2px] pl-3 border-0 border-l-[1.5px] border-solid border-line-strong max-h-[260px] overflow-y-auto break-words selectable">
          <TextBlock
            v-if="normalizedText"
            :content="normalizedText"
            :streaming="live"
            class-name="oc-md-reasoning"
          />
        </div>
      </div>
    </div>
  </div>
</template>

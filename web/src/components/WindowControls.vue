<script setup lang="ts">
import { currentWindow } from "mygo-runtime";
import { computed } from "vue";
import { inApp } from "../api";
import { isMac } from "../store";

/** Minimize / maximize / close, drawn for Windows and Linux (macOS keeps its traffic lights). */
const show = computed(() => inApp && !isMac.value);
</script>

<template>
  <div v-if="show" class="flex items-center ml-1 no-drag">
    <button
      class="w-[30px] h-[26px] border-0 bg-transparent rounded-[6px] grid place-items-center cursor-pointer text-ink-2 transition-colors duration-130 hover:bg-hover hover:text-ink"
      title="最小化"
      @click="currentWindow.minimize()"
    >
      <svg viewBox="0 0 10 10" class="w-[10px] h-[10px] fill-none stroke-current" stroke-width="1.1" stroke-linecap="round">
        <path d="M2 5h6" />
      </svg>
    </button>
    <button
      class="w-[30px] h-[26px] border-0 bg-transparent rounded-[6px] grid place-items-center cursor-pointer text-ink-2 transition-colors duration-130 hover:bg-hover hover:text-ink"
      title="最大化"
      @click="currentWindow.toggleMaximize()"
    >
      <svg viewBox="0 0 10 10" class="w-[10px] h-[10px] fill-none stroke-current" stroke-width="1.1" stroke-linecap="round">
        <rect x="2.2" y="2.2" width="5.6" height="5.6" rx="0.6" />
      </svg>
    </button>
    <button
      class="w-[30px] h-[26px] border-0 bg-transparent rounded-[6px] grid place-items-center cursor-pointer text-ink-2 transition-colors duration-130 hover:bg-[#e5484d] hover:text-white"
      title="关闭"
      @click="currentWindow.close()"
    >
      <svg viewBox="0 0 10 10" class="w-[10px] h-[10px] fill-none stroke-current" stroke-width="1.1" stroke-linecap="round">
        <path d="M2.4 2.4l5.2 5.2M7.6 2.4l-5.2 5.2" />
      </svg>
    </button>
  </div>
</template>
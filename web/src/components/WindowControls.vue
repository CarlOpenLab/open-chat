<script setup lang="ts">
import { currentWindow } from "mygo-runtime";
import { computed } from "vue";
import { inApp } from "../api";
import { isMac } from "../store";

/** Minimize / maximize / close, drawn for Windows and Linux (macOS keeps its traffic lights). */
const show = computed(() => inApp && !isMac.value);
</script>

<template>
  <div v-if="show" class="wc no-drag">
    <button class="btn" title="最小化" @click="currentWindow.minimize()">
      <svg viewBox="0 0 10 10"><path d="M2 5h6" /></svg>
    </button>
    <button class="btn" title="最大化" @click="currentWindow.toggleMaximize()">
      <svg viewBox="0 0 10 10"><rect x="2.2" y="2.2" width="5.6" height="5.6" rx="0.6" /></svg>
    </button>
    <button class="btn close" title="关闭" @click="currentWindow.close()">
      <svg viewBox="0 0 10 10"><path d="M2.4 2.4l5.2 5.2M7.6 2.4l-5.2 5.2" /></svg>
    </button>
  </div>
</template>

<style scoped>
.wc {
  display: flex;
  align-items: center;
  margin-left: 4px;
}
.btn {
  width: 30px;
  height: 26px;
  border: none;
  background: transparent;
  border-radius: 6px;
  display: grid;
  place-items: center;
  cursor: pointer;
  color: var(--text-2);
  transition: background 0.13s, color 0.13s;
}
.btn svg {
  width: 10px;
  height: 10px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.1;
  stroke-linecap: round;
}
.btn:hover {
  background: var(--hover);
  color: var(--text);
}
.btn.close:hover {
  background: #e5484d;
  color: #fff;
}
</style>
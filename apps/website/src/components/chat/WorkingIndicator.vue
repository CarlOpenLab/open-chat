<script setup lang="ts">
import { computed, toRef } from "vue";
import { useNow } from "../../composables/useNow";
import { formatWorkingElapsed } from "../../utils/chatDuration";

interface Props {
  /** 会话运行中（与侧栏 busy 状态同源）。 */
  working: boolean;
  /** 当前会话服务端运行起点，刷新恢复时与侧栏计时保持一致。 */
  workingStartedAtMs?: number;
}

const props = withDefaults(defineProps<Props>(), { workingStartedAtMs: undefined });

/** 计时时钟：运行中每秒跳动，空闲时降级为低频心跳（useNow 自带卸载清理）。 */
const workingNow = useNow(toRef(props, "working"));

/** 列尾"工作中 · Xs"的已运行时长；无服务端起点时不显示时长。 */
const workingElapsed = computed(() =>
  props.workingStartedAtMs
    ? formatWorkingElapsed(Math.max(0, workingNow.value - props.workingStartedAtMs))
    : "",
);
</script>

<template>
  <div v-if="working" class="flex w-full justify-start" role="status" aria-live="polite">
    <div
      class="inline-flex min-h-[22px] items-center gap-2 text-[11.5px] leading-4 font-medium text-brand-muted-strong animate-[working-status-in_220ms_ease-out_both]"
    >
      <span class="inline-flex items-center gap-[3.5px]" aria-hidden="true">
        <i class="working-dot" />
        <i class="working-dot" />
        <i class="working-dot" />
      </span>
      <span>工作中{{ workingElapsed ? ` · ${workingElapsed}` : "" }}</span>
    </div>
  </div>
</template>

<style scoped>
/* 从左到右依次放大脉冲：升到峰顶后完整回到原状并保持到周期结束，
   靠 0.28s 的相位差形成清晰的顺序感。 */
.working-dot {
  height: 4.5px;
  width: 4.5px;
  border-radius: 9999px;
  background: currentcolor;
  animation: working-pulse 1.4s ease-in-out infinite;
}

/* 相位差必须写在这里：.working-dot 的 animation 简写会重置 delay，
   若在 Tailwind 任意属性里写 animation-delay 会被简写覆盖回 0。 */
.working-dot:nth-child(2) {
  animation-delay: 0.28s;
}
.working-dot:nth-child(3) {
  animation-delay: 0.56s;
}

@keyframes working-pulse {
  0%,
  70%,
  100% {
    transform: scale(1);
    box-shadow: none;
  }
  35% {
    transform: scale(1.8);
    box-shadow: 0 0 5px 0 currentcolor;
  }
}

@keyframes working-status-in {
  from {
    opacity: 0;
    transform: translateY(3px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>

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
        <i
          class="h-[4.5px] w-[4.5px] rounded-full bg-current animate-[working-wave_1.4s_linear_infinite]"
        />
        <i
          class="h-[4.5px] w-[4.5px] rounded-full bg-current animate-[working-wave_1.4s_linear_infinite] [animation-delay:0.12s]"
        />
        <i
          class="h-[4.5px] w-[4.5px] rounded-full bg-current animate-[working-wave_1.4s_linear_infinite] [animation-delay:0.24s]"
        />
      </span>
      <span>工作中{{ workingElapsed ? ` · ${workingElapsed}` : "" }}</span>
    </div>
  </div>
</template>

<style scoped>
@keyframes working-wave {
  0%,
  100% {
    opacity: 0.25;
  }
  50% {
    opacity: 1;
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

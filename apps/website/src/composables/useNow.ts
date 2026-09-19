import { onBeforeUnmount, ref, watch, type Ref } from "vue";

/**
 * 共享 now 时钟：source 为真时按 activeIntervalMs 刷新（秒级耗时跳动），
 * 否则降级到 idleIntervalMs 低频心跳；组件卸载自动清理定时器。
 */
export function useNow(source: Ref<boolean>, activeIntervalMs = 1000, idleIntervalMs = 30000) {
  const now = ref(Date.now());
  let timer: ReturnType<typeof setInterval> | undefined;
  const stop = () => {
    if (timer) clearInterval(timer);
    timer = undefined;
  };
  const start = (periodMs: number) => {
    stop();
    timer = setInterval(() => {
      now.value = Date.now();
    }, periodMs);
  };
  watch(source, (active) => start(active ? activeIntervalMs : idleIntervalMs), {
    immediate: true,
  });
  onBeforeUnmount(stop);
  return now;
}

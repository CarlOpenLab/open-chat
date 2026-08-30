import { onBeforeUnmount } from "vue";

/**
 * keyed 合并更新器：把高频更新按 key 合并到固定间隔的批次里。
 *
 * 用途：流式请求的 onUpdate 每个 chunk 都会产生一份完整的新会话消息数组，
 * 真实模型 10~30 chunk/s 尚可，快速流（如 mock 8ms/chunk）一秒钟上百次
 * 全量更新会让 GC 追不上、堆内存堆积。用本更新器把「对外可见的更新」
 * 合并到 INTERVAL_MS 一拍：总是保留最新值，同 key 的中间值被丢弃，
 * 结束/出错时 flush 掉最后一批。
 */
export function useCoalescedUpdater<T>(
  /** 真正对外应用一个批次（key + 最新值）。 */
  apply: (key: string, value: T) => void,
  /** 批次间隔；0 表示不合并（立即应用）。 */
  intervalMs = 100,
): {
  /** 提交一个新值；同 key 旧值会被后续新值覆盖，直到批次到期。 */
  schedule: (key: string, value: T) => void;
  /** 立即应用该 key 尚未落地的批次（流结束/出错时调用，保证最终状态完整）。 */
  flush: (key: string) => void;
  /** 立即应用全部挂起批次（组件卸载时调用）。 */
  flushAll: () => void;
} {
  const pending = new Map<string, T>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  const flushKey = (key: string) => {
    const timer = timers.get(key);
    if (timer) {
      clearTimeout(timer);
      timers.delete(key);
    }
    const value = pending.get(key);
    pending.delete(key);
    if (value !== undefined) apply(key, value);
  };

  const schedule = (key: string, value: T) => {
    if (intervalMs <= 0) {
      apply(key, value);
      return;
    }
    pending.set(key, value);
    if (timers.has(key)) return;
    timers.set(
      key,
      setTimeout(() => {
        timers.delete(key);
        const latest = pending.get(key);
        pending.delete(key);
        if (latest !== undefined) apply(key, latest);
      }, intervalMs),
    );
  };

  onBeforeUnmount(() => {
    for (const key of timers.keys()) flushKey(key);
  });

  return {
    schedule,
    flush: flushKey,
    flushAll: () => {
      for (const key of timers.keys()) flushKey(key);
    },
  };
}

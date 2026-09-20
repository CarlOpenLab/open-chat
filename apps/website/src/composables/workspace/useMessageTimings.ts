import type { DefaultMessageInfo, XModelMessage } from "@antdv-next/x-sdk";

interface MessageTimingExtraInfo {
  turnStartedAtMs?: unknown;
  turnDurationMs?: unknown;
}

/** 计时缓存 key：会话 key 限定同名 provider message id 的归属。 */
export const messageTimingKey = (conversationKey: string, messageId: string | number): string =>
  `${conversationKey}::${String(messageId)}`;

export const timingExtraInfo = (
  extraInfo: Record<string, unknown> | undefined,
): MessageTimingExtraInfo => extraInfo ?? {};

/**
 * 回合耗时（耗时徽标）的会话级缓存与落盘：
 * 流式期间记录起始时间，回合结束时把 startedAt / durationMs 写回该条 assistant 消息。
 */
export function useMessageTimings() {
  const turnTimingStarts = new Map<string, number>();
  const turnTimingValues = new Map<string, { startedAtMs?: number; durationMs: number }>();

  /**
   * Keep turn timing on the exact assistant message that produced it. The
   * conversation key scopes identical provider message ids across sessions.
   */
  const persistMessageTimings = (
    conversationKey: string,
    source: DefaultMessageInfo<XModelMessage>[],
  ): DefaultMessageInfo<XModelMessage>[] => {
    if (!conversationKey) return source;
    const now = Date.now();
    let changed = false;
    const next = source.map((item) => {
      if (item.message.role !== "assistant") return item;

      if (item.id === undefined || item.id === null || String(item.id) === "") return item;
      const key = messageTimingKey(conversationKey, item.id);
      const streaming = item.status === "loading" || item.status === "updating";
      const extraInfo = item.extraInfo as Record<string, unknown> | undefined;
      const timing = timingExtraInfo(extraInfo);

      if (streaming) {
        if (!turnTimingStarts.has(key)) turnTimingStarts.set(key, now);
        turnTimingValues.delete(key);
        if ("turnStartedAtMs" in timing || "turnDurationMs" in timing) {
          const { turnStartedAtMs: _startedAt, turnDurationMs: _duration, ...rest } = timing;
          changed = true;
          return {
            ...item,
            extraInfo: Object.keys(rest).length ? rest : undefined,
          };
        }
        return item;
      }

      const startedAtMs = turnTimingStarts.get(key);
      const persistedDuration =
        typeof timing.turnDurationMs === "number" && timing.turnDurationMs > 0
          ? timing.turnDurationMs
          : undefined;
      if (persistedDuration) {
        turnTimingValues.set(key, {
          startedAtMs:
            typeof timing.turnStartedAtMs === "number" ? timing.turnStartedAtMs : undefined,
          durationMs: persistedDuration,
        });
        return item;
      }

      if (!startedAtMs) {
        const cachedTiming = turnTimingValues.get(key);
        if (!cachedTiming) return item;

        changed = true;
        return {
          ...item,
          extraInfo: {
            ...extraInfo,
            ...(cachedTiming.startedAtMs !== undefined
              ? { turnStartedAtMs: cachedTiming.startedAtMs }
              : {}),
            turnDurationMs: cachedTiming.durationMs,
          },
        };
      }

      turnTimingStarts.delete(key);
      const durationMs = Math.max(1, now - startedAtMs);
      turnTimingValues.set(key, { startedAtMs, durationMs });
      changed = true;
      return {
        ...item,
        extraInfo: {
          ...extraInfo,
          turnStartedAtMs: startedAtMs,
          turnDurationMs: durationMs,
        },
      };
    });
    return changed ? next : source;
  };

  return { persistMessageTimings };
}

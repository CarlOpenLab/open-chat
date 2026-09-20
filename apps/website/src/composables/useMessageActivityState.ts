import type { BubbleItemType } from "@antdv-next/x";
import type { TranscriptMessage } from "@cc-heart/open-chat-types";
import { ref, toValue, watch, type MaybeRefOrGetter } from "vue";

/** useXChat 中 "loading"（占位等待）和 "updating"（流式接收中）都表示消息仍在进行中 */
export const isStreamingStatus = (status: unknown): boolean =>
  status === "loading" || status === "updating";

/** 取气泡携带的活动消息：合并组携带多条，普通气泡携带单条。 */
export const activityMessages = (item: BubbleItemType): TranscriptMessage[] => {
  const extra = item.extraInfo as { messages?: unknown; message?: unknown } | undefined;
  if (Array.isArray(extra?.messages)) return extra.messages as TranscriptMessage[];
  return extra?.message ? [extra.message as TranscriptMessage] : [];
};

interface Options {
  /** 已按活动组折叠的展示项（ChatMessages 的 displayItems）。 */
  displayItems: MaybeRefOrGetter<BubbleItemType[]>;
  /** 会话 key：隔离不同会话的展开态与计时（草稿会话用 __draft__）。 */
  conversationKey: MaybeRefOrGetter<string>;
  /** 当前会话服务端运行起点，刷新恢复时用于校正回合计时。 */
  workingStartedAtMs: MaybeRefOrGetter<number | undefined>;
}

/**
 * 消息列表的逐条 UI 状态机：活动摘要展开态、条目展开态、回合计时、思考计时。
 *
 * 计时都按「气泡 key」记账，key 由 conversationKey + 气泡 key 组成，避免不同会话
 * 的同名片段串扰。流式结束的回合会把摘要自动收敛为折叠（"已执行：…"），用户此前的
 * 手动展开/折叠优先于默认值，因此展开态与默认值分开存储（saved ?? streaming）。
 */
export function useMessageActivityState(options: Options) {
  /** 活动摘要展开态（回合结束默认折叠为分割线）。 */
  const summaryExpandedMap = ref<Record<string, boolean>>({});
  /** 活动条目展开态（reasoning/tool/plan… 的子项 id）。 */
  const itemExpandedMap = ref<Record<string, string[]>>({});
  /** 用户在流式中手动折叠过思考条目（显式点击优先于自动展开）。 */
  const reasoningCollapsedMap = ref<Record<string, boolean>>({});
  const messageStartMap = ref<Record<string, number>>({});
  const turnDurationMap = ref<Record<string, number>>({});
  const reasoningStartMap = ref<Record<string, number>>({});
  const reasoningDurationMap = ref<Record<string, number>>({});
  const lastStreamingMap = ref<Record<string, boolean>>({});

  const getThinkKey = (messageId: string | number) =>
    `${toValue(options.conversationKey) || "__draft__"}::${String(messageId)}`;

  const persistedTurnDuration = (item: BubbleItemType): number | undefined => {
    const value = (item.extraInfo as { turnDurationMs?: unknown } | undefined)?.turnDurationMs;
    return typeof value === "number" && value > 0 ? value : undefined;
  };

  /** 历史消息（本次会话未观测到耗时）默认展开活动列表；本次会话中结束的回合默认折叠为分割线。 */
  const isSummaryExpanded = (messageId: string | number, streaming: boolean): boolean => {
    const key = getThinkKey(messageId);
    const saved = summaryExpandedMap.value[key];
    return saved !== undefined ? saved : streaming;
  };

  /** 流式中思考自动展开；其余条目跟随用户手动展开状态。用户手动折叠思考后不再自动展开。 */
  const isItemExpandedIds = (item: BubbleItemType): string[] => {
    const key = getThinkKey(item.key);
    const saved = itemExpandedMap.value[key] ?? [];
    const hasReasoning = activityMessages(item).some((message) => message.role === "reasoning");
    const reasoningLive =
      isStreamingStatus(item.status) &&
      hasReasoning &&
      item.extraInfo?.reasoningDone !== true &&
      !reasoningCollapsedMap.value[key];
    if (!reasoningLive) return saved;
    return saved.includes("reasoning") ? saved : [...saved, "reasoning"];
  };

  const setSummaryExpanded = (messageId: string | number, expanded: boolean) => {
    summaryExpandedMap.value = { ...summaryExpandedMap.value, [getThinkKey(messageId)]: expanded };
  };

  const setItemExpandedIds = (messageId: string | number, ids: string[]) => {
    const key = getThinkKey(messageId);
    itemExpandedMap.value = { ...itemExpandedMap.value, [key]: ids };
    const collapsed = !ids.includes("reasoning");
    reasoningCollapsedMap.value = collapsed
      ? { ...reasoningCollapsedMap.value, [key]: true }
      : (() => {
          const next = { ...reasoningCollapsedMap.value };
          delete next[key];
          return next;
        })();
  };

  /** 思考阶段耗时（合并组按组计时）：ActivityList 的"思考用时 Xs"。 */
  const getReasoningDurationMs = (messageId: string | number): number | undefined =>
    reasoningDurationMap.value[getThinkKey(messageId)];

  watch(
    [() => toValue(options.displayItems), () => toValue(options.workingStartedAtMs)],
    ([items]) => {
      const now = Date.now();
      const workingStartedAtMs = toValue(options.workingStartedAtMs);
      const nextSummary = { ...summaryExpandedMap.value };

      items.forEach((item) => {
        if (item.role !== "assistant") return;

        const key = getThinkKey(item.key);
        const streaming = isStreamingStatus(item.status);
        const prevStreaming = lastStreamingMap.value[key] ?? false;
        const storedDuration = persistedTurnDuration(item);
        if (storedDuration && !turnDurationMap.value[key]) {
          turnDurationMap.value[key] = storedDuration;
        }

        // 回合计时：首次出现 / 重新生成时记录起点；结束时记录耗时。
        if (streaming) {
          if (!prevStreaming) {
            messageStartMap.value[key] = workingStartedAtMs ?? now;
          } else if (workingStartedAtMs) {
            // 运行态可能在消息快照之后才从服务端返回，及时纠正刷新时的临时起点。
            messageStartMap.value[key] = workingStartedAtMs;
          }
          if (turnDurationMap.value[key]) {
            delete turnDurationMap.value[key];
            delete reasoningDurationMap.value[key];
            delete reasoningStartMap.value[key];
          }
        } else if (messageStartMap.value[key] && !turnDurationMap.value[key]) {
          turnDurationMap.value[key] = Math.max(1, now - messageStartMap.value[key]);
        }

        // 思考计时（合并组内任一成员是思考，即按组计时）。
        const hasReasoning = activityMessages(item).some((message) => message.role === "reasoning");
        if (hasReasoning) {
          if (!reasoningStartMap.value[key]) reasoningStartMap.value[key] = now;
          if (item.extraInfo?.reasoningDone === true && !reasoningDurationMap.value[key]) {
            reasoningDurationMap.value[key] = Math.max(1, now - reasoningStartMap.value[key]);
          }
        }

        // 活动摘要：流式中默认展开（实时看进度），回合结束默认折叠为"已执行：…"。
        // 流式中的默认展开由 isSummaryExpanded 的 fallback (saved ?? streaming) 提供，
        // 此处不再在 streaming 时写入 true，以允许用户在流式中手动折叠后保持折叠态。
        if (prevStreaming && !streaming) {
          // 回合结束自动收敛为折叠，用户之后可手动再展开
          nextSummary[key] = false;
        }

        lastStreamingMap.value[key] = streaming;
      });

      summaryExpandedMap.value = nextSummary;
    },
    { immediate: true },
  );

  return {
    isSummaryExpanded,
    isItemExpandedIds,
    setSummaryExpanded,
    setItemExpandedIds,
    getReasoningDurationMs,
  };
}

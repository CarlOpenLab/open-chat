import { computed, onBeforeUnmount, ref, watch, type ComputedRef, type Ref } from "vue";
import { LIVE_STREAM_LIMIT } from "./markdownRenderLimits";

/**
 * 流式 markdown 渲染的频率控制。
 *
 * 为什么需要这一层：`@antdv-next/x-markdown` 的流式（hasNextChunk）解决的是
 * 「怎么把不完整的 markdown 渲染对」（增量围栏扫描 + 完整重渲染），它没有
 * 任何输入频率控制——content prop 每变一次就全量重渲染一次。快速流
 * （如 mock 8ms/chunk）一秒钟上百次全文重解析，GC 追不上，堆内存堆积、
 * 页面冻结。渲染频率是应用层策略，只能在这里控制。
 *
 * 职责：
 * - content：流式期间按 MIN_RENDER_INTERVAL_MS 时间闸合并更新（正常模型
 *   每 chunk 间隔 > 120ms，闸不生效；快速流被合并，避免逐 chunk 全量渲染）；
 *   流结束立即 flush 全文。
 * - streaming：内容 ≤ LIVE_STREAM_LIMIT 时保持库的原生流式
 *   （hasNextChunk + enableAnimation）；超过后关闭，由组件配合
 *   markdownRenderLimits.isMarkdownPlainText 降级为纯文本，结束时再渲染
 *   一次完整 markdown（≤ PLAIN_TEXT_LIMIT）。
 */
const MIN_RENDER_INTERVAL_MS = 120;

export interface MarkdownStreamControl {
  /** 交给 XMarkdown 的 content：流式中按时间闸推进，结束后为全文。 */
  content: Ref<string>;
  /** 交给 XMarkdown 的 streaming 标志。 */
  streaming: ComputedRef<{ hasNextChunk: boolean; enableAnimation: boolean }>;
}

export function useMarkdownStreaming(
  fullContent: Ref<string>,
  streaming: Ref<boolean>,
): MarkdownStreamControl {
  const displayContent = ref(fullContent.value);
  let lastRenderAt = 0;
  let renderTimer: ReturnType<typeof setTimeout> | undefined;

  const render = (content: string) => {
    displayContent.value = content;
    lastRenderAt = performance.now();
  };

  const scheduleRender = () => {
    const content = fullContent.value;
    if (!streaming.value) {
      // 流结束：取消挂起的合并，立即 flush 全文（最终一次完整渲染）。
      if (renderTimer) {
        clearTimeout(renderTimer);
        renderTimer = undefined;
      }
      render(content);
      return;
    }
    const now = performance.now();
    if (now - lastRenderAt >= MIN_RENDER_INTERVAL_MS) {
      render(content);
      return;
    }
    // 距离上次渲染不足一个间隔：挂一个定时器，到点再检查。
    if (!renderTimer) {
      renderTimer = setTimeout(
        () => {
          renderTimer = undefined;
          scheduleRender();
        },
        MIN_RENDER_INTERVAL_MS - (now - lastRenderAt),
      );
    }
  };

  watch(fullContent, scheduleRender, { immediate: true });
  onBeforeUnmount(() => {
    if (renderTimer) {
      clearTimeout(renderTimer);
      renderTimer = undefined;
    }
  });

  const markdownStreaming = computed(() => {
    const live = streaming.value && fullContent.value.length <= LIVE_STREAM_LIMIT;
    return { hasNextChunk: live, enableAnimation: live };
  });

  return { content: displayContent, streaming: markdownStreaming };
}

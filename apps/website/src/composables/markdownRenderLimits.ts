/**
 * markdown 渲染的限制策略（单一事实来源）。
 *
 * `@antdv-next/x-markdown` 每次 content 更新都会对「累计全文」执行完整渲染
 * 管线：marked 全文解析 → DOMPurify 全文消毒 → innerHTML 全文 DOM 解析 →
 * 全树 VNode 重建。单次更新 O(n)、整条流 O(n²)（约 100KB 文本需要数秒、
 * 1MB 文本直接拖垮渲染进程），且对超长内容保留内存约为内容的数百倍
 * （实测 445KB 文本 ≈ 200MB+）。
 *
 * 本文件集中定义三个阈值与判定函数，组件按同一套规则降级：
 * - 流式期间内容 ≤ LIVE_STREAM_LIMIT：交给 x-markdown 原生流式渲染；
 * - 流式期间超过该阈值：改纯文本（避免流式过程中反复全量重解析）；
 * - 最终内容 ≤ PLAIN_TEXT_LIMIT：结束流式后渲染一次完整 markdown；
 * - 超过则保持纯文本（纯文本渲染成本与内容同量级）。
 */

/** 流式实时渲染（hasNextChunk + 动画）的上限；超过后流式期间改纯文本。 */
export const LIVE_STREAM_LIMIT = 32 * 1024;

/**
 * 最终内容超过该长度时放弃 markdown 渲染（改纯文本）。96KB 上限把单条
 * 消息的 markdown 管线峰值压到 ~40MB（256KB 时峰值 ~115MB，几轮长回合
 * 就会打爆页面）。
 */
export const PLAIN_TEXT_LIMIT = 96 * 1024;

/**
 * 超过该长度的代码块不再走 shiki 高亮（CodeHighlighter 会保留数倍于源码的
 * 高亮 HTML + token 结构），改渲染为普通 <pre>，避免单个大代码块吃掉大量内存。
 */
export const CODE_HIGHLIGHT_LIMIT = 48 * 1024;

/**
 * 内容是否应降级为纯文本：
 * - 最终内容超过 PLAIN_TEXT_LIMIT：全量渲染管线内存倍率 ~450x，必须降级；
 * - 流式中内容已超过 LIVE_STREAM_LIMIT：x-markdown 每次更新都会对累计全文
 *   完整重解析/重建（O(n)/次、O(n²)/流），长流式期间改纯文本，结束时再渲染
 *   一次完整 markdown，避免流式过程中堆内存堆积。
 */
export const isMarkdownPlainText = (content: string, streaming: boolean): boolean =>
  content.length > PLAIN_TEXT_LIMIT || (streaming && content.length > LIVE_STREAM_LIMIT);

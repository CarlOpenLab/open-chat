/**
 * 侧栏会话条目的时间展示：非进行中的会话显示「N 分钟前」，
 * 进行中的会话显示已运行时长「1 分 57 秒」。
 */

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * 相对时间：刚刚 / N 分钟前 / N 小时前 / N 天前，超过 30 天回落到日期。
 * `now` 可注入，便于测试。
 */
export function formatRelativeTime(timestamp?: number, now: number = Date.now()): string {
  if (!timestamp || !Number.isFinite(timestamp)) return "";

  const delta = now - timestamp;
  // 时钟回拨或时间戳来自未来时，按「刚刚」处理而不是显示负数
  if (delta < MINUTE_MS) return "刚刚";
  if (delta < HOUR_MS) return `${Math.floor(delta / MINUTE_MS)} 分钟前`;
  if (delta < DAY_MS) return `${Math.floor(delta / HOUR_MS)} 小时前`;
  if (delta < 30 * DAY_MS) return `${Math.floor(delta / DAY_MS)} 天前`;

  const date = new Date(timestamp);
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
}

/**
 * 已运行时长：57 秒 / 1 分 57 秒 / 1 时 03 分。
 * 用于侧栏「工作中」的会话条目。
 */
export function formatElapsedDuration(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / SECOND_MS));
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);

  if (hours > 0) return `${hours} 时 ${String(minutes).padStart(2, "0")} 分`;
  if (totalMinutes > 0) return `${totalMinutes} 分 ${seconds} 秒`;
  return `${seconds} 秒`;
}

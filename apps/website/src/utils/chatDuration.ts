/** Chat activity duration formatting helpers. */

/** 完成态措辞："19 秒" / "1 分 5 秒" / "1 小时 2 分"。 */
export const formatWorkedDuration = (ms: number): string => {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  const restSeconds = seconds % 60;
  if (restSeconds === 0) return `${minutes} 分钟`;
  if (minutes < 60) return `${minutes} 分 ${restSeconds} 秒`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return restMinutes === 0 ? `${hours} 小时` : `${hours} 小时 ${restMinutes} 分`;
};

/** 进行中紧凑措辞（每秒跳动）："12 秒" / "1 分 5 秒" / "1 小时 2 分"。 */
export const formatWorkingElapsed = (ms: number): string => {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  const restSeconds = seconds % 60;
  if (restSeconds === 0) return `${minutes} 分`;
  if (minutes < 60) return `${minutes} 分 ${restSeconds} 秒`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return restMinutes === 0 ? `${hours} 小时` : `${hours} 小时 ${restMinutes} 分`;
};

/**
 * 「响应偏慢」提示的触发阈值：超过它就说明这一轮很可能卡在上游。
 *
 * 与服务端的停滞兜底（apps/server/src/acpManager.ts 的 SESSION_EVENT_STALL_MS = 90s）
 * 配合：60s 起提示用户「还在等模型」，90s 由服务端中止回合并落到红色错误条，
 * 中间这 30 秒不至于让对话区看起来像白屏。
 */
export const SLOW_RESPONSE_HINT_MS = 60_000;

/**
 * 进行中状态的分段文案：正常阶段只报时长，偏慢阶段补一句原因提示。
 * @param ms 已运行时长（毫秒）
 * @returns 时长文案与可选的补充提示
 */
export const formatWorkingStatus = (ms: number): { elapsed: string; hint: string } => ({
  elapsed: formatWorkingElapsed(ms),
  hint: ms >= SLOW_RESPONSE_HINT_MS ? "仍在等待模型响应，可能已失败" : "",
});

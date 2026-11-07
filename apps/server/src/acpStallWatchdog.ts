/**
 * @description ACP 回合停滞兜底。
 *
 * 背景：`agentSession.prompt()` 的返回只由 Agent 决定。当上游凭据失效或模型网关
 * 卡在重试循环时（实测 claude-code 遇到 401 会自己退避重试数分钟），prompt 既不
 * 返回也不产生任何会话事件，前端只能显示一条「工作中 · Ns」的空对话区——用户看到
 * 的观感就是白屏。
 *
 * 本模块同时提供「判定」与「轮询」两层：判定是纯函数便于单测，轮询函数就是
 * acpManager 实际接入的那段代码，因此测试能覆盖真实的中止路径。
 */

/** 判定输入。 */
export interface AcpStallProbe {
  /** 当前时间戳（毫秒）。 */
  now: number;
  /** 本回合最近一次收到会话事件的时间戳（毫秒）。 */
  lastEventAt: number;
  /** 停滞阈值（毫秒）。 */
  stallMs: number;
  /** 该会话当前是否有等待用户批准的权限询问。 */
  permissionPending: boolean;
}

/**
 * @description 判断当前回合是否已经停滞到需要中止。
 *
 * 权限询问期间一律不算停滞：Agent 正在等前端批准工具执行，事件流本来就安静，
 * 这类等待由 ACP 自己的 permissionTimeoutMs 兜底。
 * @param {AcpStallProbe} probe - 判定输入
 * @returns {boolean} 需要中止时为 true
 */
export function isTurnStalled(probe: AcpStallProbe): boolean {
  if (probe.permissionPending) return false;
  if (probe.stallMs <= 0) return false;
  return probe.now - probe.lastEventAt >= probe.stallMs;
}

/**
 * @description 生成面向用户的停滞错误文案。
 * @param {number} stallMs - 停滞阈值（毫秒）
 * @returns {string} 错误文案
 */
export function stallErrorMessage(stallMs: number): string {
  const seconds = Math.max(1, Math.round(stallMs / 1000));
  return `Agent ${seconds} 秒内没有任何响应，回合已中止。可能是上游模型凭据失效或网络中断，请检查模型配置后重试。`;
}

/** 看门狗选项。 */
export interface StallWatchdogOptions {
  /** 停滞阈值（毫秒）；<=0 关闭检测。 */
  stallMs: number;
  /** 轮询间隔（毫秒），默认 1s。 */
  pollMs?: number;
  /** 读取本回合最近一次事件时间；返回 undefined 表示回合已结束，跳过检测。 */
  lastEventAt: () => number | undefined;
  /** 是否正等待用户批准权限（此类等待不计为停滞）。 */
  permissionPending: () => boolean;
  /** 判定停滞时调用一次（用于 abort 当前回合）。 */
  onStall: () => void;
}

/**
 * @description 启动停滞看门狗，返回停止函数。
 *
 * 定时器已 unref：不会拖住宿主进程退出。停止函数幂等，可安全重复调用。
 * @param {StallWatchdogOptions} options - 看门狗选项
 * @returns {() => void} 停止函数
 */
export function startStallWatchdog(options: StallWatchdogOptions): () => void {
  if (options.stallMs <= 0) return () => {};
  const pollMs = options.pollMs ?? 1_000;
  let stopped = false;
  let fired = false;
  const timer = setInterval(() => {
    if (stopped || fired) return;
    const lastEventAt = options.lastEventAt();
    if (lastEventAt === undefined) return;
    const stalled = isTurnStalled({
      now: Date.now(),
      lastEventAt,
      stallMs: options.stallMs,
      permissionPending: options.permissionPending(),
    });
    if (!stalled) return;
    fired = true;
    options.onStall();
  }, pollMs);
  timer.unref?.();

  return () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
  };
}

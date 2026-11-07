/// <reference types="vite-plus/test/globals" />

import { isTurnStalled, stallErrorMessage, startStallWatchdog } from "./acpStallWatchdog";

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const base = { now: 100_000, lastEventAt: 100_000, stallMs: 50_000, permissionPending: false };

describe("isTurnStalled", () => {
  it("静止未到阈值时不算停滞", () => {
    expect(isTurnStalled({ ...base, lastEventAt: base.now - 49_999 })).toBe(false);
  });

  it("静止达到阈值即判定停滞", () => {
    expect(isTurnStalled({ ...base, lastEventAt: base.now - 50_000 })).toBe(true);
  });

  it("权限询问期间即使超过阈值也不算停滞", () => {
    expect(
      isTurnStalled({ ...base, lastEventAt: base.now - 600_000, permissionPending: true }),
    ).toBe(false);
  });

  it("阈值为 0 或负数时关闭检测", () => {
    expect(isTurnStalled({ ...base, lastEventAt: 0, stallMs: 0 })).toBe(false);
    expect(isTurnStalled({ ...base, lastEventAt: 0, stallMs: -1 })).toBe(false);
  });
});

describe("stallErrorMessage", () => {
  it("按秒描述阈值，并提示检查模型配置", () => {
    const message = stallErrorMessage(50_000);
    expect(message).toContain("50 秒");
    expect(message).toContain("模型");
  });

  it("不足一秒按一秒表述，避免出现 0 秒", () => {
    expect(stallErrorMessage(1)).toContain("1 秒");
  });
});

describe("startStallWatchdog", () => {
  it("事件一直不来时按阈值触发中止，且只触发一次", async () => {
    let fired = 0;
    const stop = startStallWatchdog({
      stallMs: 80,
      pollMs: 10,
      lastEventAt: () => Date.now() - 1_000,
      permissionPending: () => false,
      onStall: () => {
        fired += 1;
      },
    });
    await sleep(120);
    stop();
    expect(fired).toBe(1);
  });

  it("事件持续到达时不触发", async () => {
    let fired = 0;
    const stop = startStallWatchdog({
      stallMs: 200,
      pollMs: 10,
      // 每次读取都刷新为「刚收到事件」，模拟 Agent 在持续输出。
      lastEventAt: () => Date.now(),
      permissionPending: () => false,
      onStall: () => {
        fired += 1;
      },
    });
    await sleep(150);
    stop();
    expect(fired).toBe(0);
  });

  it("等待用户批准权限期间不触发", async () => {
    let fired = 0;
    const stop = startStallWatchdog({
      stallMs: 80,
      pollMs: 10,
      lastEventAt: () => Date.now() - 5_000,
      permissionPending: () => true,
      onStall: () => {
        fired += 1;
      },
    });
    await sleep(120);
    stop();
    expect(fired).toBe(0);
  });

  it("停止后不再触发，且停止函数幂等", async () => {
    let fired = 0;
    const stop = startStallWatchdog({
      stallMs: 40,
      pollMs: 10,
      lastEventAt: () => Date.now() - 5_000,
      permissionPending: () => false,
      onStall: () => {
        fired += 1;
      },
    });
    stop();
    stop();
    await sleep(100);
    expect(fired).toBe(0);
  });

  it("回合已结束时（lastEventAt 为 undefined）跳过检测", async () => {
    let fired = 0;
    const stop = startStallWatchdog({
      stallMs: 40,
      pollMs: 10,
      lastEventAt: () => undefined,
      permissionPending: () => false,
      onStall: () => {
        fired += 1;
      },
    });
    await sleep(100);
    stop();
    expect(fired).toBe(0);
  });

  it("阈值为 0 时直接返回空停止函数，不启动定时器", async () => {
    let fired = 0;
    const stop = startStallWatchdog({
      stallMs: 0,
      pollMs: 10,
      lastEventAt: () => 0,
      permissionPending: () => false,
      onStall: () => {
        fired += 1;
      },
    });
    await sleep(60);
    stop();
    expect(fired).toBe(0);
  });
});

/// <reference types="vite-plus/test/globals" />

import {
  SLOW_RESPONSE_HINT_MS,
  formatWorkedDuration,
  formatWorkingElapsed,
  formatWorkingStatus,
} from "./chatDuration";

describe("formatWorkingStatus", () => {
  it("正常阶段只报时长，不带提示", () => {
    expect(formatWorkingStatus(0)).toEqual({ elapsed: "0 秒", hint: "" });
    expect(formatWorkingStatus(SLOW_RESPONSE_HINT_MS - 1)).toEqual({
      elapsed: "59 秒",
      hint: "",
    });
  });

  it("达到阈值后补一句阻塞提示", () => {
    const status = formatWorkingStatus(SLOW_RESPONSE_HINT_MS);
    expect(status.elapsed).toBe("1 分");
    expect(status.hint).toContain("等待模型响应");
  });

  it("阈值常量与服务端停滞兜底留出时间差", () => {
    // 服务端在 90s 中止回合并落红色错误条，提示需早于它出现。
    expect(SLOW_RESPONSE_HINT_MS).toBeLessThan(90_000);
  });
});

describe("既有格式化函数", () => {
  it("formatWorkingElapsed 每秒跳动且以 0 为下限", () => {
    expect(formatWorkingElapsed(-5)).toBe("0 秒");
    expect(formatWorkingElapsed(1_999)).toBe("1 秒");
    expect(formatWorkingElapsed(65_000)).toBe("1 分 5 秒");
  });

  it("formatWorkedDuration 完成态至少 1 秒", () => {
    expect(formatWorkedDuration(0)).toBe("1 秒");
    expect(formatWorkedDuration(60_000)).toBe("1 分钟");
  });
});

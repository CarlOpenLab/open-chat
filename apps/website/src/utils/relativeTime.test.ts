import { describe, expect, test } from "vite-plus/test";
import { formatElapsedDuration, formatRelativeTime } from "./relativeTime";

const NOW = new Date("2026-08-13T12:00:00.000Z").getTime();
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("formatRelativeTime", () => {
  test("returns empty string for missing or invalid timestamps", () => {
    expect(formatRelativeTime(undefined, NOW)).toBe("");
    expect(formatRelativeTime(0, NOW)).toBe("");
    expect(formatRelativeTime(Number.NaN, NOW)).toBe("");
  });

  test("collapses anything under a minute into 刚刚", () => {
    expect(formatRelativeTime(NOW, NOW)).toBe("刚刚");
    expect(formatRelativeTime(NOW - 59_000, NOW)).toBe("刚刚");
  });

  test("treats future timestamps as 刚刚 instead of negative values", () => {
    expect(formatRelativeTime(NOW + 5 * MINUTE, NOW)).toBe("刚刚");
  });

  test("scales through minutes, hours and days", () => {
    expect(formatRelativeTime(NOW - 20 * MINUTE, NOW)).toBe("20 分钟前");
    expect(formatRelativeTime(NOW - 59 * MINUTE, NOW)).toBe("59 分钟前");
    expect(formatRelativeTime(NOW - 2 * HOUR, NOW)).toBe("2 小时前");
    expect(formatRelativeTime(NOW - 23 * HOUR, NOW)).toBe("23 小时前");
    expect(formatRelativeTime(NOW - DAY, NOW)).toBe("1 天前");
    expect(formatRelativeTime(NOW - 29 * DAY, NOW)).toBe("29 天前");
  });

  test("falls back to a date beyond 30 days", () => {
    const old = new Date("2026-01-05T08:30:00.000Z").getTime();
    const date = new Date(old);
    expect(formatRelativeTime(old, NOW)).toBe(
      `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`,
    );
  });
});

describe("formatElapsedDuration", () => {
  test("shows seconds only under a minute", () => {
    expect(formatElapsedDuration(0)).toBe("0 秒");
    expect(formatElapsedDuration(57_400)).toBe("57 秒");
  });

  test("shows minutes and seconds under an hour", () => {
    expect(formatElapsedDuration(117_000)).toBe("1 分 57 秒");
    expect(formatElapsedDuration(59 * MINUTE + 3_000)).toBe("59 分 3 秒");
  });

  test("shows hours and zero-padded minutes beyond an hour", () => {
    expect(formatElapsedDuration(HOUR + 3 * MINUTE)).toBe("1 时 03 分");
    expect(formatElapsedDuration(2 * HOUR + 45 * MINUTE)).toBe("2 时 45 分");
  });

  test("clamps negative input to zero", () => {
    expect(formatElapsedDuration(-5_000)).toBe("0 秒");
  });
});

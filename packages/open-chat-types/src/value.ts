/** 容错取值工具：provider wire 数据往往是 unknown，这些函数避免反复手写守卫。 */

export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** 取 content 数组（或字符串）里的文本；thinking 部分也计入。 */
export function contentText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value
    .map((part) => {
      if (typeof part === "string") return part;
      const record = asRecord(part);
      return stringValue(record?.text) || stringValue(record?.thinking);
    })
    .filter(Boolean)
    .join("\n");
}

/** 取 content 数组里的可见文本；thinking 部分不计入。 */
export function messageContentText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value
    .map((part) => {
      if (typeof part === "string") return part;
      const record = asRecord(part);
      return stringValue(record?.type) === "thinking" ? "" : stringValue(record?.text);
    })
    .filter(Boolean)
    .join("\n");
}

export function stringifyValue(value: unknown, fallback = "[无法序列化的输出]") {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return fallback;
  }
}

/**
 * 从 provider 原始记录里取时间戳（Unix 毫秒）。
 * 兼容 epoch 秒/毫秒与 ISO 字符串；取不到返回 undefined。
 */
export function extractTimestamp(value: unknown, fallback: number = Date.now()): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 1e12 ? value * 1000 : value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

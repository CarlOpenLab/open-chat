export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

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

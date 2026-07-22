const FENCED_CODE_BLOCK = /(?:^|\r?\n)[\t ]*(?:`{3,}|~{3,})[^\r\n]*(?:\r?\n|$)/;

/**
 * Unwrap a Markdown response that was accidentally emitted as a JSON string.
 */
export function normalizeMarkdownContent(value: string): string {
  const trimmed = value.trim();

  if (!trimmed.startsWith('"') || !trimmed.endsWith('"')) {
    return value;
  }

  try {
    const decoded: unknown = JSON.parse(trimmed);
    return typeof decoded === "string" && FENCED_CODE_BLOCK.test(decoded) ? decoded : value;
  } catch {
    return value;
  }
}

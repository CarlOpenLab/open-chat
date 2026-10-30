import { randomBytes } from "node:crypto";

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** 客户端可自带的实体 id 格式（乐观创建时由浏览器生成）。 */
const CLIENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * @description 生成 URL 安全的随机 id（与旧版前端 nanoid 同字母表、同默认长度）。
 * @param {number} size - id 长度，默认 12
 * @returns {string} 随机 id
 */
export function createId(size = 12): string {
  const bytes = randomBytes(size);
  let id = "";
  for (let i = 0; i < size; i += 1) id += ALPHABET[bytes[i] % ALPHABET.length];
  return id;
}

/**
 * @description 判断客户端提交的 id 是否可直接作为主键使用。
 * @param {unknown} value - 待校验的值
 * @returns {boolean} 只含字母数字、下划线与连字符且不超过 64 字符时为 true
 */
export function isValidClientId(value: unknown): value is string {
  return typeof value === "string" && CLIENT_ID_PATTERN.test(value);
}

import { createAvatar } from "@dicebear/core";
import * as thumbs from "@dicebear/thumbs";

const DICEBEAR_PREFIX = "dicebear:";
const THUMBS_PREFIX = "dicebear:thumbs:";
const cache = new Map<string, string>();
const MAX_CACHE = 256;

export function parseDicebearSeed(value?: string): string | null {
  if (!value || !value.startsWith(DICEBEAR_PREFIX)) return null;
  const rest = value.slice(DICEBEAR_PREFIX.length);
  const idx = rest.indexOf(":");
  if (idx <= 0) return null;
  const seed = rest.slice(idx + 1).trim();
  return seed || null;
}

export function makeBotAvatar(seed: string): string {
  const cleanSeed = seed.trim() || "bot";
  return `${THUMBS_PREFIX}${cleanSeed}`;
}

export function randomAvatarSeed(): string {
  const bytes = new Uint8Array(4);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  return Math.random().toString(36).slice(2, 10);
}

export function renderBotAvatarDataUri(seed: string): string {
  const key = seed.trim() || "bot";
  const hit = cache.get(key);
  if (hit) return hit;
  const uri = createAvatar(thumbs, {
    seed: key,
    size: 128,
    radius: 0,
  }).toDataUri();
  if (cache.size >= MAX_CACHE) {
    const first = cache.keys().next().value;
    if (first !== undefined) cache.delete(first);
  }
  cache.set(key, uri);
  return uri;
}

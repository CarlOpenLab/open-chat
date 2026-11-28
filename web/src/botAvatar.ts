import {
  CAST,
  COLOR_SWATCHES,
  CORE_COLOR_IDS,
  CORE_SHAPE_IDS,
  DEFAULT_FACE,
  FACE_STYLES,
  SHAPE_FAMILIES,
  VECTOR_VARIANTS,
  autoColorForKey,
  autoNoseForKey,
  autoShapeForKey,
  castMember,
  fnv1a32,
  getInkVars,
  getLeafColor,
  haloBackground,
  renderStaticSvg,
  type CharacterPreset,
  type CharacterState,
  type CharacterVariant,
  type ColorId,
  type CoreCastId,
  type FaceStyle,
  type NoseId,
  type ShapeId,
} from "@aora-bot/engine";

const AORA_PREFIX = "aora:";
const DICEBEAR_PREFIX = "dicebear:";

const VALID_SHAPES = new Set<string>(CORE_SHAPE_IDS);
const VALID_COLORS = new Set<string>(CORE_COLOR_IDS);
const VALID_FACES = new Set<string>(FACE_STYLES);
const VALID_VARIANTS = new Set<string>(VECTOR_VARIANTS);

const CAST_BY_SHAPE = new Map<ShapeId, CharacterPreset>(CAST.map((c) => [c.shape, c]));

const svgCache = new Map<string, string>();
const MAX_CACHE = 512;

export interface BotAvatarSpec {
  character?: CoreCastId;
  shape: ShapeId;
  color: ColorId;
  face: FaceStyle;
  variant: CharacterVariant;
  nose?: NoseId | null;
  seed: string;
}

export type ResolvedBotAvatar =
  | { kind: "image"; src: string }
  | { kind: "aora"; spec: BotAvatarSpec }
  | { kind: "text"; text: string };

export const AORA_CAST: readonly CharacterPreset[] = CAST;

export const AORA_FAMILIES = SHAPE_FAMILIES.map((family) => ({
  id: family.id,
  label: family.label.zh || family.label.en,
  members: family.shapes
    .map((shape) => CAST_BY_SHAPE.get(shape))
    .filter((m): m is CharacterPreset => Boolean(m)),
})).filter((f) => f.members.length > 0);

const COLOR_ZH: Partial<Record<ColorId, string>> = {
  cream: "奶白",
  ivory: "象牙",
  black: "炭黑",
  brown: "焦糖",
  red: "草莓红",
  orange: "柑橘橙",
  yellow: "向日葵",
  green: "翠绿",
  cyan: "海青",
  blue: "晴空蓝",
  violet: "紫罗兰",
  magenta: "洋红",
  pink: "樱花粉",
  gray: "岩灰",
  sage: "鼠尾草",
  clay: "陶土",
  navy: "深海蓝",
  mauve: "烟紫",
  night: "午夜",
  cocoa: "可可",
  sky: "天蓝",
  blush: "浅桃",
  lilac: "丁香",
  butter: "黄油",
  meadow: "草坪",
};

export const AORA_COLORS = COLOR_SWATCHES.map((s) => ({
  id: s.id,
  hex: s.value,
  label: COLOR_ZH[s.id] ?? s.id,
}));

const FACE_ZH: Record<FaceStyle, string> = {
  cute: "可爱豆眼",
  capsule: "胶囊眼",
  eyes: "极简大眼",
  line: "线条脸",
  brow: "浓眉",
  glossy: "水润眼",
  sparkle: "星星眼",
  button: "纽扣眼",
  shades: "墨镜",
  droopy: "慵懒眼",
  bigmouth: "大嘴",
  pie: "复古派眼",
  screen: "屏幕脸",
  symbol: "符号眼",
  teardrop: "水滴眼",
  specs: "眼镜",
};

export const AORA_FACES: readonly { id: FaceStyle; label: string }[] = FACE_STYLES.map((id) => ({
  id,
  label: FACE_ZH[id] ?? id,
}));

const VARIANT_ZH: Record<CharacterVariant, string> = {
  solid: "实心",
  soft: "柔光",
  sticker: "贴纸",
  paper: "纸艺",
  outline: "线稿",
  glass: "玻璃",
  riso: "孔版",
  pencil: "铅笔",
  marker: "马克笔",
  crayon: "蜡笔",
  watercolor: "水彩",
  neon: "霓虹",
  chalk: "粉笔",
  origami: "折纸",
  relief: "浮雕",
  gothic: "墨韵",
};

export const AORA_VARIANTS: readonly { id: CharacterVariant; label: string }[] = [
  "solid",
  "soft",
  "sticker",
  "paper",
  "outline",
  "glass",
  "riso",
  "pencil",
  "marker",
  "crayon",
  "watercolor",
  "neon",
  "chalk",
  "origami",
  "relief",
  "gothic",
].map((id) => ({
  id: id as CharacterVariant,
  label: VARIANT_ZH[id as CharacterVariant],
}));

function pickCastBySeed(seed: string): CharacterPreset {
  const clean = seed.trim() || "open-chat-bot";
  const idx = fnv1a32(clean) % CAST.length;
  return CAST[idx] ?? CAST[0];
}

function specFromPreset(
  preset: CharacterPreset,
  overrides: {
    color?: ColorId;
    face?: FaceStyle;
    variant?: CharacterVariant;
    seed?: string;
  } = {},
): BotAvatarSpec {
  const color = overrides.color ?? preset.color;
  const face = overrides.face ?? preset.face ?? DEFAULT_FACE;
  const variant = overrides.variant ?? "solid";
  const seed = overrides.seed ?? preset.id;
  const nose = face === "line" ? (preset.nose ?? autoNoseForKey(`${preset.shape}:${color}`)) : preset.nose;
  return {
    character: preset.id as CoreCastId,
    shape: preset.shape,
    color,
    face,
    variant,
    nose,
    seed,
  };
}

function parseLegacyDicebearSeed(value: string): string | null {
  if (!value.startsWith(DICEBEAR_PREFIX)) return null;
  const rest = value.slice(DICEBEAR_PREFIX.length);
  const idx = rest.indexOf(":");
  if (idx <= 0) return null;
  const seed = rest.slice(idx + 1).trim();
  return seed || null;
}

export function parseAoraAvatar(value?: string): BotAvatarSpec | null {
  if (!value || !value.startsWith(AORA_PREFIX)) return null;
  const raw = value.slice(AORA_PREFIX.length).trim();
  if (!raw) return null;

  // Support compact bare character id (`aora:mochi`) and query format (`aora:c=mochi&k=pink&f=cute&v=soft`)
  if (!raw.includes("=") && !raw.includes("&")) {
    const preset = castMember(raw);
    if (preset) return specFromPreset(preset);
    return specFromPreset(pickCastBySeed(raw), { seed: raw });
  }

  const params = new URLSearchParams(raw);
  const charId = params.get("c") ?? params.get("character");
  const shapeParam = params.get("s") ?? params.get("shape");
  const colorParam = params.get("k") ?? params.get("color");
  const faceParam = params.get("f") ?? params.get("face");
  const variantParam = params.get("v") ?? params.get("variant");
  const seedParam = params.get("seed");

  const validColor = colorParam && VALID_COLORS.has(colorParam) ? (colorParam as ColorId) : undefined;
  const validFace = faceParam && VALID_FACES.has(faceParam) ? (faceParam as FaceStyle) : undefined;
  const validVariant = variantParam && VALID_VARIANTS.has(variantParam) ? (variantParam as CharacterVariant) : undefined;

  if (charId) {
    const preset = castMember(charId);
    if (preset) {
      return specFromPreset(preset, {
        color: validColor,
        face: validFace,
        variant: validVariant,
        seed: seedParam || preset.id,
      });
    }
  }

  if (shapeParam && VALID_SHAPES.has(shapeParam)) {
    const shape = shapeParam as ShapeId;
    const preset = CAST_BY_SHAPE.get(shape);
    if (preset) {
      return specFromPreset(preset, {
        color: validColor,
        face: validFace,
        variant: validVariant,
        seed: seedParam || preset.id,
      });
    }
    const seed = seedParam || shape;
    const color = validColor ?? autoColorForKey(seed);
    const face = validFace ?? DEFAULT_FACE;
    return {
      shape,
      color,
      face,
      variant: validVariant ?? "solid",
      nose: face === "line" ? autoNoseForKey(`${shape}:${color}`) : undefined,
      seed,
    };
  }

  if (seedParam) {
    const preset = pickCastBySeed(seedParam);
    return specFromPreset(preset, {
      color: validColor,
      face: validFace,
      variant: validVariant,
      seed: seedParam,
    });
  }

  const fallbackSeed = raw;
  const shape = autoShapeForKey(fallbackSeed);
  const color = validColor ?? autoColorForKey(fallbackSeed);
  const face = validFace ?? DEFAULT_FACE;
  return {
    shape,
    color,
    face,
    variant: validVariant ?? "solid",
    nose: face === "line" ? autoNoseForKey(`${shape}:${color}`) : undefined,
    seed: fallbackSeed,
  };
}

export function formatAoraAvatar(input: {
  character?: CoreCastId;
  shape?: ShapeId;
  color?: ColorId;
  face?: FaceStyle;
  variant?: CharacterVariant;
}): string {
  const params = new URLSearchParams();
  const preset = input.character ? castMember(input.character) : input.shape ? CAST_BY_SHAPE.get(input.shape) ?? null : null;

  if (preset) {
    params.set("c", preset.id);
    if (input.color && input.color !== preset.color) params.set("k", input.color);
    const defaultFace = preset.face ?? DEFAULT_FACE;
    if (input.face && input.face !== defaultFace) params.set("f", input.face);
  } else {
    if (input.shape) params.set("s", input.shape);
    if (input.color) params.set("k", input.color);
    if (input.face && input.face !== DEFAULT_FACE) params.set("f", input.face);
  }

  if (input.variant && input.variant !== "solid") {
    params.set("v", input.variant);
  }

  return `${AORA_PREFIX}${params.toString()}`;
}

export function resolveBotAvatar(value?: string, fallbackSeed = "Bot"): ResolvedBotAvatar {
  const v = (value ?? "").trim();
  if (/^data:image\/|^https?:\/\//i.test(v)) {
    return { kind: "image", src: v };
  }
  const aora = parseAoraAvatar(v);
  if (aora) {
    return { kind: "aora", spec: aora };
  }
  const legacySeed = parseLegacyDicebearSeed(v);
  if (legacySeed) {
    return { kind: "aora", spec: specFromPreset(pickCastBySeed(legacySeed), { seed: legacySeed }) };
  }
  if (!v) {
    const seed = fallbackSeed.trim() || "Bot";
    return { kind: "aora", spec: specFromPreset(pickCastBySeed(seed), { seed }) };
  }
  return { kind: "text", text: v };
}

export function getBotPreset(spec: BotAvatarSpec): CharacterPreset | null {
  if (spec.character) return castMember(spec.character);
  return CAST_BY_SHAPE.get(spec.shape) ?? null;
}

export function makeBotAvatar(seed?: string): string {
  const preset = pickCastBySeed(seed ?? randomAvatarSeed());
  return formatAoraAvatar({ character: preset.id as CoreCastId });
}

export function randomBotAvatar(excludeCharacter?: string): string {
  const pool = excludeCharacter ? CAST.filter((c) => c.id !== excludeCharacter) : CAST;
  const list = pool.length > 0 ? pool : CAST;
  const idx = Math.floor(Math.random() * list.length);
  const picked = list[idx] ?? CAST[0];
  return formatAoraAvatar({ character: picked.id as CoreCastId });
}

export function randomAvatarSeed(): string {
  const bytes = new Uint8Array(4);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  return Math.random().toString(36).slice(2, 10);
}

export function getAvatarHalo(color: ColorId): string {
  return haloBackground(color);
}

export function getAvatarInkStyle(color: ColorId): Record<string, string> {
  return {
    ...getInkVars(color),
    "--aora-leaf-color": getLeafColor(color),
    "--aora-bg": "var(--modal-bg)",
  };
}

import type { Turn } from "./transcript";

export function stateForLiveStatus(status?: string, hasPendingPerm = false): CharacterState {
  if (hasPendingPerm) return "notifying";
  if (status === "running") return "working";
  if (status === "connecting") return "loading";
  if (status === "error") return "sad";
  return "idle";
}

export function stateForTurn(options: {
  turn: Turn;
  streaming: boolean;
  failed: boolean;
  isLast: boolean;
  pendingPerm?: boolean;
}): CharacterState {
  const { turn, streaming, failed, isLast, pendingPerm } = options;
  if (streaming) {
    if (pendingPerm) return "notifying";
    const lastSeg = turn.segments[turn.segments.length - 1];
    if (!lastSeg) return "thinking";
    if (lastSeg.kind === "permission" && !lastSeg.resolved) return "notifying";
    if (lastSeg.kind === "thought" || lastSeg.kind === "plan") return "thinking";
    if (lastSeg.kind === "tools") {
      const active = [...lastSeg.calls].reverse().find((c) => c.status === "in_progress" || c.status === "pending");
      const target = active ?? lastSeg.calls[lastSeg.calls.length - 1];
      if (target) {
        const hint = `${target.kind ?? ""} ${target.title ?? ""}`.toLowerCase();
        if (/\b(search|grep|glob|find|fetch|web)\b/.test(hint)) return "searching";
        if (/\b(read|view|list|cat|open)\b/.test(hint)) return "reading";
        if (/\b(edit|write|create|patch|save)\b/.test(hint)) return "writing";
      }
      return "working";
    }
    if (lastSeg.kind === "text") return "composing";
    return "working";
  }
  if (failed) return "sad";
  if (turn.end?.stopReason === "cancelled") return "bored";
  if (isLast && turn.end?.stopReason === "end_turn") return "happy";
  return "idle";
}

export function renderAoraAvatarDataUri(
  spec: BotAvatarSpec,
  options: {
    state?: CharacterState;
    dark?: boolean;
    sizePx?: number;
  } = {},
): string {
  const state = options.state ?? "idle";
  const scheme = options.dark ? "dark" : "light";
  const sizePx = options.sizePx ?? 128;
  const cacheKey = `${spec.shape}|${spec.color}|${spec.face}|${spec.variant}|${spec.nose ?? ""}|${state}|${scheme}|${sizePx}`;
  const hit = svgCache.get(cacheKey);
  if (hit) return hit;

  const rawSvg = renderStaticSvg({
    shape: spec.shape,
    color: spec.color,
    face: spec.face,
    variant: spec.variant,
    nose: spec.face === "line" ? (spec.nose ?? undefined) : undefined,
    state,
    sizePx,
    colorScheme: "page",
  });
  // Bind explicit color-scheme inside the standalone SVG image so manual app light/dark toggles apply immediately.
  const themedSvg = rawSvg.replace("<svg ", `<svg style="color-scheme:${scheme}" `);
  const uri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(themedSvg)}`;

  if (svgCache.size >= MAX_CACHE) {
    const first = svgCache.keys().next().value;
    if (first !== undefined) svgCache.delete(first);
  }
  svgCache.set(cacheKey, uri);
  return uri;
}

<script setup lang="ts">
import { SyncOutlined, UploadOutlined } from "@antdv-next/icons";
import { Input, Tooltip } from "antdv-next";
import type { CharacterVariant, ColorId, CoreCastId, FaceStyle } from "@aora-bot/engine";
import { computed, ref } from "vue";
import {
  AORA_CAST,
  AORA_COLORS,
  AORA_FACES,
  AORA_FAMILIES,
  AORA_VARIANTS,
  formatAoraAvatar,
  getBotPreset,
  randomBotAvatar,
  resolveBotAvatar,
} from "../botAvatar";
import BotAvatar from "./BotAvatar.vue";

const props = defineProps<{
  avatar?: string;
  name?: string;
}>();

const emit = defineEmits<{
  select: [avatar: string];
  upload: [];
}>();

type PickerTab = "character" | "color" | "face" | "variant";

const activeTab = ref<PickerTab>("character");
const activeFamily = ref<string>("all");
const query = ref("");

const resolved = computed(() => resolveBotAvatar(props.avatar, props.name || "Bot"));
const currentSpec = computed(() => {
  if (resolved.value.kind === "aora") return resolved.value.spec;
  const fallback = resolveBotAvatar("", props.name || "Bot");
  return fallback.kind === "aora" ? fallback.spec : null;
});
const currentPreset = computed(() => (currentSpec.value ? getBotPreset(currentSpec.value) : null));
const isCustomImage = computed(() => resolved.value.kind === "image");

const filteredCast = computed(() => {
  const q = query.value.trim().toLowerCase();
  const base =
    activeFamily.value === "all"
      ? AORA_CAST
      : AORA_FAMILIES.find((f) => f.id === activeFamily.value)?.members ?? AORA_CAST;
  if (!q) return base;
  return base.filter(
    (c) =>
      c.id.toLowerCase().includes(q) ||
      c.name.zh.toLowerCase().includes(q) ||
      c.name.en.toLowerCase().includes(q) ||
      c.desc.zh.toLowerCase().includes(q),
  );
});

function pickCharacter(id: CoreCastId) {
  const cur = currentSpec.value;
  // Picking a new character adopts that character's own signature color & face while keeping user's chosen variant.
  emit(
    "select",
    formatAoraAvatar({
      character: id,
      variant: cur?.variant,
    }),
  );
}

function pickColor(color: ColorId) {
  const cur = currentSpec.value;
  if (!cur) return;
  emit(
    "select",
    formatAoraAvatar({
      character: cur.character,
      shape: cur.shape,
      color,
      face: cur.face,
      variant: cur.variant,
    }),
  );
}

function resetColor() {
  const preset = currentPreset.value;
  const cur = currentSpec.value;
  if (!preset || !cur) return;
  pickColor(preset.color);
}

function pickFace(face: FaceStyle) {
  const cur = currentSpec.value;
  if (!cur) return;
  emit(
    "select",
    formatAoraAvatar({
      character: cur.character,
      shape: cur.shape,
      color: cur.color,
      face,
      variant: cur.variant,
    }),
  );
}

function pickVariant(variant: CharacterVariant) {
  const cur = currentSpec.value;
  if (!cur) return;
  emit(
    "select",
    formatAoraAvatar({
      character: cur.character,
      shape: cur.shape,
      color: cur.color,
      face: cur.face,
      variant,
    }),
  );
}

function pickRandom() {
  emit("select", randomBotAvatar(currentSpec.value?.character));
}

function previewForFace(face: FaceStyle): string {
  const cur = currentSpec.value;
  if (!cur) return formatAoraAvatar({ character: "mochi", face });
  return formatAoraAvatar({
    character: cur.character,
    shape: cur.shape,
    color: cur.color,
    face,
    variant: cur.variant,
  });
}

function previewForVariant(variant: CharacterVariant): string {
  const cur = currentSpec.value;
  if (!cur) return formatAoraAvatar({ character: "mochi", variant });
  return formatAoraAvatar({
    character: cur.character,
    shape: cur.shape,
    color: cur.color,
    face: cur.face,
    variant,
  });
}
</script>

<template>
  <div class="w-[344px] flex flex-col gap-2.5 select-none">
    <!-- Top Tabs -->
    <div class="flex items-center justify-between gap-2">
      <div class="inline-flex items-center gap-[2px] p-[2px] rounded-[8px] bg-hover border border-solid border-line">
        <button
          v-for="tab in ([
            { id: 'character', label: '角色' },
            { id: 'color', label: '配色' },
            { id: 'face', label: '脸型' },
            { id: 'variant', label: '画风' },
          ] as const)"
          :key="tab.id"
          type="button"
          class="px-2.5 h-[24px] rounded-[6px] border-0 text-[11.5px] fw-530 cursor-pointer transition-colors"
          :class="activeTab === tab.id ? 'bg-modal text-ink shadow-card' : 'bg-transparent text-ink-3 hover:text-ink-2'"
          @click="activeTab = tab.id"
        >
          {{ tab.label }}
        </button>
      </div>

      <span class="text-[11px] text-ink-3 truncate">
        <template v-if="isCustomImage">自定义图片</template>
        <template v-else-if="currentPreset">{{ currentPreset.name.zh }}</template>
      </span>
    </div>

    <!-- Tab: Character (71 cast members) -->
    <template v-if="activeTab === 'character'">
      <div class="flex flex-col gap-2">
        <Input
          v-model:value="query"
          size="small"
          allow-clear
          placeholder="搜索 71 个角色（如 糯糯、猫、机器人…）"
        />

        <div class="flex items-center gap-1 overflow-x-auto pb-0.5 no-scrollbar">
          <button
            type="button"
            class="px-2 h-[22px] rounded-full border text-[11px] flex-none cursor-pointer transition-colors"
            :class="
              activeFamily === 'all'
                ? 'border-line-strong bg-active text-ink fw-550'
                : 'border-transparent bg-hover text-ink-3 hover:text-ink-2'
            "
            @click="activeFamily = 'all'"
          >
            全部
          </button>
          <button
            v-for="fam in AORA_FAMILIES"
            :key="fam.id"
            type="button"
            class="px-2 h-[22px] rounded-full border text-[11px] flex-none cursor-pointer transition-colors"
            :class="
              activeFamily === fam.id
                ? 'border-line-strong bg-active text-ink fw-550'
                : 'border-transparent bg-hover text-ink-3 hover:text-ink-2'
            "
            @click="activeFamily = fam.id"
          >
            {{ fam.label }}
          </button>
        </div>

        <div class="grid grid-cols-6 gap-1.5 max-h-[212px] overflow-y-auto pr-0.5">
          <Tooltip
            v-for="member in filteredCast"
            :key="member.id"
            :title="`${member.name.zh} · ${member.desc.zh}`"
            :mouse-enter-delay="0.25"
          >
            <button
              type="button"
              class="flex flex-col items-center gap-1 p-1.5 rounded-[10px] border border-solid cursor-pointer transition-all"
              :class="
                !isCustomImage && currentSpec?.character === member.id
                  ? 'border-ink-solid bg-active shadow-card'
                  : 'border-transparent bg-hover/60 hover:bg-hover hover:border-line'
              "
              @click="pickCharacter(member.id as CoreCastId)"
            >
              <BotAvatar
                :avatar="formatAoraAvatar({ character: member.id as CoreCastId })"
                :name="member.name.zh"
                :size="32"
              />
              <span class="text-[10px] text-ink-2 truncate w-full text-center leading-tight">
                {{ member.name.zh }}
              </span>
            </button>
          </Tooltip>
          <div
            v-if="filteredCast.length === 0"
            class="col-span-6 py-6 text-center text-[12px] text-ink-3"
          >
            没有找到匹配的角色
          </div>
        </div>
      </div>
    </template>

    <!-- Tab: Color (25 swatches) -->
    <template v-else-if="activeTab === 'color'">
      <div class="flex flex-col gap-2">
        <div class="flex items-center justify-between text-[11px] text-ink-3">
          <span>选择角色主色</span>
          <button
            v-if="currentPreset && currentSpec?.color !== currentPreset.color"
            type="button"
            class="border-0 bg-transparent p-0 text-[11px] text-ink-2 cursor-pointer hover:text-ink"
            @click="resetColor"
          >
            恢复「{{ currentPreset.name.zh }}」默认色
          </button>
        </div>
        <div class="grid grid-cols-7 gap-2 py-1">
          <Tooltip v-for="c in AORA_COLORS" :key="c.id" :title="c.label" :mouse-enter-delay="0.2">
            <button
              type="button"
              class="w-8 h-8 rounded-full border-2 border-solid cursor-pointer transition-transform hover:scale-110 active:scale-95 grid place-items-center mx-auto"
              :class="
                !isCustomImage && currentSpec?.color === c.id
                  ? 'border-ink-solid scale-110 shadow-card'
                  : 'border-line'
              "
              :style="{ backgroundColor: c.hex }"
              :aria-label="c.label"
              @click="pickColor(c.id)"
            />
          </Tooltip>
        </div>
      </div>
    </template>

    <!-- Tab: Face (16 face styles) -->
    <template v-else-if="activeTab === 'face'">
      <div class="grid grid-cols-4 gap-1.5 max-h-[246px] overflow-y-auto pr-0.5">
        <button
          v-for="f in AORA_FACES"
          :key="f.id"
          type="button"
          class="flex flex-col items-center gap-1 p-2 rounded-[10px] border border-solid cursor-pointer transition-all"
          :class="
            !isCustomImage && currentSpec?.face === f.id
              ? 'border-ink-solid bg-active shadow-card'
              : 'border-transparent bg-hover/60 hover:bg-hover hover:border-line'
          "
          @click="pickFace(f.id)"
        >
          <BotAvatar :avatar="previewForFace(f.id)" :name="f.label" :size="36" />
          <span class="text-[10.5px] text-ink-2 truncate w-full text-center">{{ f.label }}</span>
        </button>
      </div>
    </template>

    <!-- Tab: Variant (16 vector styles) -->
    <template v-else>
      <div class="grid grid-cols-4 gap-1.5 max-h-[246px] overflow-y-auto pr-0.5">
        <button
          v-for="v in AORA_VARIANTS"
          :key="v.id"
          type="button"
          class="flex flex-col items-center gap-1 p-2 rounded-[10px] border border-solid cursor-pointer transition-all"
          :class="
            !isCustomImage && currentSpec?.variant === v.id
              ? 'border-ink-solid bg-active shadow-card'
              : 'border-transparent bg-hover/60 hover:bg-hover hover:border-line'
          "
          @click="pickVariant(v.id)"
        >
          <BotAvatar :avatar="previewForVariant(v.id)" :name="v.label" :size="36" />
          <span class="text-[10.5px] text-ink-2 truncate w-full text-center">{{ v.label }}</span>
        </button>
      </div>
    </template>

    <!-- Footer Actions -->
    <div class="pt-2 border-0 border-t border-solid border-line flex items-center justify-between gap-2">
      <span class="text-[11px] text-ink-3 truncate min-w-0 flex-1">
        {{ isCustomImage ? "可点击上方角色切回动态形象" : currentPreset?.desc.zh || "Aora Bot 动态角色" }}
      </span>
      <div class="flex items-center gap-1.5 flex-none">
        <button
          type="button"
          class="inline-flex items-center gap-1 h-[24px] px-2 rounded-[6px] border border-solid border-line bg-hover text-ink-2 text-[11px] cursor-pointer transition-colors hover:bg-active hover:text-ink"
          @click="pickRandom"
        >
          <SyncOutlined class="text-[11px]" />
          <span>随机</span>
        </button>
        <button
          type="button"
          class="inline-flex items-center gap-1 h-[24px] px-2 rounded-[6px] border border-solid border-line bg-hover text-ink-2 text-[11px] cursor-pointer transition-colors hover:bg-active hover:text-ink"
          @click="emit('upload')"
        >
          <UploadOutlined class="text-[11px]" />
          <span>上传图片</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.no-scrollbar {
  scrollbar-width: none;
}
.no-scrollbar::-webkit-scrollbar {
  display: none;
}
</style>

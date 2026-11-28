<script setup lang="ts">
import { computed } from "vue";
import { parseDicebearSeed, renderBotAvatarDataUri } from "../botAvatar";

const props = withDefaults(
  defineProps<{
    avatar?: string;
    name?: string;
    size?: number;
  }>(),
  {
    avatar: "",
    name: "Bot",
    size: 20,
  },
);

const trimmed = computed(() => (props.avatar ?? "").trim());

const resolvedImage = computed(() => {
  const v = trimmed.value;
  if (/^data:image\/|^https?:\/\//i.test(v)) return v;
  const seed = parseDicebearSeed(v);
  if (seed) return renderBotAvatarDataUri(seed);
  if (!v) return renderBotAvatarDataUri(props.name || "Bot");
  return "";
});

const emojiFontSize = computed(() => `${Math.max(11, Math.round(props.size * 0.78))}px`);
</script>

<template>
  <span
    class="inline-flex items-center justify-center rounded-full overflow-hidden flex-none select-none leading-none"
    :style="{ width: `${size}px`, height: `${size}px` }"
    :title="name"
  >
    <img
      v-if="resolvedImage"
      :src="resolvedImage"
      :alt="name"
      class="w-full h-full object-cover block rounded-[inherit]"
    />
    <span v-else :style="{ fontSize: emojiFontSize }" class="leading-none">{{ trimmed }}</span>
  </span>
</template>

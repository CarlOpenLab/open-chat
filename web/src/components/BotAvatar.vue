<script setup lang="ts">
import { createCharacter, type CharacterController, type CharacterState } from "@aora-bot/engine";
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import {
  getAvatarHalo,
  getAvatarInkStyle,
  renderAoraAvatarDataUri,
  resolveBotAvatar,
  type BotAvatarSpec,
} from "../botAvatar";
import { isDark } from "../store";

const props = withDefaults(
  defineProps<{
    avatar?: string;
    name?: string;
    size?: number;
    state?: CharacterState;
    animated?: boolean;
    emphasis?: boolean;
    antics?: boolean;
    interactive?: boolean;
    halo?: boolean;
  }>(),
  {
    avatar: "",
    name: "Bot",
    size: 20,
    state: "idle",
    animated: false,
    emphasis: false,
    antics: false,
    interactive: false,
    halo: true,
  },
);

const resolved = computed(() => resolveBotAvatar(props.avatar, props.name || "Bot"));
const aoraSpec = computed<BotAvatarSpec | null>(() =>
  resolved.value.kind === "aora" ? resolved.value.spec : null,
);

const liveHostRef = ref<HTMLElement | null>(null);
const hoverLive = ref(false);
const hoverEmphasis = ref(false);
const followTarget = ref<{ x: number; y: number } | null>(null);
let controller: CharacterController | null = null;
let leaveTimer: ReturnType<typeof setTimeout> | null = null;
let pendingBounce: number | null = null;

const useLive = computed(() => Boolean((props.animated || hoverLive.value) && aoraSpec.value));

const staticSrc = computed(() => {
  if (resolved.value.kind === "image") return resolved.value.src;
  if (resolved.value.kind === "aora" && !useLive.value) {
    return renderAoraAvatarDataUri(resolved.value.spec, {
      state: props.state,
      dark: isDark.value,
      sizePx: props.size <= 32 ? 96 : 160,
    });
  }
  return "";
});

const containerStyle = computed<Record<string, string>>(() => {
  const base: Record<string, string> = {
    width: `${props.size}px`,
    height: `${props.size}px`,
  };
  if (aoraSpec.value && useLive.value) {
    Object.assign(base, getAvatarInkStyle(aoraSpec.value.color));
  }
  return base;
});

const haloStyle = computed<Record<string, string> | undefined>(() => {
  if (!aoraSpec.value || !props.halo) return undefined;
  return { background: getAvatarHalo(aoraSpec.value.color) };
});

const emojiFontSize = computed(() => `${Math.max(11, Math.round(props.size * 0.78))}px`);
const isCompact = computed(() => props.size <= 22);

function clearLeaveTimer() {
  if (leaveTimer !== null) {
    clearTimeout(leaveTimer);
    leaveTimer = null;
  }
}

function destroyController() {
  if (controller) {
    controller.destroy();
    controller = null;
  }
  if (liveHostRef.value) {
    liveHostRef.value.innerHTML = "";
  }
}

function buildCharacterOptions(spec: BotAvatarSpec) {
  return {
    shape: spec.shape,
    face: spec.face,
    nose: spec.face === "line" ? (spec.nose ?? undefined) : undefined,
    variant: spec.variant,
    state: props.state,
    seed: spec.seed,
    emphasis: props.emphasis || hoverEmphasis.value,
    antics: props.antics,
    followTarget: props.interactive ? followTarget.value : null,
    entryEffects: true,
    autoPause: true,
  };
}

function mountController() {
  destroyController();
  const host = liveHostRef.value;
  const spec = aoraSpec.value;
  if (!host || !spec || !useLive.value) return;
  controller = createCharacter(host, buildCharacterOptions(spec));
  if (pendingBounce !== null) {
    const strength = pendingBounce;
    pendingBounce = null;
    controller.bounce(strength);
  }
}

watch(
  [useLive, liveHostRef],
  async ([live]) => {
    if (!live) {
      pendingBounce = null;
      destroyController();
      return;
    }
    await nextTick();
    if (useLive.value && liveHostRef.value && !controller) {
      mountController();
    }
  },
  { immediate: true },
);

watch(
  () => [
    aoraSpec.value?.shape,
    aoraSpec.value?.face,
    aoraSpec.value?.nose,
    aoraSpec.value?.variant,
    props.state,
    props.emphasis,
    props.antics,
    hoverEmphasis.value,
    followTarget.value,
  ],
  () => {
    const spec = aoraSpec.value;
    if (!controller || !spec) return;
    controller.update(buildCharacterOptions(spec));
  },
);

onBeforeUnmount(() => {
  clearLeaveTimer();
  destroyController();
});

function onMouseEnter(e: MouseEvent) {
  if (!props.interactive || !aoraSpec.value) return;
  clearLeaveTimer();
  hoverEmphasis.value = true;
  followTarget.value = { x: e.clientX, y: e.clientY };
  if (controller) {
    controller.bounce(0.45);
  } else {
    pendingBounce = 0.45;
    hoverLive.value = true;
  }
}

function onMouseMove(e: MouseEvent) {
  if (!props.interactive || !aoraSpec.value) return;
  followTarget.value = { x: e.clientX, y: e.clientY };
}

function onMouseLeave() {
  if (!props.interactive) return;
  hoverEmphasis.value = false;
  followTarget.value = null;
  if (!props.animated && hoverLive.value) {
    clearLeaveTimer();
    leaveTimer = setTimeout(() => {
      hoverLive.value = false;
      leaveTimer = null;
    }, 650);
  }
}

function onClick() {
  if (!props.interactive || !aoraSpec.value) return;
  clearLeaveTimer();
  if (controller) {
    controller.bounce(0.85);
  } else {
    pendingBounce = 0.85;
    hoverLive.value = true;
  }
}

defineExpose({
  bounce(strength = 0.8) {
    controller?.bounce(strength);
  },
  spin(turns = 1) {
    controller?.spin(turns);
  },
  burst(count?: number) {
    controller?.burst(count);
  },
});
</script>

<template>
  <span
    class="relative inline-flex items-center justify-center flex-none select-none leading-none"
    :class="[
      resolved.kind === 'image' ? 'rounded-full overflow-hidden' : 'overflow-visible',
      interactive && aoraSpec ? 'cursor-pointer' : '',
    ]"
    :style="containerStyle"
    :title="name"
    @mouseenter="onMouseEnter"
    @mousemove="onMouseMove"
    @mouseleave="onMouseLeave"
    @click="onClick"
  >
    <span
      v-if="haloStyle"
      class="absolute inset-0 rounded-full pointer-events-none"
      :style="haloStyle"
      aria-hidden="true"
    />
    <span
      v-if="useLive"
      ref="liveHostRef"
      class="oc-aora-host relative z-[1] w-full h-full flex items-center justify-center"
      :class="isCompact ? 'scale-[1.08]' : ''"
      aria-hidden="true"
    />
    <img
      v-else-if="staticSrc"
      :src="staticSrc"
      :alt="name"
      class="relative z-[1] w-full h-full block"
      :class="[
        resolved.kind === 'image' ? 'object-cover rounded-full' : 'object-contain',
        resolved.kind === 'aora' && isCompact ? 'scale-[1.08]' : '',
      ]"
    />
    <span v-else :style="{ fontSize: emojiFontSize }" class="relative z-[1] leading-none">{{
      resolved.kind === "text" ? resolved.text : ""
    }}</span>
  </span>
</template>

<style scoped>
.oc-aora-host :deep(svg) {
  display: block;
  width: 100%;
  height: 100%;
  overflow: visible;
  pointer-events: none;
  user-select: none;
  -webkit-user-select: none;
}
</style>

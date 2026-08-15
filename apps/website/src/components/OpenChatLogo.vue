<script setup lang="ts">
interface Props {
  size?: number;
  title?: string;
}

const props = withDefaults(defineProps<Props>(), {
  size: 24,
  title: "",
});
</script>

<template>
  <img
    src="/logo.png"
    :width="props.size"
    :height="props.size"
    class="open-chat-logo"
    :alt="props.title || undefined"
    :aria-hidden="props.title ? undefined : 'true'"
  />
</template>

<style scoped>
/* logo.png 是深灰单色图：浅色主题原样显示，
   深色主题下反色为浅灰，保证在深色工作区可见 */
.open-chat-logo {
  display: block;
  object-fit: contain;
}
:global(html[data-theme="dark"]) .open-chat-logo {
  filter: invert(1);
}
</style>

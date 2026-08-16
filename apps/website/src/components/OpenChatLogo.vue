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
.open-chat-logo {
  display: block;
  object-fit: contain;
}
</style>

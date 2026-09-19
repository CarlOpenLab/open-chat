<script setup lang="ts">
import { MessagesSquare } from "@lucide/vue";

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
  <MessagesSquare
    :size="props.size"
    class="open-chat-logo"
    :aria-label="props.title || undefined"
    :aria-hidden="props.title ? undefined : 'true'"
  />
</template>

<style scoped>
.open-chat-logo {
  display: block;
  color: inherit;
}
</style>

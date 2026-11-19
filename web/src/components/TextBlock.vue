<script setup lang="ts">
import { XMarkdown } from "@antdv-next/x-markdown";
import { computed, provide, type Component } from "vue";
import { isDark } from "../store";
import { markdownDarkKey } from "../theme-keys";
import CodeBlock from "./CodeBlock.vue";

/**
 * One piece of answer text. Split from its parent so that finished text is
 * never re-parsed: `content` is a string, so a parent update with the same
 * text leaves this component untouched.
 */
const props = defineProps<{ content: string; streaming: boolean }>();

const components: Record<string, Component> = { code: CodeBlock };
const config = { breaks: true, gfm: true };
const animation = { fadeDuration: 220, easing: "cubic-bezier(0.22, 1, 0.36, 1)" };

const streaming = computed(() =>
  props.streaming
    ? { hasNextChunk: true, enableAnimation: true, tail: true as const }
    : { hasNextChunk: false, enableAnimation: false },
);

provide(markdownDarkKey, isDark);
</script>

<template>
  <XMarkdown
    class-name="oc-md"
    :content="props.content"
    :components="components"
    :config="config"
    :streaming="streaming"
    :animation="animation"
    open-links-in-new-tab
  />
</template>

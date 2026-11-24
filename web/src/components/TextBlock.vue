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
const props = defineProps<{ content: string; streaming: boolean; className?: string }>();

const components: Record<string, Component> = { code: CodeBlock };
const config = { breaks: true, gfm: true };
const animationConfig = { fadeDuration: 280, easing: "cubic-bezier(0.22, 1, 0.36, 1)" };

const streaming = computed(() =>
  props.streaming
    ? { hasNextChunk: true, enableAnimation: true, tail: false, animationConfig }
    : { hasNextChunk: false, enableAnimation: false },
);

const rootClass = computed(() => (props.className ? `oc-md ${props.className}` : "oc-md"));

provide(markdownDarkKey, isDark);
</script>

<template>
  <XMarkdown
    :class-name="rootClass"
    :content="props.content"
    :components="components"
    :config="config"
    :streaming="streaming"
    open-links-in-new-tab
  />
</template>

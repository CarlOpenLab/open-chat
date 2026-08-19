<script setup lang="ts">
import type { BubbleItemType } from "@antdv-next/x";
import { Sources } from "@antdv-next/x";
import { XMarkdown } from "@antdv-next/x-markdown";
import { Globe2, TriangleAlert } from "@lucide/vue";
import { computed, ref } from "vue";
import type { Component } from "vue";
import type { WebSearchSourceItem } from "../../services/ai";
import MarkdownCodeRenderer from "./MarkdownCodeRenderer.vue";

interface Props {
  item: BubbleItemType;
  content: string;
  markdownClassName: string;
  streaming: boolean;
  searchResults: WebSearchSourceItem[];
}

const props = defineProps<Props>();

const markdownComponents: Record<string, Component> = {
  code: MarkdownCodeRenderer,
};

const markdownStreaming = computed(() => ({
  hasNextChunk: props.streaming,
  enableAnimation: props.streaming,
  tail: false,
}));

const chatNotices = computed(() => {
  const notices = props.item.extraInfo?.chatNotices;
  return Array.isArray(notices) ? (notices as string[]) : [];
});
const chatError = computed(() =>
  typeof props.item.extraInfo?.chatError === "string" ? props.item.extraInfo.chatError : "",
);

const getFaviconUrl = (url: string): string => {
  try {
    const { hostname } = new URL(url);
    return `https://t1.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://${hostname}&size=32`;
  } catch {
    return "";
  }
};
const failedFavicons = ref<Set<string>>(new Set());
const onFaviconError = (url: string) => {
  const next = new Set(failedFavicons.value);
  next.add(url);
  failedFavicons.value = next;
};
</script>

<template>
  <div class="assistant-message flex w-full min-w-0 max-w-full flex-col gap-3">
    <div v-if="chatNotices.length" class="flex flex-col gap-1 text-xs text-brand-muted">
      <span v-for="notice in chatNotices" :key="notice" class="inline-flex items-start gap-1.5">
        <TriangleAlert class="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>{{ notice }}</span>
      </span>
    </div>

    <!-- 正文始终单独渲染 -->
    <XMarkdown
      v-if="content.trim()"
      :content="content"
      :components="markdownComponents"
      :streaming="markdownStreaming"
      :class-name="markdownClassName"
      :config="{ breaks: true }"
      open-links-in-new-tab
    />

    <div v-if="chatError" class="inline-flex items-start gap-1.5 text-xs text-red-500">
      <TriangleAlert class="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>请求失败：{{ chatError }}</span>
    </div>

    <Sources
      v-if="searchResults.length"
      :items="searchResults"
      title="来源"
      :on-click="(source) => source.url && window.open(source.url, '_blank', 'noopener,noreferrer')"
    >
      <template #title="{ originNode }">
        <span class="inline-flex items-center gap-1.5"
          ><Globe2 class="h-3.5 w-3.5" />{{ originNode }}</span
        >
      </template>
      <template #iconRender="{ item: sourceItem }">
        <img
          v-if="sourceItem.url && !failedFavicons.has(sourceItem.url)"
          class="h-4 w-4 object-contain"
          :src="getFaviconUrl(sourceItem.url)"
          :alt="String(sourceItem.title)"
          loading="lazy"
          @error="onFaviconError(sourceItem.url)"
        />
        <Globe2 v-else class="h-4 w-4" />
      </template>
    </Sources>
  </div>
</template>

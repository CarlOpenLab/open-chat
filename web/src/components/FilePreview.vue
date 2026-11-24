<script setup lang="ts">
import {
  AudioOutlined,
  ExpandOutlined,
  MinusOutlined,
  PlusOutlined,
} from "@antdv-next/icons";
import { computed, onBeforeUnmount, ref, watch } from "vue";
import type { WorkspaceFileInfo } from "../types";
import TextBlock from "./TextBlock.vue";

export type RichPreviewKind = "image" | "svg" | "markdown" | "pdf" | "audio" | "video";

const props = defineProps<{
  kind: RichPreviewKind;
  filename: string;
  fileInfo: WorkspaceFileInfo | null;
  textContent: string;
}>();

const zoom = ref<number | "fit">("fit");
const bgMode = ref<"checker" | "light" | "dark">("checker");
const naturalSize = ref<{ w: number; h: number } | null>(null);
const mediaError = ref("");

// Safe SVG Blob URL so live edits preview immediately without executing embedded scripts.
const svgBlobUrl = ref("");

function revokeSvgUrl() {
  if (svgBlobUrl.value) {
    URL.revokeObjectURL(svgBlobUrl.value);
    svgBlobUrl.value = "";
  }
}

watch(
  () => [props.kind, props.textContent] as const,
  ([kind, text]) => {
    revokeSvgUrl();
    if (kind === "svg" && text) {
      const blob = new Blob([text], { type: "image/svg+xml;charset=utf-8" });
      svgBlobUrl.value = URL.createObjectURL(blob);
    }
  },
  { immediate: true },
);

watch(
  () => [props.filename, props.kind, props.fileInfo?.url] as const,
  () => {
    zoom.value = "fit";
    naturalSize.value = null;
    mediaError.value = "";
  },
);

onBeforeUnmount(() => {
  revokeSvgUrl();
});

const imageSrc = computed(() => {
  if (props.kind === "svg") {
    return svgBlobUrl.value || props.fileInfo?.url || "";
  }
  return props.fileInfo?.url || "";
});

const zoomPercent = computed(() => (zoom.value === "fit" ? "适应" : `${Math.round(zoom.value * 100)}%`));

function zoomIn() {
  const cur = zoom.value === "fit" ? 1 : zoom.value;
  zoom.value = Math.min(5, Math.round((cur + 0.25) * 100) / 100);
}

function zoomOut() {
  const cur = zoom.value === "fit" ? 1 : zoom.value;
  zoom.value = Math.max(0.25, Math.round((cur - 0.25) * 100) / 100);
}

function toggleFit() {
  zoom.value = zoom.value === "fit" ? 1 : "fit";
}

function onWheelZoom(e: WheelEvent) {
  if (!e.ctrlKey && !e.metaKey) return;
  e.preventDefault();
  if (e.deltaY < 0) zoomIn();
  else zoomOut();
}

function onImgLoad(e: Event) {
  mediaError.value = "";
  const img = e.target as HTMLImageElement | null;
  if (img && img.naturalWidth > 0 && img.naturalHeight > 0) {
    naturalSize.value = { w: img.naturalWidth, h: img.naturalHeight };
  }
}

function onMediaError(msg: string) {
  mediaError.value = msg;
}

const formattedSize = computed(() => {
  const bytes = props.fileInfo?.size;
  if (bytes == null || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
});

const displayName = computed(() => props.filename.split("/").pop() || props.filename);

const imgStyle = computed(() => {
  if (zoom.value === "fit") {
    return { maxWidth: "100%", maxHeight: "100%", width: "auto", height: "auto" };
  }
  if (naturalSize.value) {
    return {
      width: `${Math.round(naturalSize.value.w * zoom.value)}px`,
      height: `${Math.round(naturalSize.value.h * zoom.value)}px`,
      maxWidth: "none",
      maxHeight: "none",
    };
  }
  return {
    transform: `scale(${zoom.value})`,
    transformOrigin: "center center",
  };
});
</script>

<template>
  <!-- Image & SVG preview -->
  <div v-if="kind === 'image' || kind === 'svg'" class="flex-1 min-h-0 flex flex-col overflow-hidden">
    <div
      class="flex-1 min-h-0 overflow-auto flex items-center justify-center p-5 relative"
      :class="{
        'ws-pv-checker': bgMode === 'checker',
        'bg-[#ffffff]': bgMode === 'light',
        'bg-[#14161a]': bgMode === 'dark',
      }"
      @wheel="onWheelZoom"
    >
      <div v-if="mediaError" class="ws-pv-state err">
        <span>{{ mediaError }}</span>
      </div>
      <img
        v-else-if="imageSrc"
        :src="imageSrc"
        :alt="displayName"
        class="block select-none object-contain rounded-[4px]"
        :style="imgStyle"
        draggable="false"
        @load="onImgLoad"
        @error="onMediaError('图片加载失败或格式不受当前浏览器支持')"
      />
    </div>

    <div class="flex-none flex items-center justify-between gap-2 px-3 py-[6px] border-0 border-t border-solid border-line bg-surface-2 text-[11px] text-ink-3">
      <div class="inline-flex items-center gap-2 min-w-0 truncate font-mono">
        <span v-if="naturalSize">{{ naturalSize.w }} × {{ naturalSize.h }}</span>
        <span v-if="naturalSize && formattedSize" class="opacity-40">·</span>
        <span v-if="formattedSize">{{ formattedSize }}</span>
      </div>

      <div class="inline-flex items-center gap-2 flex-none">
        <div class="ws-pv-seg" role="group" aria-label="背景切换">
          <button
            type="button"
            class="ws-pv-seg-btn"
            :class="{ active: bgMode === 'checker' }"
            title="透明棋盘格背景"
            @click="bgMode = 'checker'"
          >
            透明
          </button>
          <button
            type="button"
            class="ws-pv-seg-btn"
            :class="{ active: bgMode === 'light' }"
            title="浅色背景"
            @click="bgMode = 'light'"
          >
            浅色
          </button>
          <button
            type="button"
            class="ws-pv-seg-btn"
            :class="{ active: bgMode === 'dark' }"
            title="深色背景"
            @click="bgMode = 'dark'"
          >
            深色
          </button>
        </div>

        <div class="inline-flex items-center gap-[2px]">
          <button type="button" class="ws-pv-icon-btn" title="缩小" @click="zoomOut">
            <MinusOutlined />
          </button>
          <button
            type="button"
            class="ws-pv-btn min-w-[46px] justify-center font-mono"
            title="切换适应窗口 / 100%"
            @click="toggleFit"
          >
            {{ zoomPercent }}
          </button>
          <button type="button" class="ws-pv-icon-btn" title="放大" @click="zoomIn">
            <PlusOutlined />
          </button>
          <button
            v-if="zoom !== 'fit'"
            type="button"
            class="ws-pv-icon-btn"
            title="适应窗口"
            @click="zoom = 'fit'"
          >
            <ExpandOutlined />
          </button>
        </div>
      </div>
    </div>
  </div>

  <!-- Markdown preview -->
  <div v-else-if="kind === 'markdown'" class="flex-1 min-h-0 overflow-y-auto px-5 py-4 select-text">
    <TextBlock :content="textContent" :streaming="false" />
  </div>

  <!-- PDF preview -->
  <div v-else-if="kind === 'pdf'" class="flex-1 min-h-0 flex flex-col overflow-hidden bg-surface-2">
    <iframe
      v-if="fileInfo?.url"
      :src="fileInfo.url"
      :title="displayName"
      class="flex-1 w-full h-full border-0"
    />
  </div>

  <!-- Video preview (HTTP Range streaming) -->
  <div v-else-if="kind === 'video'" class="flex-1 min-h-0 flex flex-col overflow-hidden bg-[#0c0d10]">
    <div class="flex-1 min-h-0 flex items-center justify-center p-4 overflow-hidden">
      <div v-if="mediaError" class="ws-pv-state err">
        <span>{{ mediaError }}</span>
      </div>
      <video
        v-else-if="fileInfo?.url"
        :key="fileInfo.url"
        :src="fileInfo.url"
        controls
        playsinline
        preload="metadata"
        class="max-w-full max-h-full rounded-[6px] outline-none"
        @error="onMediaError('视频解码失败或当前浏览器不支持该编码格式')"
      />
    </div>
    <div v-if="formattedSize" class="flex-none flex items-center justify-between px-3 py-[6px] border-0 border-t border-solid border-line bg-surface-2 text-[11px] text-ink-3 font-mono">
      <span>{{ fileInfo?.mimeType }}</span>
      <span>{{ formattedSize }}</span>
    </div>
  </div>

  <!-- Audio preview (HTTP Range streaming) -->
  <div v-else-if="kind === 'audio'" class="flex-1 min-h-0 flex flex-col items-center justify-center p-6 gap-4">
    <div class="w-full max-w-[420px] rounded-[12px] border border-solid border-line bg-surface-2 p-5 flex flex-col items-center gap-3 shadow-sm">
      <div class="w-11 h-11 rounded-full bg-hover flex items-center justify-center text-[18px] text-ink-2">
        <AudioOutlined />
      </div>
      <div class="text-[13px] font-medium text-ink truncate max-w-full" :title="displayName">
        {{ displayName }}
      </div>
      <div v-if="formattedSize" class="text-[11px] text-ink-3 font-mono">
        {{ fileInfo?.mimeType }} · {{ formattedSize }}
      </div>
      <div v-if="mediaError" class="text-[12px] text-err text-center">
        {{ mediaError }}
      </div>
      <audio
        v-else-if="fileInfo?.url"
        :key="fileInfo.url"
        :src="fileInfo.url"
        controls
        preload="metadata"
        class="w-full mt-1"
        @error="onMediaError('音频解码失败或当前浏览器不支持该格式')"
      />
    </div>
  </div>
</template>

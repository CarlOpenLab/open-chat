<script setup lang="ts">
import { XProvider } from "@antdv-next/x";
import type { XProviderProps } from "@antdv-next/x";
import { computed, ref } from "vue";
import Chat from "./components/Chat.vue";
import { shadcnTheme } from "./theme/shadcnTheme";

const enUS: XProviderProps["locale"] = {
  locale: "en",
  Conversations: { create: "New Chat" },
  Sender: {
    stopLoading: "Stop Request",
    speechRecording: "Recording",
  },
  Actions: {
    feedbackLike: "Like",
    feedbackDislike: "Dislike",
    audio: "Play audio",
    audioRunning: "Audio playing",
    audioError: "Audio playback failed",
    audioLoading: "Loading audio",
  },
  Bubble: {
    editableOk: "OK",
    editableCancel: "Cancel",
  },
  Mermaid: {
    zoomIn: "Zoom in",
    zoomOut: "Zoom out",
    zoomReset: "Reset",
    download: "Download",
    code: "Code",
    image: "Image",
  },
  Folder: {
    selectFile: "Please select a file",
    loadError: "Failed to load file",
    noService: "File content service is not configured",
    loadFailed: "Failed to load file",
  },
};

const zhCN: XProviderProps["locale"] = {
  locale: "zh-cn",
  Conversations: { create: "新对话" },
  Sender: {
    stopLoading: "停止请求",
    speechRecording: "正在录音",
  },
  Actions: {
    feedbackLike: "喜欢",
    feedbackDislike: "不喜欢",
    audio: "播放语音",
    audioRunning: "语音播放中",
    audioError: "播放出错了",
    audioLoading: "正在加载语音",
  },
  Bubble: {
    editableOk: "确认",
    editableCancel: "取消",
  },
  Mermaid: {
    zoomIn: "放大",
    zoomOut: "缩小",
    zoomReset: "重置",
    download: "下载",
    code: "代码",
    image: "图片",
  },
  Folder: {
    selectFile: "请选择一个文件",
    loadError: "文件加载失败",
    noService: "未配置文件内容服务",
    loadFailed: "加载文件失败",
  },
};

const localeType = ref<"zh" | "en">("zh");

const locale = computed<XProviderProps["locale"]>(() => {
  return localeType.value === "zh" ? zhCN : enUS;
});
</script>

<template>
  <XProvider :theme="shadcnTheme" :locale="locale" layer>
    <Chat />
  </XProvider>
</template>

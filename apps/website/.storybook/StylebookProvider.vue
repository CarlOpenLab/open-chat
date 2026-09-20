<script setup lang="ts">
/**
 * Storybook 全局容器：复刻 src/main.ts 的运行环境（样式 + XProvider/ThemeProvider），
 * 让业务组件在独立调试时与真实 App 内渲染保持一致。
 */
import { ThemeProvider } from "antdv-style";
import { XProvider } from "@antdv-next/x";
import type { XProviderProps } from "@antdv-next/x";
import { computed } from "vue";
import { shadcnDarkTheme, shadcnTheme } from "../src/theme/shadcnTheme";
import "../src/style.css";
import "virtual:uno.css";
import "@antdv-next/x-markdown/themes/light.css";
import "@antdv-next/x-markdown/themes/dark.css";
import "@antdv-next/x-markdown/themes/index.css";

const props = defineProps<{ dark?: boolean }>();

// 与 App.vue 的 zhCN 保持一致（组件内文案来自 XProvider locale）
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
    loadFailed: "文件加载失败",
  },
};

const appTheme = computed(() => (props.dark ? shadcnDarkTheme : shadcnTheme));
</script>

<template>
  <XProvider :theme="appTheme" :locale="zhCN" layer>
    <ThemeProvider :appearance="dark ? 'dark' : 'light'">
      <!-- chat-app：brand CSS 变量（--brand-composer 等）定义在该类上，
           Storybook 没有 App.vue 的根节点，需手动补上才能拿到同一套色板 -->
      <div class="chat-app flex min-h-[100dvh] items-center justify-center bg-background p-6">
        <slot />
      </div>
    </ThemeProvider>
  </XProvider>
</template>

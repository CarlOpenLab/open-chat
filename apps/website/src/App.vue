<script setup lang="ts">
import { XProvider } from "@antdv-next/x";
import type { XProviderProps } from "@antdv-next/x";
import {
  computed,
  defineAsyncComponent,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import { shadcnDarkTheme, shadcnTheme } from "./theme/shadcnTheme";

const LandingPage = defineAsyncComponent(() => import("./pages/LandingPage.vue"));
const AuthPage = defineAsyncComponent(() => import("./pages/AuthPage.vue"));
const Chat = defineAsyncComponent(() => import("./components/Chat.vue"));

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
const route = ref(window.location.pathname);
const storedTheme = localStorage.getItem("open-chat-theme");
const dark = ref(
  storedTheme ? storedTheme === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches,
);

const locale = computed<XProviderProps["locale"]>(() => {
  return localeType.value === "zh" ? zhCN : enUS;
});
const appTheme = computed(() => (dark.value ? shadcnDarkTheme : shadcnTheme));
const currentPage = computed<"landing" | "auth" | "chat">(() => {
  if (route.value.startsWith("/auth")) return "auth";
  if (route.value.startsWith("/chat")) return "chat";
  return "landing";
});
const currentComponent = computed(() => {
  const pages = { landing: LandingPage, auth: AuthPage, chat: Chat };
  return pages[currentPage.value];
});
let focusTimer: ReturnType<typeof setTimeout> | undefined;

const focusMainContent = async () => {
  await nextTick();
  if (focusTimer) window.clearTimeout(focusTimer);
  const page = currentPage.value;
  const selector = { landing: "#main", auth: ".auth-page", chat: "#chat-content" }[page];
  let attempts = 0;
  const focusWhenReady = () => {
    if (currentPage.value !== page) return;
    const main = document.querySelector<HTMLElement>(selector);
    if (main) {
      if (!main.hasAttribute("tabindex")) main.tabIndex = -1;
      main.focus({ preventScroll: true });
      return;
    }
    attempts += 1;
    if (attempts < 40) focusTimer = window.setTimeout(focusWhenReady, 50);
  };
  focusWhenReady();
};

const syncRoute = () => {
  route.value = window.location.pathname;
  void focusMainContent();
};

const navigate = (path: string) => {
  if (window.location.pathname !== path) window.history.pushState({}, "", path);
  route.value = path;
  window.scrollTo({ top: 0, behavior: "auto" });
  void focusMainContent();
};

const toggleTheme = () => {
  dark.value = !dark.value;
};

watch(
  dark,
  (value) => {
    document.documentElement.dataset.theme = value ? "dark" : "light";
    localStorage.setItem("open-chat-theme", value ? "dark" : "light");
  },
  { immediate: true },
);

watch(
  currentPage,
  (page) => {
    const titles = {
      landing: "Open Chat · AI Chat Workspace",
      auth: "登录 · Open Chat",
      chat: "工作区 · Open Chat",
    };
    document.title = titles[page];
  },
  { immediate: true },
);

onMounted(() => window.addEventListener("popstate", syncRoute));
onBeforeUnmount(() => {
  window.removeEventListener("popstate", syncRoute);
  if (focusTimer) window.clearTimeout(focusTimer);
});
</script>

<template>
  <XProvider :theme="appTheme" :locale="locale" layer>
    <Suspense>
      <component
        :is="currentComponent"
        :dark="dark"
        @navigate="navigate"
        @toggle-theme="toggleTheme"
      />
      <template #fallback>
        <main class="route-loading" aria-busy="true" aria-label="页面加载中"><span></span></main>
      </template>
    </Suspense>
  </XProvider>
</template>

<style scoped>
.route-loading {
  display: grid;
  width: 100%;
  min-height: 100dvh;
  place-items: center;
  background: var(--background);
}
.route-loading span {
  width: 28px;
  height: 28px;
  border: 2px solid var(--border);
  border-top-color: var(--foreground);
  border-radius: 50%;
  animation: route-spin 700ms linear infinite;
}
@keyframes route-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>

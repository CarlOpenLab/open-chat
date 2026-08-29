<script setup lang="ts">
import { ThemeProvider } from "antdv-style";
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
import { ACCESS_REQUIRED_EVENT, setGatewayAccessGranted } from "./services/access";
import { shadcnDarkTheme, shadcnTheme } from "./theme/shadcnTheme";
import { Button, Input } from "antdv-next";
const Chat = defineAsyncComponent(() => import("./pages/WorkspacePage.vue"));
const CodeHighlightDemoPage = defineAsyncComponent(
  () => import("./pages/CodeHighlightDemoPage.vue"),
);

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
const getLocationPath = () => window.location.pathname + window.location.search;
const route = ref(getLocationPath());

// ============ 主题：跟随系统 / 浅色 / 深色 ============
type ThemeMode = "system" | "light" | "dark";

// 历史版本只存过 "dark" / "light"，其余值（含未设置）都按跟随系统处理
const storedTheme = localStorage.getItem("open-chat-theme");
const themeMode = ref<ThemeMode>(
  storedTheme === "dark" || storedTheme === "light" ? storedTheme : "system",
);
const systemDarkQuery = window.matchMedia("(prefers-color-scheme: dark)");
const systemDark = ref(systemDarkQuery.matches);
const handleSystemThemeChange = (event: MediaQueryListEvent) => {
  systemDark.value = event.matches;
};
const dark = computed(() =>
  themeMode.value === "system" ? systemDark.value : themeMode.value === "dark",
);

const locale = computed<XProviderProps["locale"]>(() => {
  return localeType.value === "zh" ? zhCN : enUS;
});
const appTheme = computed(() => (dark.value ? shadcnDarkTheme : shadcnTheme));
const currentPage = computed<"chat" | "code-highlight-demo">(() => {
  if (route.value.startsWith("/code-highlight-demo")) return "code-highlight-demo";
  return "chat";
});
const currentComponent = computed(() => {
  const pages = {
    chat: Chat,
    "code-highlight-demo": CodeHighlightDemoPage,
  };
  return pages[currentPage.value];
});
const accessReady = ref(false);
const accessGranted = ref(false);
const accessPassword = ref("");
const accessError = ref("");
const accessSubmitting = ref(false);

const checkAccess = async () => {
  try {
    const response = await fetch("/api/access/status");
    const data = (await response.json()) as { authorized?: boolean };
    accessGranted.value = data.authorized === true;
    setGatewayAccessGranted(accessGranted.value);
  } catch {
    // During a dev-server startup the gateway may still be coming up. Keep the
    // lock screen visible instead of rendering a partially usable app.
    accessGranted.value = false;
    setGatewayAccessGranted(false);
  } finally {
    accessReady.value = true;
  }
};

const submitAccessPassword = async () => {
  if (!accessPassword.value || accessSubmitting.value) return;
  accessSubmitting.value = true;
  accessError.value = "";
  try {
    const response = await fetch("/api/access/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: accessPassword.value }),
    });
    if (!response.ok) throw new Error("密码不正确，请从启动终端获取本次密码。");
    accessPassword.value = "";
    accessGranted.value = true;
    setGatewayAccessGranted(true);
  } catch (error) {
    accessError.value = error instanceof Error ? error.message : "登录失败，请重试。";
  } finally {
    accessSubmitting.value = false;
  }
};

const handleAccessRequired = () => {
  setGatewayAccessGranted(false);
  accessGranted.value = false;
  accessReady.value = true;
  accessPassword.value = "";
  accessError.value = "访问密码已失效，请输入终端中显示的本次密码。";
};
let focusTimer: ReturnType<typeof setTimeout> | undefined;

const focusMainContent = async () => {
  await nextTick();
  if (focusTimer) window.clearTimeout(focusTimer);
  const page = currentPage.value;
  const selector = {
    chat: "#chat-content",
    "code-highlight-demo": "#code-highlight-demo",
  }[page];
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
  route.value = getLocationPath();
  void focusMainContent();
};

const setThemeMode = (mode: ThemeMode) => {
  themeMode.value = mode;
};

// 命令面板等处的「切换主题」：从当前实际明暗翻转成显式模式
const toggleTheme = () => {
  themeMode.value = dark.value ? "light" : "dark";
};

watch(themeMode, (mode) => {
  localStorage.setItem("open-chat-theme", mode);
});

watch(
  dark,
  (value) => {
    document.documentElement.dataset.theme = value ? "dark" : "light";
  },
  { immediate: true },
);

watch(
  currentPage,
  (page) => {
    const titles = {
      chat: "Open Chat · AI CLI Workspace",
      "code-highlight-demo": "代码高亮 Demo · Open Chat",
    };
    document.title = titles[page];
  },
  { immediate: true },
);

onMounted(() => {
  window.addEventListener(ACCESS_REQUIRED_EVENT, handleAccessRequired);
  void checkAccess();
  window.addEventListener("popstate", syncRoute);
  systemDarkQuery.addEventListener("change", handleSystemThemeChange);
});
onBeforeUnmount(() => {
  window.removeEventListener(ACCESS_REQUIRED_EVENT, handleAccessRequired);
  window.removeEventListener("popstate", syncRoute);
  systemDarkQuery.removeEventListener("change", handleSystemThemeChange);
  if (focusTimer) window.clearTimeout(focusTimer);
});
</script>

<template>
  <XProvider :theme="appTheme" :locale="locale" layer>
    <ThemeProvider :appearance="dark ? 'dark' : 'light'">
      <main
        v-if="!accessReady || !accessGranted"
        class="grid min-h-[100dvh] place-items-center bg-background px-5"
        aria-live="polite"
      >
        <div
          v-if="accessReady"
          class="w-full max-w-sm rounded-xl border border-border bg-card p-6 shadow-sm"
        >
          <h1 class="m-0 text-xl font-semibold text-foreground">Open Chat</h1>
          <p class="mt-2 text-sm leading-6 text-muted-foreground">
            请输入启动 Open Chat 的终端中显示的本次访问密码。
          </p>
          <label class="mt-5 block text-sm font-medium text-foreground" for="access-password"
            >访问密码</label
          >
          <Input
            id="access-password"
            v-model:value="accessPassword"
            class="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-foreground outline-none focus:border-primary"
            type="password"
            autocomplete="current-password"
            autofocus
            :disabled="accessSubmitting"
          />
          <p v-if="accessError" class="mt-2 text-sm text-red-500">{{ accessError }}</p>
          <Button
            class="mt-5 w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
            :disabled="!accessPassword || accessSubmitting"
            @click="submitAccessPassword"
          >
            {{ accessSubmitting ? "验证中…" : "进入 Open Chat" }}
          </Button>
        </div>
        <span
          v-else
          class="h-7 w-7 animate-[spin_700ms_linear_infinite] rounded-full border-2 border-solid border-border border-t-foreground"
          aria-label="正在检查访问权限"
        ></span>
      </main>
      <Suspense v-else>
        <Transition name="route-fade" mode="out-in">
          <component
            :is="currentComponent"
            :key="currentPage"
            :dark="dark"
            v-bind="currentPage === 'chat' ? { themeMode } : {}"
            @toggle-theme="toggleTheme"
            @theme-mode-change="setThemeMode"
          />
        </Transition>
        <template #fallback>
          <main
            class="route-loading grid min-h-[100dvh] w-full place-items-center bg-background"
            aria-busy="true"
            aria-label="页面加载中"
          >
            <span
              class="h-7 w-7 animate-[spin_700ms_linear_infinite] rounded-full border-2 border-solid border-border border-t-foreground"
            ></span>
          </main>
        </template>
      </Suspense>
    </ThemeProvider>
  </XProvider>
</template>

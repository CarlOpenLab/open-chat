<script setup lang="ts">
import {
  ArrowLeft as ArrowLeftOutlined,
  Moon as MoonOutlined,
  Sun as SunOutlined,
} from "@lucide/vue";
import { Button, Segmented, message } from "antdv-next";
import { computed, ref } from "vue";
import AuthForm from "../components/auth/AuthForm.vue";
import AuthStory from "../components/auth/AuthStory.vue";

interface Props {
  dark: boolean;
}

interface Emits {
  (e: "navigate", path: string): void;
  (e: "toggleTheme"): void;
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

const mode = ref<"login" | "register">("login");

const isRegister = computed(() => mode.value === "register");
const heading = computed(() => (isRegister.value ? "创建 Open Chat 账户" : "登录 Open Chat"));
const description = computed(() =>
  isRegister.value ? "建立你的 AI 工作区，马上开始。" : "继续处理你的对话和工作。",
);
</script>

<template>
  <main
    class="auth-page grid h-[100dvh] min-h-[100dvh] grid-cols-[minmax(360px,0.92fr)_minmax(520px,1.08fr)] overflow-hidden bg-background text-[16px] text-foreground"
  >
    <a class="skip-link" href="#auth-form">跳到认证表单</a>

    <AuthStory @navigate="emit('navigate', $event)" />

    <section
      class="auth-panel flex h-full min-h-0 min-w-0 flex-col overflow-y-auto bg-background [scrollbar-gutter:stable]"
      aria-label="账户认证"
    >
      <header
        class="panel-toolbar sticky top-0 z-10 flex flex-none items-center justify-between bg-background px-[clamp(24px,5vw,80px)] py-[26px]"
      >
        <button
          class="back-link flex cursor-pointer items-center gap-2 border-0 bg-transparent px-0 py-2 text-[13px] text-muted-foreground transition-colors duration-150 hover:text-foreground"
          type="button"
          @click="emit('navigate', '/')"
        >
          <ArrowLeftOutlined /> 返回首页
        </button>
        <Button
          type="text"
          shape="circle"
          :aria-label="props.dark ? '切换浅色模式' : '切换深色模式'"
          @click="emit('toggleTheme')"
        >
          <SunOutlined v-if="props.dark" /><MoonOutlined v-else />
        </Button>
      </header>

      <div class="auth-content m-auto w-[min(100%_-_48px,420px)] px-0 pt-[38px] pb-[52px]">
        <div class="auth-heading mb-[26px]">
          <p
            class="mx-0 mt-0 mb-3 font-mono text-[11px] font-600 uppercase leading-[normal] text-muted-foreground"
          >
            {{ isRegister ? "创建工作区" : "欢迎回来" }}
          </p>
          <h2 class="m-0 text-[34px] leading-[1.15]">{{ heading }}</h2>
          <span class="mt-[10px] block text-[14px] text-muted-foreground">{{ description }}</span>
        </div>

        <Segmented
          v-model:value="mode"
          block
          :options="[
            { label: '登录', value: 'login' },
            { label: '注册', value: 'register' },
          ]"
          aria-label="认证方式"
        />

        <AuthForm :mode="mode" @navigate="emit('navigate', $event)" />

        <div
          class="mx-0 mt-[26px] mb-[18px] flex items-center gap-[14px] text-[11px] text-muted-foreground before:h-px before:flex-1 before:bg-border before:content-empty after:h-px after:flex-1 after:bg-border after:content-empty"
        >
          <span>或者</span>
        </div>
        <Button size="large" block class="min-h-12" @click="message.info('第三方认证服务尚未接入')">
          <span
            class="grid h-5 w-5 place-items-center text-[16px] font-700 leading-[normal] text-[#4285f4] [font-family:Arial,sans-serif]"
            >G</span
          >
          使用 Google 继续
        </Button>

        <p class="mx-0 mt-[22px] mb-0 text-center text-[13px] text-muted-foreground">
          {{ isRegister ? "已经有 Open Chat 账户？" : "还没有 Open Chat 账户？" }}
          <button
            class="min-h-[44px] cursor-pointer border-0 bg-transparent p-0 text-[13px] font-600 text-foreground hover:underline hover:underline-offset-3"
            type="button"
            @click="mode = isRegister ? 'login' : 'register'"
          >
            {{ isRegister ? "直接登录" : "创建账户" }}
          </button>
        </p>
      </div>

      <footer
        class="auth-footer flex items-center justify-between px-[clamp(24px,5vw,80px)] pt-6 pb-[30px] text-[11px] text-muted-foreground"
      >
        <span>© 2026 Open Chat</span>
        <span class="flex gap-[18px]"
          ><a class="text-inherit no-underline" href="#privacy">隐私</a
          ><a class="text-inherit no-underline" href="#terms">条款</a></span
        >
      </footer>
    </section>
  </main>
</template>

<style scoped>
/* :deep() 覆盖 antd 内部类，以及非常规断点（860/700/430px）覆盖，保留在 style 块中 */
.panel-toolbar :deep(.ant-btn) {
  width: 40px;
  min-width: 40px;
  height: 40px;
}
.auth-content > :deep(.ant-segmented) {
  margin-bottom: 26px;
  padding: 4px;
  border: 1px solid var(--border);
}
.auth-content > :deep(.ant-segmented-item) {
  min-height: 38px;
  line-height: 38px;
}

@media (max-width: 860px) {
  .auth-page {
    grid-template-columns: minmax(300px, 0.8fr) minmax(430px, 1.2fr);
  }
}
@media (max-width: 700px) {
  .auth-page {
    display: block;
    height: auto;
    overflow: visible;
  }
  .auth-panel {
    height: auto;
    min-height: 0;
    overflow: visible;
    scrollbar-gutter: auto;
  }
  .panel-toolbar {
    padding: 18px 20px;
  }
  .back-link,
  .panel-toolbar :deep(.ant-btn) {
    min-height: 44px;
  }
  .panel-toolbar :deep(.ant-btn) {
    width: 44px;
    min-width: 44px;
  }
  .auth-content {
    width: min(100% - 40px, 420px);
    margin: 0 auto;
    padding: 30px 0 44px;
  }
  .auth-footer {
    padding: 22px 20px 28px;
  }
  .auth-footer a {
    display: inline-flex;
    min-width: 44px;
    min-height: 44px;
    align-items: center;
    justify-content: center;
    padding-inline: 11px;
  }
}
@media (max-width: 430px) {
  .auth-content {
    width: calc(100% - 32px);
  }
  .auth-heading h2 {
    font-size: 30px;
  }
  .auth-footer {
    align-items: flex-start;
    flex-direction: column;
    gap: 8px;
  }
}
</style>

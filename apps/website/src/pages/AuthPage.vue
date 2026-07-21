<script setup lang="ts">
import {
  ArrowLeft as ArrowLeftOutlined,
  ArrowRight as ArrowRightOutlined,
  LockKeyhole as LockOutlined,
  Mail as MailOutlined,
  MessagesSquare as MessageOutlined,
  Moon as MoonOutlined,
  ShieldCheck as SafetyCertificateOutlined,
  Sparkles,
  Sun as SunOutlined,
  UserRound as UserOutlined,
} from "@lucide/vue";
import {
  Button,
  Checkbox,
  Form,
  FormItem,
  Input,
  InputPassword,
  Segmented,
  message,
} from "antdv-next";
import { computed, reactive, ref, watch } from "vue";

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
const submitting = ref(false);
const formRef = ref();
const form = reactive({
  name: "",
  email: "",
  password: "",
  remember: true,
  terms: false,
});

const isRegister = computed(() => mode.value === "register");
const heading = computed(() => (isRegister.value ? "创建 Open Chat 账户" : "登录 Open Chat"));
const description = computed(() =>
  isRegister.value ? "建立你的 AI 工作区，马上开始。" : "继续处理你的对话和工作。",
);

const rules = computed(() => ({
  name: isRegister.value ? [{ required: true, message: "请输入你的姓名", trigger: "blur" }] : [],
  email: [
    { required: true, message: "请输入邮箱地址", trigger: "blur" },
    { type: "email", message: "请输入有效的邮箱地址", trigger: ["blur", "change"] },
  ],
  password: [
    { required: true, message: "请输入密码", trigger: "blur" },
    { min: 8, message: "密码至少需要 8 个字符", trigger: "blur" },
  ],
  terms: isRegister.value
    ? [
        {
          validator: (_rule: unknown, value: boolean) =>
            value ? Promise.resolve() : Promise.reject(new Error("请先同意服务条款与隐私政策")),
          trigger: "change",
        },
      ]
    : [],
}));

watch(mode, () => {
  formRef.value?.clearValidate?.();
});

const submit = async () => {
  try {
    await formRef.value?.validate();
  } catch {
    return;
  }

  submitting.value = true;
  window.setTimeout(() => {
    submitting.value = false;
    message.success(isRegister.value ? "账户已创建" : "登录成功");
    emit("navigate", "/chat");
  }, 700);
};

const forgotPassword = () => {
  if (!/^\S+@\S+\.\S+$/.test(form.email)) {
    message.warning("先填写用于接收重置邮件的邮箱");
    return;
  }
  message.success("重置链接已发送到你的邮箱");
};
</script>

<template>
  <main class="auth-page">
    <a class="skip-link" href="#auth-form">跳到认证表单</a>

    <section class="auth-story" aria-label="Open Chat 产品介绍">
      <div class="story-topline">
        <button
          class="brand"
          type="button"
          aria-label="返回 Open Chat 首页"
          @click="emit('navigate', '/')"
        >
          <span class="brand-mark"><Sparkles /></span><span>Open Chat</span>
        </button>
        <span class="story-index">AUTH / 01</span>
      </div>

      <div class="story-main">
        <p class="story-kicker"><i></i> AI WORKSPACE</p>
        <h1>从一条消息开始，继续你的工作。</h1>
        <p>
          登录 Open Chat，回到你的对话、上下文和下一步。所有重要内容，都在同一个安静的工作区里。
        </p>
      </div>

      <div class="story-bottom">
        <div>
          <span><MessageOutlined /> 多会话工作区</span>
          <span><SafetyCertificateOutlined /> 数据存储在本地</span>
        </div>
        <p>Open Chat 让复杂工作保持清晰。</p>
      </div>
    </section>

    <section class="auth-panel" aria-label="账户认证">
      <header class="panel-toolbar">
        <button class="back-link" type="button" @click="emit('navigate', '/')">
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

      <div class="auth-content">
        <div class="auth-heading">
          <p>{{ isRegister ? "创建工作区" : "欢迎回来" }}</p>
          <h2>{{ heading }}</h2>
          <span>{{ description }}</span>
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

        <Form
          id="auth-form"
          ref="formRef"
          class="auth-form"
          :model="form"
          :rules="rules"
          layout="vertical"
          @finish="submit"
        >
          <FormItem v-if="isRegister" name="name" label="姓名">
            <Input
              v-model:value="form.name"
              size="large"
              autocomplete="name"
              aria-label="姓名"
              placeholder="你的姓名"
            >
              <template #prefix><UserOutlined /></template>
            </Input>
          </FormItem>

          <FormItem name="email" label="邮箱">
            <Input
              v-model:value="form.email"
              size="large"
              autocomplete="email"
              aria-label="邮箱"
              placeholder="you@example.com"
            >
              <template #prefix><MailOutlined /></template>
            </Input>
          </FormItem>

          <FormItem name="password">
            <template #label>
              <div class="password-label">
                <span>密码</span>
                <button v-if="!isRegister" type="button" @click="forgotPassword">忘记密码？</button>
              </div>
            </template>
            <InputPassword
              v-model:value="form.password"
              size="large"
              :autocomplete="isRegister ? 'new-password' : 'current-password'"
              aria-label="密码"
              placeholder="输入密码"
            >
              <template #prefix><LockOutlined /></template>
            </InputPassword>
          </FormItem>

          <FormItem v-if="isRegister" name="terms" class="check-item">
            <Checkbox v-model:checked="form.terms">
              我同意 <a href="#terms">服务条款</a> 与 <a href="#privacy">隐私政策</a>
            </Checkbox>
          </FormItem>
          <FormItem v-else class="check-item">
            <Checkbox v-model:checked="form.remember">在这台设备上保持登录</Checkbox>
          </FormItem>

          <Button type="primary" size="large" block html-type="submit" :loading="submitting">
            {{ isRegister ? "创建账户" : "登录" }} <ArrowRightOutlined />
          </Button>
        </Form>

        <div class="divider"><span>或者</span></div>
        <Button
          size="large"
          block
          class="github-button"
          @click="message.info('第三方认证服务尚未接入')"
        >
          <span class="provider-mark">G</span> 使用 Google 继续
        </Button>

        <p class="auth-switch">
          {{ isRegister ? "已经有 Open Chat 账户？" : "还没有 Open Chat 账户？" }}
          <button type="button" @click="mode = isRegister ? 'login' : 'register'">
            {{ isRegister ? "直接登录" : "创建账户" }}
          </button>
        </p>
      </div>

      <footer class="auth-footer">
        <span>© 2026 Open Chat</span>
        <span><a href="#privacy">隐私</a><a href="#terms">条款</a></span>
      </footer>
    </section>
  </main>
</template>

<style scoped>
.auth-page {
  display: grid;
  grid-template-columns: minmax(360px, 0.92fr) minmax(520px, 1.08fr);
  min-height: 100dvh;
  background: var(--background);
  color: var(--foreground);
  font-size: 16px;
}
.auth-story {
  position: relative;
  display: flex;
  min-height: 100dvh;
  flex-direction: column;
  justify-content: space-between;
  overflow: hidden;
  padding: 38px clamp(32px, 6vw, 96px) 44px;
  background: var(--background);
}
.auth-story::after {
  position: absolute;
  bottom: 7%;
  left: clamp(24px, 4vw, 64px);
  color: var(--muted);
  font-size: 132px;
  font-weight: 760;
  line-height: 0.72;
  content: "THREAD";
  pointer-events: none;
  user-select: none;
}
.auth-story > * {
  position: relative;
  z-index: 1;
}
.story-topline,
.story-bottom > div,
.panel-toolbar,
.auth-footer,
.password-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.brand {
  display: flex;
  min-height: 44px;
  align-items: center;
  gap: 10px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--foreground);
  font-weight: 650;
  cursor: pointer;
}
.brand-mark {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: 5px;
  background: var(--foreground);
  color: var(--background);
}
.brand-mark :deep(svg) {
  width: 16px;
  height: 16px;
}
.story-index {
  color: var(--muted-foreground);
  font:
    10px ui-monospace,
    monospace;
}
.story-main {
  max-width: 570px;
  margin: auto 0;
  padding: 72px 0;
}
.story-kicker {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 20px;
  color: var(--muted-foreground);
  font:
    600 11px ui-monospace,
    monospace;
}
.story-kicker i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--success);
  box-shadow: 0 0 0 3px var(--success-subtle);
}
.story-main h1 {
  margin: 0;
  font-size: 64px;
  font-weight: 680;
  line-height: 1.03;
  text-wrap: balance;
}
.story-main > p:last-child {
  max-width: 490px;
  margin: 26px 0 0;
  color: var(--muted-foreground);
  line-height: 1.8;
}
.story-bottom {
  max-width: 570px;
}
.story-bottom > div {
  justify-content: flex-start;
  flex-wrap: wrap;
  gap: 22px;
  font-size: 12px;
}
.story-bottom span {
  display: flex;
  align-items: center;
  gap: 8px;
}
.story-bottom :deep(svg) {
  color: var(--muted-foreground);
}
.story-bottom p {
  margin: 20px 0 0;
  color: var(--muted-foreground);
  font-size: 12px;
}
.auth-panel {
  display: flex;
  min-width: 0;
  min-height: 100dvh;
  flex-direction: column;
  background: var(--background);
}
.panel-toolbar {
  padding: 26px clamp(24px, 5vw, 80px);
}
.panel-toolbar :deep(.ant-btn) {
  width: 40px;
  min-width: 40px;
  height: 40px;
}
.back-link {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 0;
  border: 0;
  background: transparent;
  color: var(--muted-foreground);
  font-size: 13px;
  cursor: pointer;
  transition: color 150ms ease;
}
.back-link:hover {
  color: var(--foreground);
}
.auth-content {
  width: min(100% - 48px, 420px);
  margin: auto;
  padding: 38px 0 52px;
}
.auth-heading {
  margin-bottom: 26px;
}
.auth-heading > p {
  margin: 0 0 12px;
  color: var(--muted-foreground);
  font:
    600 11px ui-monospace,
    monospace;
  text-transform: uppercase;
}
.auth-heading h2 {
  margin: 0;
  font-size: 34px;
  line-height: 1.15;
}
.auth-heading > span {
  display: block;
  margin-top: 10px;
  color: var(--muted-foreground);
  font-size: 14px;
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
.auth-form :deep(.ant-form-item) {
  margin-bottom: 18px;
}
.auth-form :deep(.ant-form-item-label > label) {
  font-size: 13px;
  font-weight: 600;
}
.auth-form :deep(.ant-input-affix-wrapper) {
  min-height: 48px;
}
.auth-form :deep(.ant-input-prefix) {
  margin-inline-end: 10px;
  color: var(--muted-foreground);
}
.auth-form :deep(.ant-input) {
  font-size: 14px;
}
.password-label {
  width: 100%;
}
.password-label button {
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--muted-foreground);
  font-size: 12px;
  cursor: pointer;
}
.password-label button:hover {
  color: var(--foreground);
  text-decoration: underline;
  text-underline-offset: 3px;
}
.auth-form :deep(.check-item) {
  margin-top: -4px;
}
.check-item a {
  color: var(--foreground);
  text-decoration: underline;
  text-underline-offset: 3px;
}
.auth-form > :deep(.ant-btn) {
  min-height: 48px;
  margin-top: 2px;
}
.divider {
  display: flex;
  align-items: center;
  gap: 14px;
  margin: 26px 0 18px;
  color: var(--muted-foreground);
  font-size: 11px;
}
.divider::before,
.divider::after {
  height: 1px;
  flex: 1;
  background: var(--border);
  content: "";
}
.github-button {
  min-height: 48px;
}
.provider-mark {
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  color: #4285f4;
  font:
    700 16px Arial,
    sans-serif;
}
.auth-switch {
  margin: 22px 0 0;
  color: var(--muted-foreground);
  font-size: 13px;
  text-align: center;
}
.auth-switch button {
  min-height: 44px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--foreground);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.auth-switch button:hover {
  text-decoration: underline;
  text-underline-offset: 3px;
}
.auth-footer {
  padding: 24px clamp(24px, 5vw, 80px) 30px;
  color: var(--muted-foreground);
  font-size: 11px;
}
.auth-footer span:last-child {
  display: flex;
  gap: 18px;
}
.auth-footer a {
  color: inherit;
  text-decoration: none;
}

@media (max-width: 860px) {
  .auth-page {
    grid-template-columns: minmax(300px, 0.8fr) minmax(430px, 1.2fr);
  }
  .auth-story {
    padding-inline: 48px;
  }
  .auth-story::after {
    left: 38px;
    font-size: 104px;
  }
  .story-main h1 {
    font-size: 50px;
  }
}
@media (max-width: 700px) {
  .auth-page {
    display: block;
  }
  .auth-story {
    min-height: auto;
    padding: 22px 24px 28px;
    border-right: 0;
    background: var(--subtle);
  }
  .auth-story::after {
    right: 18px;
    bottom: 34px;
    left: auto;
    font-size: 72px;
  }
  .story-main {
    padding: 58px 0 46px;
  }
  .story-main h1 {
    max-width: 420px;
    font-size: 44px;
  }
  .story-main > p:last-child {
    margin-top: 18px;
    font-size: 14px;
  }
  .story-bottom {
    display: none;
  }
  .auth-panel {
    min-height: 0;
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
  .auth-form :deep(.ant-input) {
    font-size: 16px;
  }
  .password-label button {
    min-height: 44px;
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
  .auth-story {
    padding-inline: 20px;
  }
  .auth-story::after {
    right: 12px;
    bottom: 32px;
    font-size: 58px;
  }
  .story-main h1 {
    font-size: 40px;
  }
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

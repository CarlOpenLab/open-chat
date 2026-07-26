<script setup lang="ts">
import {
  ArrowRight as ArrowRightOutlined,
  LockKeyhole as LockOutlined,
  Mail as MailOutlined,
  UserRound as UserOutlined,
} from "@lucide/vue";
import { Button, Checkbox, Form, FormItem, Input, InputPassword, message } from "antdv-next";
import { computed, reactive, ref, watch } from "vue";

interface Props {
  mode: "login" | "register";
}

interface Emits {
  (e: "navigate", path: string): void;
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

const submitting = ref(false);
const formRef = ref();
const form = reactive({
  name: "",
  email: "",
  password: "",
  remember: true,
  terms: false,
});

const isRegister = computed(() => props.mode === "register");

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

watch(
  () => props.mode,
  () => {
    formRef.value?.clearValidate?.();
  },
);

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

    <FormItem name="password" class="password-item">
      <template #label>
        <div class="password-label w-full flex items-center justify-between">
          <span>密码</span>
          <button
            v-if="!isRegister"
            class="cursor-pointer border-0 bg-transparent p-0 text-[12px] text-muted-foreground hover:text-foreground hover:underline hover:underline-offset-3"
            type="button"
            @click="forgotPassword"
          >
            忘记密码？
          </button>
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
        我同意
        <a class="text-foreground underline underline-offset-3" href="#terms">服务条款</a> 与
        <a class="text-foreground underline underline-offset-3" href="#privacy">隐私政策</a>
      </Checkbox>
    </FormItem>
    <FormItem v-else class="check-item">
      <Checkbox v-model:checked="form.remember">在这台设备上保持登录</Checkbox>
    </FormItem>

    <Button type="primary" size="large" block html-type="submit" :loading="submitting">
      {{ isRegister ? "创建账户" : "登录" }} <ArrowRightOutlined />
    </Button>
  </Form>
</template>

<style scoped>
/* :deep() 覆盖 antd 内部类，以及非常规断点（700px）覆盖，保留在 style 块中 */
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
.auth-form :deep(.check-item) {
  margin-top: -4px;
}
.auth-form > :deep(.ant-btn) {
  min-height: 48px;
  margin-top: 2px;
}
.password-item :deep(.ant-form-item-required) {
  width: 100%;
}
.password-item :deep(.ant-form-item-required::after) {
  display: none;
}

@media (max-width: 700px) {
  .auth-form :deep(.ant-input) {
    font-size: 16px;
  }
  .password-label button {
    min-height: 44px;
  }
}
</style>

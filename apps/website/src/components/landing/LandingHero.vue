<script setup lang="ts">
import {
  ArrowDown as ArrowDownOutlined,
  Check as CheckOutlined,
  MessageCircle as MessageOutlined,
} from "@lucide/vue";
import { Button } from "antdv-next";
import LandingChatDemo from "./LandingChatDemo.vue";

interface Emits {
  (e: "navigate", path: string): void;
}

const emit = defineEmits<Emits>();

const go = (path: string) => emit("navigate", path);
const scrollToSection = (id: string) => {
  document.querySelector(`#${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
};
</script>

<template>
  <section id="top" class="hero relative overflow-hidden px-6 pb-[72px] pt-[138px]">
    <div class="hero-copy reveal relative z-1 mx-auto mb-[56px] max-w-[760px] text-center">
      <div
        class="eyebrow mx-auto mb-4 flex w-fit items-center gap-2 font-[ui-monospace,SFMono-Regular,Consolas,monospace] text-[11px] font-600 text-muted-foreground"
      >
        <i
          class="h-[7px] w-[7px] rounded-full bg-success shadow-[0_0_0_3px_var(--success-subtle)]"
        ></i>
        OPEN CHAT STARTER
      </div>
      <h1 class="m-0 text-[72px] font-720 leading-[0.98]">Open Chat</h1>
      <p
        class="mx-auto mb-0 mt-6 max-w-[660px] text-[19px] leading-[1.75] text-muted-foreground [text-wrap:balance]"
      >
        从一条消息开始，搭建完整的 AI 产品。多会话、模型切换、深度思考与流式回答，已经准备就绪。
      </p>
      <div class="hero-actions mt-[30px] flex flex-wrap justify-center gap-2.5">
        <Button type="primary" size="large" @click="go('/chat')">
          <MessageOutlined /> 立即体验
        </Button>
        <Button size="large" @click="scrollToSection('architecture')"
          >查看模板 <ArrowDownOutlined
        /></Button>
      </div>
      <div
        class="hero-meta mt-[22px] flex flex-wrap justify-center gap-[18px] text-[12px] text-muted-foreground"
      >
        <span class="flex items-center gap-1.5"><CheckOutlined /> antdv-next</span>
        <span class="flex items-center gap-1.5"><CheckOutlined /> shadcn tokens</span>
        <span class="flex items-center gap-1.5"><CheckOutlined /> 响应式</span>
      </div>
    </div>
    <LandingChatDemo id="demo" class="reveal relative z-2 mx-auto" />
  </section>
</template>

<style scoped>
/* antd 按钮内部覆盖（:deep）与非常规断点（760/430px）媒体查询，保留 */
.hero-actions :deep(.ant-btn) {
  min-height: 48px;
  padding-inline: 20px;
}

@media (max-width: 760px) {
  .hero {
    padding: 108px 12px 52px;
  }
  .hero h1 {
    font-size: 52px;
  }
  .hero-copy > p {
    font-size: 16px;
  }
  .hero-actions {
    flex-direction: column;
    max-width: 330px;
    margin-inline: auto;
    margin-top: 28px;
  }
  .hero .hero-actions :deep(.ant-btn) {
    width: 100%;
    min-height: 48px;
  }
}
@media (max-width: 430px) {
  .hero h1 {
    font-size: 46px;
  }
}
</style>

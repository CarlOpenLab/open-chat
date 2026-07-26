<script setup lang="ts">
import {
  MessagesSquare as MessageOutlined,
  ShieldCheck as SafetyCertificateOutlined,
  Sparkles,
} from "@lucide/vue";

interface Emits {
  (e: "navigate", path: string): void;
}

const emit = defineEmits<Emits>();
</script>

<template>
  <section
    class="auth-story relative flex h-full min-h-0 flex-col justify-between overflow-hidden bg-background px-[clamp(32px,6vw,96px)] pt-[38px] pb-[44px]"
    aria-label="Open Chat 产品介绍"
  >
    <div class="relative z-1 flex items-center justify-between">
      <button
        class="flex min-h-[44px] cursor-pointer items-center gap-[10px] border-0 bg-transparent p-0 font-650 text-foreground"
        type="button"
        aria-label="返回 Open Chat 首页"
        @click="emit('navigate', '/')"
      >
        <span
          class="grid h-[30px] w-[30px] place-items-center rounded-[5px] bg-foreground text-background"
          ><Sparkles /></span
        ><span>Open Chat</span>
      </button>
      <span class="font-mono text-[10px] leading-[normal] text-muted-foreground">AUTH / 01</span>
    </div>

    <div class="story-main relative z-1 mx-0 my-auto max-w-[570px] py-[72px]">
      <p
        class="mx-0 mt-0 mb-5 flex items-center gap-2 font-mono text-[11px] font-600 leading-[normal] text-muted-foreground"
      >
        <i
          class="h-[7px] w-[7px] rounded-full bg-success shadow-[0_0_0_3px_var(--success-subtle)]"
        ></i>
        AI WORKSPACE
      </p>
      <h1 class="m-0 text-balance text-[64px] font-680 leading-[1.03]">
        从一条消息开始，继续你的工作。
      </h1>
      <p class="mx-0 mt-[26px] mb-0 max-w-[490px] leading-[1.8] text-muted-foreground">
        登录 Open Chat，回到你的对话、上下文和下一步。所有重要内容，都在同一个安静的工作区里。
      </p>
    </div>

    <div class="story-bottom relative z-1 max-w-[570px]">
      <div class="flex flex-wrap items-center gap-[22px] text-[12px]">
        <span class="flex items-center gap-2"
          ><MessageOutlined class="text-muted-foreground" /> 多会话工作区</span
        >
        <span class="flex items-center gap-2"
          ><SafetyCertificateOutlined class="text-muted-foreground" /> 数据存储在本地</span
        >
      </div>
      <p class="mx-0 mt-5 mb-0 text-[12px] text-muted-foreground">Open Chat 让复杂工作保持清晰。</p>
    </div>
  </section>
</template>

<style scoped>
/* 装饰性伪元素及其非常规断点（860/700/430px）覆盖，保留在 style 块中 */
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

@media (max-width: 860px) {
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
  .auth-story {
    height: auto;
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
}
</style>

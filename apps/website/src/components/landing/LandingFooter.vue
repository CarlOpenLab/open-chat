<script setup lang="ts">
import { Sparkles } from "@lucide/vue";

interface Emits {
  (e: "navigate", path: string): void;
}

const emit = defineEmits<Emits>();

const go = (path: string) => emit("navigate", path);
</script>

<template>
  <footer class="site-footer border-0 border-t-1 border-solid border-border">
    <div
      class="section-inner mx-auto grid min-h-[110px] w-[min(1160px,calc(100%-48px))] grid-cols-[1fr_auto_1fr] items-center"
    >
      <a
        class="brand inline-flex min-h-11 w-fit items-center gap-2.5 font-650 text-foreground no-underline"
        href="#top"
        ><span
          class="brand-mark grid h-[30px] w-[30px] place-items-center rounded-[5px] bg-foreground text-background"
          ><Sparkles class="h-4 w-4" /></span
        ><span>Open Chat</span></a
      >
      <p class="text-[12px] text-muted-foreground">AI Chat workspace starter.</p>
      <nav class="flex justify-self-end gap-[22px]">
        <a class="text-[12px] text-muted-foreground no-underline" href="#features">功能</a
        ><a class="text-[12px] text-muted-foreground no-underline" href="#pricing">版本</a
        ><a class="text-[12px] text-muted-foreground no-underline" href="#faq">FAQ</a
        ><button
          class="cursor-pointer border-0 bg-transparent p-0 text-[12px] text-muted-foreground"
          type="button"
          @click="go('/auth')"
        >
          登录
        </button>
      </nav>
    </div>
  </footer>
</template>

<style scoped>
/* 非常规断点（760px）媒体查询，保留 */
@media (max-width: 760px) {
  .section-inner {
    width: calc(100% - 32px);
  }
  .site-footer > div {
    grid-template-columns: 1fr;
    justify-items: start;
    gap: 12px;
    padding: 28px 0;
  }
  .site-footer nav {
    justify-self: start;
  }
  .site-footer nav a,
  .site-footer nav button {
    display: inline-flex;
    min-width: 44px;
    min-height: 44px;
    align-items: center;
    justify-content: center;
    padding-inline: 10px;
  }
}
</style>

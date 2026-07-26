<script setup lang="ts">
import { ArrowRight as ArrowRightOutlined } from "@lucide/vue";
import { Button } from "antdv-next";

interface Emits {
  (e: "navigate", path: string): void;
}

const emit = defineEmits<Emits>();

const go = (path: string) => emit("navigate", path);
</script>

<template>
  <section
    class="final-cta border-y-1 border-y-solid border-y-border bg-muted text-foreground transition-[background-color,border-color,color] duration-200 ease-[ease]"
  >
    <div
      class="section-inner reveal mx-auto flex min-h-[360px] w-[min(1160px,calc(100%-48px))] flex-col items-start justify-center gap-[30px]"
    >
      <div>
        <p
          class="section-kicker m-0 mb-4 flex w-fit items-center gap-2 font-[ui-monospace,SFMono-Regular,Consolas,monospace] text-[11px] font-600 text-muted-foreground"
        >
          OPEN CHAT
        </p>
        <h2 class="m-0 max-w-[700px] text-[46px] font-680 leading-[1.14] [text-wrap:balance]">
          下一条消息，可能就是产品的开始。
        </h2>
      </div>
      <Button
        size="large"
        class="inverse-button self-start !border-foreground !bg-foreground !text-background"
        @click="go('/chat')"
        >立即体验 <ArrowRightOutlined
      /></Button>
    </div>
  </section>
</template>

<style scoped>
/* 非常规断点（760px）媒体查询，保留 */
@media (max-width: 760px) {
  .section-inner {
    width: calc(100% - 32px);
  }
  .final-cta h2 {
    font-size: 32px;
  }
  .final-cta > div {
    min-height: 400px;
    gap: 32px;
  }
  .final-cta .inverse-button {
    width: 100%;
    justify-content: center;
  }
}
</style>

<script setup lang="ts">
import {
  ArrowRight as ArrowRightOutlined,
  GitBranch as BranchesOutlined,
  LayoutGrid as AppstoreOutlined,
  Wrench as ToolOutlined,
  Zap as ThunderboltOutlined,
} from "@lucide/vue";

interface Emits {
  (e: "navigate", path: string): void;
}

const emit = defineEmits<Emits>();

const go = (path: string) => emit("navigate", path);
</script>

<template>
  <section
    id="architecture"
    class="section architecture-section border-y-1 border-y-solid border-y-border bg-subtle py-[120px]"
  >
    <div
      class="section-inner architecture-grid mx-auto grid w-[min(1160px,calc(100%-48px))] grid-cols-[0.85fr_1.15fr] items-start gap-24"
    >
      <div class="architecture-copy reveal sticky top-28">
        <p
          class="section-kicker m-0 mb-4 flex w-fit items-center gap-2 font-[ui-monospace,SFMono-Regular,Consolas,monospace] text-[11px] font-600 text-muted-foreground"
        >
          STARTER ARCHITECTURE
        </p>
        <h2 class="m-0 text-[42px] font-680 leading-[1.14] [text-wrap:balance]">
          界面、状态和请求层都可以继续扩展。
        </h2>
        <p class="mb-0 mt-[18px] max-w-[500px] leading-[1.75] text-muted-foreground">
          保留品牌空间，同时缩短从原型到可用产品的距离。
        </p>
        <button
          class="text-link mt-[26px] flex cursor-pointer items-center gap-2 border-0 border-b-1 border-solid border-foreground bg-transparent p-0 pb-1 font-600 text-foreground"
          type="button"
          @click="go('/chat')"
        >
          打开工作区 <ArrowRightOutlined />
        </button>
      </div>
      <div class="architecture-list reveal border-0 border-t-1 border-solid border-border">
        <div
          class="grid min-h-[132px] grid-cols-[34px_minmax(0,1fr)_32px] items-center gap-[18px] border-0 border-b-1 border-solid border-border"
        >
          <span
            class="self-start pt-7 font-[ui-monospace,monospace] text-[10px] text-muted-foreground"
            >01</span
          >
          <section>
            <strong class="text-[16px]">Chat shell</strong>
            <p class="mb-0 mt-1.5 text-[13px] text-muted-foreground">
              响应式侧栏、会话列表、消息流与输入区。
            </p>
          </section>
          <AppstoreOutlined class="text-muted-foreground" />
        </div>
        <div
          class="grid min-h-[132px] grid-cols-[34px_minmax(0,1fr)_32px] items-center gap-[18px] border-0 border-b-1 border-solid border-border"
        >
          <span
            class="self-start pt-7 font-[ui-monospace,monospace] text-[10px] text-muted-foreground"
            >02</span
          >
          <section>
            <strong class="text-[16px]">Interaction states</strong>
            <p class="mb-0 mt-1.5 text-[13px] text-muted-foreground">
              空状态、流式生成、错误、停止与重试。
            </p>
          </section>
          <ThunderboltOutlined class="text-muted-foreground" />
        </div>
        <div
          class="grid min-h-[132px] grid-cols-[34px_minmax(0,1fr)_32px] items-center gap-[18px] border-0 border-b-1 border-solid border-border"
        >
          <span
            class="self-start pt-7 font-[ui-monospace,monospace] text-[10px] text-muted-foreground"
            >03</span
          >
          <section>
            <strong class="text-[16px]">Theme tokens</strong>
            <p class="mb-0 mt-1.5 text-[13px] text-muted-foreground">
              antdv-next 组件与 shadcn Zinc 语义变量。
            </p>
          </section>
          <ToolOutlined class="text-muted-foreground" />
        </div>
        <div
          class="grid min-h-[132px] grid-cols-[34px_minmax(0,1fr)_32px] items-center gap-[18px] border-0 border-b-1 border-solid border-border"
        >
          <span
            class="self-start pt-7 font-[ui-monospace,monospace] text-[10px] text-muted-foreground"
            >04</span
          >
          <section>
            <strong class="text-[16px]">Provider gateway</strong>
            <p class="mb-0 mt-1.5 text-[13px] text-muted-foreground">
              统一管理模型配置与 OpenAI-like 请求。
            </p>
          </section>
          <BranchesOutlined class="text-muted-foreground" />
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
/* 非常规断点（900/760px）媒体查询，保留 */
@media (max-width: 900px) {
  .architecture-grid {
    gap: 54px;
  }
}
@media (max-width: 760px) {
  .section-inner {
    width: calc(100% - 32px);
  }
  .section {
    padding: 80px 0;
  }
  .architecture-copy h2 {
    font-size: 32px;
  }
  .architecture-grid {
    grid-template-columns: 1fr;
  }
  .architecture-copy {
    position: static;
  }
  .text-link {
    min-height: 44px;
  }
}
</style>

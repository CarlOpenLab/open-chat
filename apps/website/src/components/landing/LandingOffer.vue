<script setup lang="ts">
import {
  ArrowRight as ArrowRightOutlined,
  Check as CheckOutlined,
  Code2 as CodeOutlined,
  GitBranch as BranchesOutlined,
  LayoutGrid as AppstoreOutlined,
  Wrench as ToolOutlined,
  Zap as ThunderboltOutlined,
} from "@lucide/vue";
import { Button } from "antdv-next";

interface Emits {
  (e: "navigate", path: string): void;
}

const emit = defineEmits<Emits>();

const go = (path: string) => emit("navigate", path);
</script>

<template>
  <section id="pricing" class="section offer-section bg-subtle py-[120px]">
    <div class="section-inner mx-auto w-[min(1160px,calc(100%-48px))]">
      <div class="offer-intro reveal mb-12 grid grid-cols-[0.9fr_1.1fr] items-end gap-20">
        <div>
          <p
            class="section-kicker m-0 mb-4 flex w-fit items-center gap-2 font-[ui-monospace,SFMono-Regular,Consolas,monospace] text-[11px] font-600 text-muted-foreground"
          >
            READY TO BUILD
          </p>
          <h2 class="m-0 text-[42px] font-680 leading-[1.14] [text-wrap:balance]">
            把基础交互交给模板。
          </h2>
        </div>
        <p class="m-0 leading-[1.8] text-muted-foreground">
          从可运行的 Chat
          出发，把时间留给模型接入与业务逻辑。当前仓库已经覆盖请求、流式渲染与本地会话。
        </p>
      </div>
      <div
        class="workbench reveal grid min-h-[550px] grid-cols-[1.04fr_0.96fr] overflow-hidden rounded-t-lg border-1 border-b-0 border-solid border-border bg-background text-foreground shadow-xl transition-[background-color,border-color,color] duration-200 ease-[ease]"
      >
        <article class="workbench-copy flex flex-col gap-[34px] px-12 py-11">
          <div
            class="workbench-status flex justify-between font-[ui-monospace,monospace] text-[10px] text-muted-foreground"
          >
            <span>OPEN CHAT</span
            ><span class="flex items-center gap-[7px]"
              ><i class="h-1.5 w-1.5 rounded-full bg-success"></i> AVAILABLE</span
            >
          </div>
          <div>
            <small class="text-muted-foreground">Production-ready foundation</small>
            <h3 class="mb-0 mt-2.5 text-[34px]">开源 AI 工作区</h3>
            <p class="mb-0 mt-3 max-w-[500px] text-[14px] leading-[1.75] text-muted-foreground">
              直接配置模型网关，不必重新搭建 Chat 产品的基础体验。
            </p>
          </div>
          <ul
            class="m-0 grid list-none grid-cols-2 border-0 border-t-1 border-solid border-border p-0"
          >
            <li
              class="grid min-h-[88px] grid-cols-[24px_minmax(0,1fr)] items-center gap-2.5 border-0 border-b-1 border-solid border-border text-muted-foreground odd:border-r-1 even:pl-4"
            >
              <AppstoreOutlined /><span class="flex flex-col"
                ><strong class="text-[12px] text-foreground">完整会话架构</strong
                ><small class="text-[9px]">多会话与本地持久化</small></span
              >
            </li>
            <li
              class="grid min-h-[88px] grid-cols-[24px_minmax(0,1fr)] items-center gap-2.5 border-0 border-b-1 border-solid border-border text-muted-foreground odd:border-r-1 even:pl-4"
            >
              <BranchesOutlined /><span class="flex flex-col"
                ><strong class="text-[12px] text-foreground">模型接入层</strong
                ><small class="text-[9px]">统一 Provider 与配置</small></span
              >
            </li>
            <li
              class="grid min-h-[88px] grid-cols-[24px_minmax(0,1fr)] items-center gap-2.5 border-0 border-b-1 border-solid border-border text-muted-foreground odd:border-r-1 even:pl-4"
            >
              <ThunderboltOutlined /><span class="flex flex-col"
                ><strong class="text-[12px] text-foreground">流式状态覆盖</strong
                ><small class="text-[9px]">生成、停止、错误与重试</small></span
              >
            </li>
            <li
              class="grid min-h-[88px] grid-cols-[24px_minmax(0,1fr)] items-center gap-2.5 border-0 border-b-1 border-solid border-border text-muted-foreground odd:border-r-1 even:pl-4"
            >
              <ToolOutlined /><span class="flex flex-col"
                ><strong class="text-[12px] text-foreground">shadcn 主题</strong
                ><small class="text-[9px]">语义 tokens 与明暗模式</small></span
              >
            </li>
          </ul>
          <Button
            size="large"
            class="inverse-button self-start !border-foreground !bg-foreground !text-background"
            @click="go('/chat')"
            >开始对话 <ArrowRightOutlined
          /></Button>
        </article>
        <section
          class="manifest my-4 ml-0 mr-4 overflow-hidden rounded-md border-1 border-solid border-border bg-subtle transition-[background-color,border-color] duration-200 ease-[ease]"
          aria-label="项目能力清单"
        >
          <header
            class="flex h-12 items-center justify-between border-0 border-b-1 border-solid border-border px-[18px] font-[ui-monospace,monospace] text-[10px] leading-normal text-muted-foreground"
          >
            <span class="flex items-center gap-2"><CodeOutlined /> open-chat.config.ts</span
            ><b class="font-500 text-success">ready</b>
          </header>
          <pre
            class="m-0 min-h-[238px] overflow-x-auto border-0 border-b-1 border-solid border-border px-[26px] py-8 font-[ui-monospace,monospace] text-[12px] leading-[2] text-foreground"
          ><code><span class="text-muted-foreground">export default</span> defineOpenChat({
  model: <b class="font-500 text-foreground">"your-provider"</b>,
  streaming: <b class="font-500 text-foreground">true</b>,
  markdown: <b class="font-500 text-foreground">true</b>,
  theme: <b class="font-500 text-foreground">"shadcn"</b>
})</code></pre>
          <div
            class="mx-[18px] grid min-h-11 grid-cols-[28px_minmax(0,1fr)_18px] items-center border-0 border-b-1 border-solid border-border text-success"
          >
            <span
              class="font-[ui-monospace,monospace] text-[9px] leading-normal text-muted-foreground"
              >01</span
            ><strong
              class="font-[ui-monospace,monospace] text-[10px] font-500 leading-normal text-muted-foreground"
              >chat-shell</strong
            ><CheckOutlined />
          </div>
          <div
            class="mx-[18px] grid min-h-11 grid-cols-[28px_minmax(0,1fr)_18px] items-center border-0 border-b-1 border-solid border-border text-success"
          >
            <span
              class="font-[ui-monospace,monospace] text-[9px] leading-normal text-muted-foreground"
              >02</span
            ><strong
              class="font-[ui-monospace,monospace] text-[10px] font-500 leading-normal text-muted-foreground"
              >message-stream</strong
            ><CheckOutlined />
          </div>
          <div
            class="mx-[18px] grid min-h-11 grid-cols-[28px_minmax(0,1fr)_18px] items-center border-0 border-b-1 border-solid border-border text-success"
          >
            <span
              class="font-[ui-monospace,monospace] text-[9px] leading-normal text-muted-foreground"
              >03</span
            ><strong
              class="font-[ui-monospace,monospace] text-[10px] font-500 leading-normal text-muted-foreground"
              >local-storage</strong
            ><CheckOutlined />
          </div>
          <div
            class="mx-[18px] grid min-h-11 grid-cols-[28px_minmax(0,1fr)_18px] items-center border-0 border-b-1 border-solid border-border text-success"
          >
            <span
              class="font-[ui-monospace,monospace] text-[9px] leading-normal text-muted-foreground"
              >04</span
            ><strong
              class="font-[ui-monospace,monospace] text-[10px] font-500 leading-normal text-muted-foreground"
              >theme-tokens</strong
            ><CheckOutlined />
          </div>
        </section>
      </div>
      <div
        class="starter-strip reveal flex min-h-[90px] items-center justify-between gap-[30px] rounded-b-lg border-1 border-t-0 border-solid border-border bg-background px-6 py-[18px] shadow-lg"
      >
        <div class="flex min-w-0 items-center gap-3.5">
          <span
            class="starter-play grid h-10 w-10 flex-[0_0_40px] place-items-center rounded-[5px] border-1 border-solid border-border bg-subtle"
            ><ArrowRightOutlined class="h-[15px] w-[15px]" /></span
          ><span class="flex min-w-0 flex-col"
            ><strong class="text-[13px]">先从在线体验开始</strong
            ><small class="mt-0.5 text-[11px] text-muted-foreground"
              >无需注册，直接测试会话、模型切换与流式回答。</small
            ></span
          >
        </div>
        <Button @click="go('/chat')">打开 Chat 工作区 <ArrowRightOutlined /></Button>
      </div>
    </div>
  </section>
</template>

<style scoped>
/* antd 按钮内部覆盖（:deep）与非常规断点（760/430px）媒体查询，保留 */
@media (max-width: 760px) {
  .section-inner {
    width: calc(100% - 32px);
  }
  .section {
    padding: 80px 0;
  }
  .offer-intro h2 {
    font-size: 32px;
  }
  .offer-intro {
    grid-template-columns: 1fr;
    align-items: start;
    gap: 18px;
  }
  .workbench {
    grid-template-columns: 1fr;
  }
  .workbench-copy {
    padding: 34px 28px;
  }
  .manifest {
    margin: 0 16px 16px;
  }
  .starter-strip {
    align-items: stretch;
    flex-direction: column;
    padding: 20px;
  }
  .starter-strip :deep(.ant-btn) {
    width: 100%;
  }
}
@media (max-width: 430px) {
  .workbench-copy {
    padding: 28px 22px;
  }
  .workbench-copy ul {
    grid-template-columns: 1fr;
  }
  .workbench-copy li:nth-child(odd) {
    border-right: 0;
  }
  .workbench-copy li:nth-child(even) {
    padding-left: 0;
  }
  .manifest {
    margin-inline: 10px;
  }
  .manifest pre {
    padding: 24px 18px;
    font-size: 10px;
  }
}
</style>

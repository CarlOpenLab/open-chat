<script setup lang="ts">
import {
  Bot as RobotOutlined,
  Check as CheckOutlined,
  Code2 as CodeOutlined,
  FileText as FileTextOutlined,
  GitBranch as BranchesOutlined,
  Globe2 as GlobalOutlined,
  Lightbulb as BulbOutlined,
  MessageCircle as MessageOutlined,
  Paperclip as PaperClipOutlined,
  Zap as ThunderboltOutlined,
} from "@lucide/vue";
</script>

<template>
  <section id="features" class="section feature-section py-[120px]">
    <div class="section-inner mx-auto w-[min(1160px,calc(100%-48px))]">
      <div class="section-heading reveal mx-auto mb-[56px] max-w-[720px] text-center">
        <p
          class="section-kicker m-0 mx-auto mb-4 flex w-fit items-center gap-2 font-[ui-monospace,SFMono-Regular,Consolas,monospace] text-[11px] font-600 text-muted-foreground"
        >
          完整交互
        </p>
        <h2 class="m-0 text-[42px] font-680 leading-[1.14] [text-wrap:balance]">
          不只是一个输入框。
        </h2>
        <p class="mx-auto mb-0 mt-4 max-w-[580px] leading-[1.75] text-muted-foreground">
          从会话组织到答案渲染，覆盖用户对现代 AI 助手的核心预期。
        </p>
      </div>

      <div
        class="feature-grid grid grid-cols-2 border-0 border-l-1 border-t-1 border-solid border-border"
      >
        <article
          class="feature feature-wide reveal relative grid min-h-[380px] grid-cols-[0.85fr_1.15fr] items-center gap-[30px] overflow-hidden border-0 border-b-1 border-r-1 border-solid border-border p-[34px]"
        >
          <div>
            <span
              class="feature-index mb-5 block font-[ui-monospace,monospace] text-[11px] text-muted-foreground"
              >01</span
            >
            <h3 class="m-0 text-[22px] leading-[1.25]">多会话工作区</h3>
            <p class="mb-0 mt-3 max-w-[410px] text-[14px] leading-[1.75] text-muted-foreground">
              历史记录、草稿状态与本地持久化保持在同一个清晰的侧边栏中。
            </p>
          </div>
          <div
            class="sidebar-visual min-h-[270px] w-[88%] translate-y-[34px] self-end justify-self-end rounded-t-[7px] border-1 border-b-0 border-solid border-border bg-subtle px-4 py-5 shadow-lg"
            aria-hidden="true"
          >
            <div class="mb-[26px] flex h-8 items-center gap-[9px] rounded">
              <span class="visual-logo h-[18px] w-[18px] rounded bg-foreground"></span
              ><b class="h-1.5 w-[64%] rounded-[3px] bg-border"></b>
            </div>
            <div
              class="visual-new mb-3.5 flex h-8 items-center gap-[9px] rounded border-1 border-solid border-border bg-background px-2"
            >
              <i class="h-3 w-3 border-1 border-solid border-muted-foreground"></i
              ><b class="h-1.5 w-[64%] rounded-[3px] bg-border"></b>
            </div>
            <div
              class="visual-line flex h-8 items-center gap-[9px] rounded bg-muted px-2 text-foreground"
            >
              <MessageOutlined /><b class="h-1.5 w-[64%] rounded-[3px] bg-border"></b>
            </div>
            <div
              class="visual-line flex h-8 items-center gap-[9px] rounded px-2 text-muted-foreground"
            >
              <MessageOutlined /><b class="h-1.5 w-[64%] rounded-[3px] bg-border"></b>
            </div>
            <div
              class="visual-line flex h-8 items-center gap-[9px] rounded px-2 text-muted-foreground"
            >
              <MessageOutlined /><b class="h-1.5 w-[64%] rounded-[3px] bg-border"></b>
            </div>
          </div>
        </article>

        <article
          class="feature reveal relative min-h-[380px] overflow-hidden border-0 border-b-1 border-r-1 border-solid border-border p-[34px]"
        >
          <span
            class="feature-icon mb-10 grid h-[42px] w-[42px] place-items-center rounded-md border-1 border-solid border-border shadow-sm"
            ><BranchesOutlined class="h-[var(--icon-lg)] w-[var(--icon-lg)]"
          /></span>
          <span
            class="feature-index mb-5 block font-[ui-monospace,monospace] text-[11px] text-muted-foreground"
            >02</span
          >
          <h3 class="m-0 text-[22px] leading-[1.25]">模型自由切换</h3>
          <p class="mb-0 mt-3 max-w-[410px] text-[14px] leading-[1.75] text-muted-foreground">
            通过服务端 Provider 配置，为快速回答和深度推理选择不同模型。
          </p>
          <div
            class="model-visual mx-auto mt-11 w-[80%] -rotate-2 rounded-[7px] border-1 border-solid border-border bg-background p-1.5 shadow-lg"
            aria-hidden="true"
          >
            <span
              class="grid min-h-10 grid-cols-[20px_1fr_auto] items-center gap-2 rounded bg-muted px-[9px] text-[11px] text-foreground"
              ><RobotOutlined /> Qwen Plus <CheckOutlined
            /></span>
            <span
              class="grid min-h-10 grid-cols-[20px_1fr_auto] items-center gap-2 rounded px-[9px] text-[11px] text-muted-foreground"
              ><BulbOutlined /> Reasoner</span
            >
            <span
              class="grid min-h-10 grid-cols-[20px_1fr_auto] items-center gap-2 rounded px-[9px] text-[11px] text-muted-foreground"
              ><ThunderboltOutlined /> Mini</span
            >
          </div>
        </article>

        <article
          class="feature reveal relative min-h-[380px] overflow-hidden border-0 border-b-1 border-r-1 border-solid border-border p-[34px]"
        >
          <span
            class="feature-icon mb-10 grid h-[42px] w-[42px] place-items-center rounded-md border-1 border-solid border-border shadow-sm"
            ><PaperClipOutlined class="h-[var(--icon-lg)] w-[var(--icon-lg)]"
          /></span>
          <span
            class="feature-index mb-5 block font-[ui-monospace,monospace] text-[11px] text-muted-foreground"
            >03</span
          >
          <h3 class="m-0 text-[22px] leading-[1.25]">复杂内容清晰呈现</h3>
          <p class="mb-0 mt-3 max-w-[410px] text-[14px] leading-[1.75] text-muted-foreground">
            Markdown、代码块、Mermaid 图表与思考过程都有适合阅读的呈现方式。
          </p>
          <div class="context-visual mt-11 grid grid-cols-2 gap-2" aria-hidden="true">
            <span
              class="grid grid-cols-[30px_minmax(0,1fr)] grid-rows-[auto_auto] items-center rounded-md border-1 border-solid border-border bg-subtle p-[11px]"
              ><FileTextOutlined class="[grid-row:1/3]" /><b
                class="overflow-hidden text-ellipsis whitespace-nowrap text-[10px]"
                >release-plan.md</b
              ><small
                class="overflow-hidden text-ellipsis whitespace-nowrap text-[9px] text-muted-foreground"
                >Markdown</small
              ></span
            >
            <span
              class="grid grid-cols-[30px_minmax(0,1fr)] grid-rows-[auto_auto] items-center rounded-md border-1 border-solid border-border bg-subtle p-[11px]"
              ><GlobalOutlined class="[grid-row:1/3]" /><b
                class="overflow-hidden text-ellipsis whitespace-nowrap text-[10px]"
                >Mermaid</b
              ><small
                class="overflow-hidden text-ellipsis whitespace-nowrap text-[9px] text-muted-foreground"
                >可视化</small
              ></span
            >
          </div>
        </article>

        <article
          class="feature feature-wide code-feature reveal relative grid min-h-[380px] grid-cols-[0.85fr_1.15fr] items-center gap-[30px] overflow-hidden border-0 border-b-1 border-r-1 border-solid border-border p-[34px]"
        >
          <div>
            <span
              class="feature-index mb-5 block font-[ui-monospace,monospace] text-[11px] text-muted-foreground"
              >04</span
            >
            <h3 class="m-0 text-[22px] leading-[1.25]">从模板继续开发</h3>
            <p class="mb-0 mt-3 max-w-[410px] text-[14px] leading-[1.75] text-muted-foreground">
              请求层、聊天状态和展示组件边界清晰，可以直接接入自己的业务能力。
            </p>
          </div>
          <div
            class="code-visual overflow-hidden rounded-[7px] border-1 border-solid border-border bg-subtle text-foreground shadow-lg transition-[background-color,border-color,color] duration-200 ease-[ease]"
          >
            <header
              class="flex h-[38px] items-center justify-between border-0 border-b-1 border-solid border-border px-3 text-[10px] text-muted-foreground"
            >
              <span class="flex items-center gap-[7px]"><CodeOutlined /> provider.ts</span
              ><span class="flex items-center gap-[7px]">ready</span>
            </header>
            <pre
              class="m-0 overflow-x-auto px-5 py-6 font-[ui-monospace,monospace] text-[11px] leading-[1.9]"
            ><code><span class="text-muted-foreground">const</span> provider = createProvider({
  model: <b class="font-500 text-foreground">"your-model"</b>,
  stream: <b class="font-500 text-foreground">true</b>,
})</code></pre>
          </div>
        </article>
      </div>
    </div>
  </section>
</template>

<style scoped>
/* 非常规断点（900/760/430px）媒体查询，保留 */
@media (max-width: 900px) {
  .feature-wide {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 760px) {
  .section-inner {
    width: calc(100% - 32px);
  }
  .section {
    padding: 80px 0;
  }
  .section-heading h2 {
    font-size: 32px;
  }
  .feature-grid {
    grid-template-columns: 1fr;
  }
  .feature {
    min-height: 340px;
    padding: 26px;
  }
  .feature-wide {
    min-height: 470px;
  }
}
@media (max-width: 430px) {
  .context-visual {
    grid-template-columns: 1fr;
  }
}
</style>

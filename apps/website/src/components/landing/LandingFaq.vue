<script setup lang="ts">
import { Collapse, CollapsePanel } from "antdv-next";
</script>

<template>
  <section id="faq" class="section faq-section py-[120px]">
    <div
      class="section-inner faq-grid mx-auto grid w-[min(1160px,calc(100%-48px))] grid-cols-[0.65fr_1.35fr] gap-[90px]"
    >
      <div class="reveal">
        <p
          class="section-kicker m-0 mb-4 flex w-fit items-center gap-2 font-[ui-monospace,SFMono-Regular,Consolas,monospace] text-[11px] font-600 text-muted-foreground"
        >
          FAQ
        </p>
        <h2 class="m-0 text-[42px] font-680 leading-[1.14] [text-wrap:balance]">常见问题</h2>
      </div>
      <Collapse class="reveal" ghost accordion>
        <CollapsePanel key="1" header="Open Chat 是完整的 AI 应用吗？">
          它是一套可运行的 AI Chat 工作区，已经具备模型请求、流式回答、Markdown
          渲染和会话持久化，认证服务可以按项目接入。
        </CollapsePanel>
        <CollapsePanel key="2" header="可以替换成自己的模型和品牌吗？">
          可以。模型由服务端配置管理，界面颜色、字体、圆角和组件状态都使用语义 token 组织。
        </CollapsePanel>
        <CollapsePanel key="3" header="支持移动端和深色模式吗？">
          支持。落地页、登录页和 Chat 工作区都使用响应式布局，并共享同一套 Zinc 明暗主题。
        </CollapsePanel>
      </Collapse>
    </div>
  </section>
</template>

<style scoped>
/* antd Collapse 内部类覆盖（:deep）与非常规断点（760px）媒体查询，保留 */
.faq-grid :deep(.ant-collapse) {
  border-top: 1px solid var(--border);
}
.faq-grid :deep(.ant-collapse-header) {
  align-items: center !important;
  min-height: 76px;
  padding-inline: 0 !important;
  font-weight: 600;
}
.faq-grid :deep(.ant-collapse-content-box) {
  padding: 0 0 24px !important;
  color: var(--muted-foreground);
  line-height: 1.75;
}

@media (max-width: 760px) {
  .section-inner {
    width: calc(100% - 32px);
  }
  .section {
    padding: 80px 0;
  }
  .faq-grid h2 {
    font-size: 32px;
  }
  .faq-grid {
    grid-template-columns: 1fr;
    gap: 44px;
  }
}
</style>

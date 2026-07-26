<script setup lang="ts">
import {
  FileText as FileTextOutlined,
  LayoutGrid as AppstoreOutlined,
  ShieldCheck as SafetyCertificateOutlined,
  Zap as ThunderboltOutlined,
} from "@lucide/vue";
</script>

<template>
  <section
    class="proof-strip border-y-1 border-y-solid border-y-border bg-subtle"
    aria-label="产品能力"
  >
    <div
      class="section-inner proof-inner mx-auto flex min-h-[74px] w-[min(1160px,calc(100%-48px))] items-center justify-between gap-6"
    >
      <span class="text-[12px] font-600 text-muted-foreground">为真实 AI 产品准备</span>
      <div class="flex flex-wrap gap-7">
        <span class="flex items-center gap-2 text-[12px]"
          ><AppstoreOutlined class="text-muted-foreground" /> 多模型</span
        >
        <span class="flex items-center gap-2 text-[12px]"
          ><ThunderboltOutlined class="text-muted-foreground" /> 流式输出</span
        >
        <span class="flex items-center gap-2 text-[12px]"
          ><FileTextOutlined class="text-muted-foreground" /> Markdown</span
        >
        <span class="flex items-center gap-2 text-[12px]"
          ><SafetyCertificateOutlined class="text-muted-foreground" /> 本地持久化</span
        >
      </div>
    </div>
  </section>
</template>

<style scoped>
/* 非常规断点（760/430px）媒体查询，保留 */
@media (max-width: 760px) {
  .section-inner {
    width: calc(100% - 32px);
  }
  .proof-inner {
    align-items: flex-start;
    flex-direction: column;
    padding: 18px 0;
  }
  .proof-inner > div {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    width: 100%;
    gap: 12px;
  }
}
@media (max-width: 430px) {
  .proof-inner > div {
    grid-template-columns: 1fr;
  }
}
</style>

<script setup lang="ts">
import { Check, Sparkles } from "@lucide/vue";

type DemoMessage = {
  id: number;
  role: "user" | "assistant";
  content: string;
  pending?: boolean;
};

defineProps<{
  message: DemoMessage;
}>();
</script>

<template>
  <div
    class="demo-message mb-[22px] w-[min(100%,780px)]"
    :class="
      message.role === 'user'
        ? 'user flex justify-end'
        : 'grid grid-cols-[30px_minmax(0,1fr)] items-start gap-[12px]'
    "
  >
    <span
      v-if="message.role === 'assistant'"
      class="grid h-[30px] w-[30px] place-items-center rounded-md border border-solid border-brand-primary bg-brand-primary text-brand-primary-foreground shadow-brand-xs"
      title="Open Chat"
    >
      <Sparkles class="!h-[15px] !w-[15px]" />
    </span>

    <div
      :class="
        message.role === 'user'
          ? 'max-w-[min(76%,620px)] rounded-[7px_7px_2px] bg-brand-surface-subtle px-[14px] py-[11px] text-[13px] leading-[1.7] text-brand-foreground'
          : 'min-w-0 text-[13px] leading-[1.7] text-brand-foreground'
      "
    >
      <div
        v-if="message.pending && !message.content"
        class="typing flex h-6 items-center gap-1"
        aria-label="正在生成"
      >
        <i class="h-[5px] w-[5px] rounded-full bg-brand-muted"></i>
        <i class="h-[5px] w-[5px] rounded-full bg-brand-muted"></i>
        <i class="h-[5px] w-[5px] rounded-full bg-brand-muted"></i>
      </div>
      <p v-else class="m-0 [overflow-wrap:anywhere]">{{ message.content }}</p>

      <div
        v-if="message.id === 2 && !message.pending"
        class="task-list mt-3 overflow-hidden rounded-md border border-solid border-brand-border"
      >
        <div
          class="grid min-h-[47px] grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-[9px] border-b border-solid border-brand-border px-[10px] py-[6px]"
        >
          <Check
            class="!h-4 !w-4 rounded border border-solid border-brand-primary bg-brand-primary text-brand-primary-foreground"
          />
          <span class="flex min-w-0 flex-col">
            <strong class="truncate text-[12px]">P0 · 数据迁移演练</strong>
            <small class="truncate text-[10px] text-brand-muted">后端 · 周二前完成回滚验证</small>
          </span>
          <b
            class="rounded-[3px] bg-danger-subtle px-[6px] py-[2px] text-[9px] font-500 text-danger"
            >高风险</b
          >
        </div>
        <div
          class="grid min-h-[47px] grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-[9px] border-b border-solid border-brand-border px-[10px] py-[6px]"
        >
          <i class="grid h-4 w-4 place-items-center rounded border border-solid border-input"></i>
          <span class="flex min-w-0 flex-col">
            <strong class="truncate text-[12px]">P0 · 监控与告警校验</strong>
            <small class="truncate text-[10px] text-brand-muted">SRE · 覆盖核心转化链路</small>
          </span>
          <b
            class="rounded-[3px] bg-danger-subtle px-[6px] py-[2px] text-[9px] font-500 text-danger"
            >高风险</b
          >
        </div>
        <div
          class="grid min-h-[47px] grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-[9px] px-[10px] py-[6px]"
        >
          <i class="grid h-4 w-4 place-items-center rounded border border-solid border-input"></i>
          <span class="flex min-w-0 flex-col">
            <strong class="truncate text-[12px]">P1 · 发布说明确认</strong>
            <small class="truncate text-[10px] text-brand-muted">产品 · 周四完成最终审核</small>
          </span>
          <b
            class="rounded-[3px] bg-brand-surface-subtle px-[6px] py-[2px] text-[9px] font-500 text-brand-muted"
            >常规</b
          >
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.typing i {
  animation: demo-typing 1s ease-in-out infinite;
}
.typing i:nth-child(2) {
  animation-delay: 120ms;
}
.typing i:nth-child(3) {
  animation-delay: 240ms;
}

@keyframes demo-typing {
  0%,
  60%,
  100% {
    opacity: 0.35;
    transform: translateY(0);
  }
  30% {
    opacity: 1;
    transform: translateY(-3px);
  }
}

@media (max-width: 760px) {
  .demo-message.user > div {
    max-width: 88%;
  }
}

@media (max-width: 430px) {
  .task-list > div {
    grid-template-columns: 18px minmax(0, 1fr);
  }
  .task-list b {
    display: none;
  }
}
</style>

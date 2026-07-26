<script setup lang="ts">
import { Check as CheckOutlined, Sparkles as RobotOutlined } from "@lucide/vue";

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
    class="demo-message w-[min(100%,700px)] mx-auto mb-[22px]"
    :class="
      message.role === 'user'
        ? 'user flex justify-end'
        : 'grid grid-cols-[26px_minmax(0,1fr)] gap-2.5'
    "
  >
    <div
      v-if="message.role === 'assistant'"
      class="grid place-items-center w-[25px] h-[25px] rounded-[5px] bg-foreground text-background text-[13px]"
    >
      <RobotOutlined class="w-[var(--icon-sm)] h-[var(--icon-sm)]" />
    </div>
    <div>
      <div v-if="message.role === 'assistant'" class="flex items-center gap-[7px] mt-0.5 mb-2">
        <strong class="text-[11px]">Open Chat</strong
        ><span
          class="py-[1px] px-[5px] border border-border rounded-[3px] text-muted-foreground text-[8px]"
          >AI 助手</span
        >
      </div>
      <div
        v-if="message.pending && !message.content"
        class="typing flex items-center gap-1 h-6"
        aria-label="正在生成"
      >
        <i class="w-[5px] h-[5px] rounded-full bg-muted-foreground"></i
        ><i class="w-[5px] h-[5px] rounded-full bg-muted-foreground"></i
        ><i class="w-[5px] h-[5px] rounded-full bg-muted-foreground"></i>
      </div>
      <p
        v-else
        :class="
          message.role === 'user'
            ? 'm-0 max-w-[70%] py-2.5 px-[13px] rounded-[7px] rounded-br-[2px] bg-muted text-[11px] leading-[1.55]'
            : 'mt-0 mx-0 mb-3 text-[11px] leading-[1.65]'
        "
      >
        {{ message.content }}
      </p>
      <div
        v-if="message.id === 2"
        class="task-list overflow-hidden border border-border rounded-md"
      >
        <div
          class="grid grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-[9px] min-h-[47px] py-1.5 px-2.5 border-b border-border"
        >
          <CheckOutlined
            class="w-4 h-4 border border-foreground rounded bg-foreground text-background"
          /><span class="flex min-w-0 flex-col"
            ><strong class="truncate text-[10px]">P0 · 数据迁移演练</strong
            ><small class="truncate text-muted-foreground text-[9px]"
              >后端 · 周二前完成回滚验证</small
            ></span
          ><b class="py-0.5 px-1.5 rounded-[3px] bg-danger-subtle text-danger text-[8px] font-500"
            >高风险</b
          >
        </div>
        <div
          class="grid grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-[9px] min-h-[47px] py-1.5 px-2.5 border-b border-border"
        >
          <i class="grid place-items-center w-4 h-4 border border-input rounded"></i
          ><span class="flex min-w-0 flex-col"
            ><strong class="truncate text-[10px]">P0 · 监控与告警校验</strong
            ><small class="truncate text-muted-foreground text-[9px]"
              >SRE · 覆盖核心转化链路</small
            ></span
          ><b class="py-0.5 px-1.5 rounded-[3px] bg-danger-subtle text-danger text-[8px] font-500"
            >高风险</b
          >
        </div>
        <div
          class="grid grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-[9px] min-h-[47px] py-1.5 px-2.5"
        >
          <i class="grid place-items-center w-4 h-4 border border-input rounded"></i
          ><span class="flex min-w-0 flex-col"
            ><strong class="truncate text-[10px]">P1 · 发布说明确认</strong
            ><small class="truncate text-muted-foreground text-[9px]"
              >产品 · 周四完成最终审核</small
            ></span
          ><b class="py-0.5 px-1.5 rounded-[3px] bg-muted text-muted-foreground text-[8px] font-500"
            >常规</b
          >
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 打字机动画，保留在 style 块 */
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

/* 非常规断点（760px / 430px），保留在 style 块 */
@media (max-width: 760px) {
  .demo-message.user p {
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

<script setup lang="ts">
import {
  LockKeyhole,
  PanelLeftOpen as MenuUnfoldOutlined,
  Share2 as ShareAltOutlined,
} from "@lucide/vue";
import { Sender } from "@antdv-next/x";
import { Button, Select, Tooltip } from "antdv-next";
import { computed, nextTick, onBeforeUnmount, ref } from "vue";
import LandingDemoMessage from "./LandingDemoMessage.vue";
import LandingDemoSidebar from "./LandingDemoSidebar.vue";

type DemoMessage = {
  id: number;
  role: "user" | "assistant";
  content: string;
  pending?: boolean;
};

const conversations = [
  { key: "launch", label: "产品发布计划", updated: "刚刚更新" },
  { key: "research", label: "市场研究摘要", updated: "12 分钟前" },
  { key: "code", label: "重构登录组件", updated: "今天 14:20" },
  { key: "notes", label: "会议记录整理", updated: "昨天" },
];

const activeKey = ref("launch");
const sidebarOpen = ref(true);
const content = ref("");
const sending = ref(false);
const messagesEl = ref<HTMLElement>();
let responseTimer: ReturnType<typeof setInterval> | undefined;

const activeConversation = computed(
  () => conversations.find((item) => item.key === activeKey.value) ?? conversations[0],
);

const initialMessages = (): DemoMessage[] => [
  {
    id: 1,
    role: "user",
    content: "帮我把下周的产品发布计划整理成一份可执行的清单，优先处理上线风险。",
  },
  {
    id: 2,
    role: "assistant",
    content: "我会先按风险优先级拆解，并把每项工作压缩成明确的负责人和验收条件。",
  },
];

const messages = ref<DemoMessage[]>(initialMessages());

const selectConversation = (key: string) => {
  activeKey.value = key;
  messages.value = initialMessages();
  if (window.matchMedia("(max-width: 760px)").matches) sidebarOpen.value = false;
};

const startNewConversation = () => {
  activeKey.value = "";
  messages.value = [{ id: Date.now(), role: "assistant", content: "今天想一起完成什么？" }];
  content.value = "";
};

const scrollToBottom = async () => {
  await nextTick();
  if (messagesEl.value) messagesEl.value.scrollTop = messagesEl.value.scrollHeight;
};

const responseFor = (prompt: string) => {
  if (prompt.includes("回滚")) {
    return "回滚方案建议覆盖触发阈值、决策人、数据兼容和恢复验证四部分。先为核心链路设定可量化的停止条件。";
  }
  if (prompt.includes("时间线")) {
    return "可以。我会按周一到发布日排列关键节点，并把依赖项放在每个节点下方，方便团队直接检查进度。";
  }
  return "收到。我会先明确目标与约束，再给出可执行清单，并标注需要你确认的决策点。";
};

const submit = (value: string) => {
  const prompt = value.trim();
  if (!prompt || sending.value) return;

  messages.value.push({ id: Date.now(), role: "user", content: prompt });
  const pendingId = Date.now() + 1;
  messages.value.push({ id: pendingId, role: "assistant", content: "", pending: true });
  content.value = "";
  sending.value = true;
  void scrollToBottom();

  const response = responseFor(prompt);
  let index = 0;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  responseTimer = setInterval(
    () => {
      index = Math.min(index + (reducedMotion ? response.length : 2), response.length);
      const pending = messages.value.find((item) => item.id === pendingId);
      if (pending) {
        pending.content = response.slice(0, index);
        pending.pending = index < response.length;
      }
      void scrollToBottom();
      if (index >= response.length) {
        if (responseTimer) clearInterval(responseTimer);
        responseTimer = undefined;
        sending.value = false;
      }
    },
    reducedMotion ? 1 : 24,
  );
};

onBeforeUnmount(() => {
  if (responseTimer) clearInterval(responseTimer);
});
</script>

<template>
  <div
    class="demo-window w-[min(1240px,100%)] h-[min(680px,calc(100dvh-154px))] min-h-[570px] overflow-hidden border border-border rounded-lg bg-background shadow-xl"
    aria-label="Open Chat 交互演示"
  >
    <div
      class="window-bar grid grid-cols-[1fr_auto_1fr] items-center h-[42px] px-3 border-b border-border bg-subtle"
    >
      <div class="window-controls flex items-center gap-1.5" aria-hidden="true">
        <i class="w-[9px] h-[9px] rounded-full bg-border-strong"></i
        ><i class="w-[9px] h-[9px] rounded-full bg-border-strong"></i
        ><i class="w-[9px] h-[9px] rounded-full bg-border-strong"></i>
      </div>
      <div
        class="window-address flex items-center gap-[7px] h-[26px] px-3.5 border border-border rounded-[5px] bg-background text-muted-foreground text-[11px]"
      >
        <LockKeyhole class="w-[11px] h-[11px]" /> openchat.dev/chat
      </div>
      <div class="window-actions flex items-center justify-self-end gap-1">
        <span class="live-status flex items-center gap-1.5 text-muted-foreground text-[11px]"
          ><i class="w-1.5 h-1.5 rounded-full bg-success"></i> Live</span
        >
        <Tooltip title="分享对话">
          <Button type="text" shape="circle" aria-label="分享对话"
            ><ShareAltOutlined class="w-[var(--icon-sm)] h-[var(--icon-sm)]"
          /></Button>
        </Tooltip>
      </div>
    </div>

    <div
      class="demo-app grid h-[calc(100%-42px)] [transition:grid-template-columns_180ms_ease]"
      :class="
        sidebarOpen
          ? 'grid-cols-[238px_minmax(0,1fr)]'
          : 'sidebar-hidden grid-cols-[0_minmax(0,1fr)]'
      "
    >
      <LandingDemoSidebar
        :conversations="conversations"
        :active-key="activeKey"
        @select="selectConversation"
        @new-chat="startNewConversation"
        @close="sidebarOpen = false"
      />

      <section class="grid min-w-0 grid-rows-[54px_minmax(0,1fr)_auto_auto] bg-background">
        <header
          class="demo-chat-header flex items-center justify-between gap-3 px-4 border-b border-border"
        >
          <div class="chat-heading flex items-center min-w-0 gap-1.5">
            <Tooltip v-if="!sidebarOpen" title="展开侧栏">
              <Button type="text" shape="circle" aria-label="展开侧栏" @click="sidebarOpen = true">
                <MenuUnfoldOutlined class="w-[var(--icon-sm)] h-[var(--icon-sm)]" />
              </Button>
            </Tooltip>
            <div class="flex min-w-0 flex-col">
              <strong class="truncate text-xs">{{ activeConversation?.label || "新对话" }}</strong>
              <span class="text-muted-foreground text-[9px]">{{
                activeConversation?.updated || "未保存"
              }}</span>
            </div>
          </div>
          <Select
            default-value="Open Chat 4o"
            aria-label="选择 AI 模型"
            :options="[
              { value: 'Open Chat 4o', label: 'Open Chat 4o' },
              { value: 'Open Chat Reasoner', label: 'Reasoner' },
              { value: 'Open Chat Mini', label: 'Mini' },
            ]"
          />
        </header>

        <div
          ref="messagesEl"
          class="demo-messages min-h-0 overflow-y-auto pt-7 px-[clamp(20px,7%,80px)] pb-3.5"
          aria-live="polite"
        >
          <LandingDemoMessage v-for="item in messages" :key="item.id" :message="item" />
        </div>

        <div
          class="suggestions flex gap-1.5 w-[min(calc(100%-40px),700px)] mx-auto mb-[7px] overflow-x-auto [scrollbar-width:none]"
        >
          <button
            type="button"
            class="flex-none h-7 px-[9px] border border-border rounded-[5px] bg-background text-muted-foreground text-[9px] cursor-pointer transition-colors duration-150 hover:bg-muted hover:text-foreground"
            @click="content = '把它转换成时间线'"
          >
            转换成时间线
          </button>
          <button
            type="button"
            class="flex-none h-7 px-[9px] border border-border rounded-[5px] bg-background text-muted-foreground text-[9px] cursor-pointer transition-colors duration-150 hover:bg-muted hover:text-foreground"
            @click="content = '补充发布回滚方案'"
          >
            补充回滚方案
          </button>
          <button
            type="button"
            class="flex-none h-7 px-[9px] border border-border rounded-[5px] bg-background text-muted-foreground text-[9px] cursor-pointer transition-colors duration-150 hover:bg-muted hover:text-foreground"
            @click="content = '导出为 Markdown'"
          >
            导出 Markdown
          </button>
        </div>

        <div class="demo-composer w-[min(calc(100%-40px),700px)] mx-auto">
          <Sender
            :value="content"
            :loading="sending"
            placeholder="向 Open Chat 发送消息"
            @change="content = $event"
            @submit="submit"
          />
          <p class="mt-[5px] mb-2 text-muted-foreground text-[8px] text-center">
            Open Chat 可能会出错，请核查重要信息。
          </p>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
/* :deep() 覆盖第三方组件（antd Button / Select、Sender）内部类 */
.window-actions :deep(.ant-btn) {
  width: 32px;
  min-width: 32px;
  height: 32px;
}
.demo-chat-header :deep(.ant-select) {
  width: 142px;
  font-size: 11px;
}
.demo-chat-header :deep(.ant-select-selector) {
  border-radius: 5px;
}
.demo-composer :deep(.antd-sender-main) {
  border-radius: 7px;
  box-shadow: var(--shadow-lg);
}
.demo-composer :deep(textarea) {
  font-size: 11px;
}

/* 非常规断点（761px / 760px / 430px），保留在 style 块 */
@media (min-width: 761px) {
  .demo-app.sidebar-hidden :deep(.demo-sidebar) {
    padding-right: 0;
    padding-left: 0;
    border-right-color: transparent;
  }
}

@media (max-width: 760px) {
  .demo-window {
    height: 660px;
    min-height: 0;
  }
  .window-bar {
    height: 48px;
    grid-template-columns: 1fr auto;
  }
  .window-controls {
    display: none;
  }
  .window-actions :deep(.ant-btn),
  .chat-heading :deep(.ant-btn) {
    width: 44px;
    min-width: 44px;
    height: 44px;
  }
  .window-address {
    justify-self: start;
  }
  .demo-app {
    position: relative;
    height: calc(100% - 48px);
    grid-template-columns: minmax(0, 1fr);
  }
  .demo-app :deep(.demo-sidebar) {
    position: absolute;
    z-index: 4;
    inset: 0 auto 0 0;
    width: min(270px, 82%);
    box-shadow: 12px 0 30px rgba(9, 9, 11, 0.16);
    transform: translateX(0);
    transition: transform 180ms ease;
  }
  .demo-app.sidebar-hidden :deep(.demo-sidebar) {
    transform: translateX(-105%);
  }
  .demo-chat-header {
    padding: 0 8px;
  }
  .demo-chat-header :deep(.ant-select-selector) {
    min-height: 44px;
    align-items: center;
  }
  .demo-messages {
    padding: 22px 14px 12px;
  }
  .suggestions {
    width: calc(100% - 24px);
  }
  .suggestions button {
    min-height: 44px;
  }
  .demo-composer {
    width: calc(100% - 24px);
  }
  .demo-composer :deep(.antd-sender-actions-btn) {
    width: 44px;
    min-width: 44px;
    height: 44px;
  }
}

@media (max-width: 430px) {
  .live-status {
    display: none;
  }
  .demo-chat-header :deep(.ant-select) {
    width: 116px;
  }
}
</style>

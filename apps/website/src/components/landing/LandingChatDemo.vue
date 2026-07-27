<script setup lang="ts">
import { Sender } from "@antdv-next/x";
import {
  AudioLines,
  ChevronDown,
  Cloud,
  GitBranch,
  Lightbulb,
  LockKeyhole,
  PanelLeftOpen,
  SlidersHorizontal,
  Sparkles,
  Square,
} from "@lucide/vue";
import { Button, Dropdown, Tooltip, type MenuProps } from "antdv-next";
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
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

const models = [
  { key: "gpt-5.5", label: "gpt-5.5" },
  { key: "claude-sonnet", label: "claude-sonnet" },
  { key: "open-chat-mini", label: "Open Chat Mini" },
];

const activeKey = ref("launch");
const sidebarOpen = ref(true);
const content = ref("");
const sending = ref(false);
const currentModel = ref(models[0].key);
const messagesEl = ref<HTMLElement>();
let responseTimer: ReturnType<typeof setInterval> | undefined;

const activeConversation = computed(() =>
  activeKey.value ? conversations.find((item) => item.key === activeKey.value) : undefined,
);
const currentModelLabel = computed(
  () => models.find((item) => item.key === currentModel.value)?.label ?? models[0].label,
);
const modelMenu = computed<MenuProps>(() => ({
  items: models.map((item) => ({ key: item.key, label: item.label })),
  selectedKeys: [currentModel.value],
  onClick: ({ key }) => {
    currentModel.value = String(key);
  },
}));

const starterPrompts = [
  {
    key: "ticket-branch",
    label: "生成工单分支",
    description: "填写工单 ID 和项目名称，生成 Git 分支",
    prompt: "帮我生成一个工单分支命名方案。",
  },
  {
    key: "placeholder-idea",
    label: "梳理一个想法",
    description: "快速整理目标、边界和下一步",
    prompt: "帮我把这个想法整理成目标、范围和下一步行动。",
  },
  {
    key: "placeholder-review",
    label: "检查一段内容",
    description: "发现问题并给出简洁建议",
    prompt: "帮我检查这段发布计划，指出最需要改进的三个地方。",
  },
];

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
const showStarterPrompts = computed(() => messages.value.length === 0 && !sending.value);

const selectConversation = (key: string) => {
  activeKey.value = key;
  messages.value = initialMessages();
  if (window.matchMedia("(max-width: 760px)").matches) sidebarOpen.value = false;
};

const startNewConversation = () => {
  activeKey.value = "";
  messages.value = [];
  content.value = "";
  if (window.matchMedia("(max-width: 760px)").matches) sidebarOpen.value = false;
};

const scrollToBottom = async () => {
  await nextTick();
  if (messagesEl.value) messagesEl.value.scrollTop = messagesEl.value.scrollHeight;
};

const responseFor = (prompt: string) => {
  if (prompt.includes("回滚")) {
    return "回滚方案建议覆盖触发阈值、决策人、数据兼容和恢复验证四部分。先为核心链路设定可量化的停止条件。";
  }
  if (prompt.includes("时间线") || prompt.includes("工单分支")) {
    return "可以。我会先明确命名规则、环境前缀和负责人，再给出可直接复制的分支名与下一步。";
  }
  if (prompt.includes("想法") || prompt.includes("检查")) {
    return "收到。我会先明确目标与边界，再给出可执行清单，并标注需要你确认的决策点。";
  }
  return "收到。我会先明确目标与约束，再给出可执行清单，并标注需要你确认的决策点。";
};

const submit = (value: string) => {
  const prompt = value.trim();
  if (!prompt || sending.value) return;

  if (!activeKey.value) activeKey.value = "launch";
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

const handlePromptClick = (prompt: string) => {
  submit(prompt);
};

const stopGenerating = () => {
  if (responseTimer) {
    clearInterval(responseTimer);
    responseTimer = undefined;
  }
  const pending = messages.value.find((item) => item.pending);
  if (pending) pending.pending = false;
  sending.value = false;
};

onMounted(() => {
  if (window.matchMedia("(max-width: 760px)").matches) sidebarOpen.value = false;
});

onBeforeUnmount(() => {
  if (responseTimer) clearInterval(responseTimer);
});
</script>

<template>
  <div
    class="demo-window h-[min(680px,calc(100dvh-154px))] min-h-[570px] w-[min(1240px,100%)] overflow-hidden rounded-lg border border-solid border-brand-border bg-brand-workspace shadow-xl"
    aria-label="Open Chat 交互演示"
  >
    <div
      class="window-bar grid h-[42px] grid-cols-[1fr_auto_1fr] items-center border-b border-solid border-brand-border bg-brand-sidebar px-3"
    >
      <div class="window-controls flex items-center gap-1.5" aria-hidden="true">
        <i class="h-[9px] w-[9px] rounded-full bg-brand-border-strong"></i>
        <i class="h-[9px] w-[9px] rounded-full bg-brand-border-strong"></i>
        <i class="h-[9px] w-[9px] rounded-full bg-brand-border-strong"></i>
      </div>
      <div
        class="window-address flex h-[26px] items-center gap-[7px] rounded-[5px] border border-solid border-brand-border bg-brand-surface px-3.5 text-[11px] text-brand-muted"
      >
        <LockKeyhole class="!h-[11px] !w-[11px]" /> openchat.dev/chat
      </div>
      <div class="window-actions flex items-center justify-self-end gap-1">
        <span class="live-status flex items-center gap-1.5 text-[11px] text-brand-muted">
          <i class="h-1.5 w-1.5 rounded-full bg-success"></i> Live
        </span>
      </div>
    </div>

    <div
      class="demo-app grid h-[calc(100%-42px)] [transition:grid-template-columns_180ms_ease]"
      :class="
        sidebarOpen
          ? 'grid-cols-[248px_minmax(0,1fr)]'
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

      <section class="flex min-w-0 flex-col bg-brand-workspace">
        <header
          class="demo-chat-header relative z-2 flex min-h-[58px] items-center justify-between gap-3 border-b border-solid border-brand-border px-4 [background:color-mix(in_srgb,var(--brand-workspace)_90%,transparent)] backdrop-blur-[16px]"
        >
          <div class="flex min-w-0 items-center gap-[9px]">
            <Tooltip v-if="!sidebarOpen" title="展开侧栏">
              <button
                class="grid h-9 w-9 min-w-9 place-items-center rounded-md border border-solid border-transparent bg-transparent p-0 text-brand-muted hover:bg-brand-surface-subtle hover:text-brand-foreground"
                type="button"
                aria-label="展开侧栏"
                @click="sidebarOpen = true"
              >
                <PanelLeftOpen class="!h-[15px] !w-[15px]" />
              </button>
            </Tooltip>
            <button
              class="flex min-h-8 min-w-0 cursor-default items-center gap-[2px] rounded border-0 bg-transparent py-0 pl-0 pr-1 text-brand-foreground"
              type="button"
              aria-label="对话名称"
            >
              <span class="max-w-[min(38vw,320px)] truncate pl-[6px] text-[13px] font-650">{{
                activeConversation?.label || "新对话"
              }}</span>
              <ChevronDown class="!h-3.5 !w-3.5 text-brand-muted" />
            </button>
          </div>
          <div class="flex min-w-0 items-center gap-1">
            <span class="mr-[6px] flex items-center gap-[6px] text-[10px] text-brand-muted">
              <Cloud class="!h-[13px] !w-[13px]" />
              <span>已同步</span>
            </span>
          </div>
        </header>

        <div
          ref="messagesEl"
          class="demo-messages min-h-0 flex-1 overflow-y-auto px-[clamp(16px,4vw,40px)] pt-7 pb-3"
          aria-live="polite"
        >
          <div
            v-if="messages.length === 0"
            class="flex h-full min-h-[240px] flex-col items-center justify-center gap-3 text-center"
          >
            <span
              class="grid h-[42px] w-[42px] place-items-center rounded-[7px] bg-brand-primary text-brand-primary-foreground shadow-brand-sm"
            >
              <Sparkles class="!h-[18px] !w-[18px]" />
            </span>
            <h2 class="m-0 text-[28px] font-680 leading-[1.2] text-brand-foreground">
              今天想一起完成什么？
            </h2>
            <p class="m-0 max-w-[460px] text-[13px] text-brand-muted">
              从一个问题开始，或者把正在处理的内容交给 Open Chat。
            </p>
          </div>
          <LandingDemoMessage v-for="item in messages" :key="item.id" :message="item" />
        </div>

        <section
          class="demo-composer relative z-2 px-[clamp(16px,4vw,40px)] pb-[max(8px,env(safe-area-inset-bottom))] pt-[10px] bg-[linear-gradient(to_bottom,transparent_0,var(--brand-workspace)_24px,var(--brand-workspace)_100%)]"
        >
          <div
            v-if="showStarterPrompts"
            class="starter-prompts mx-auto mb-[7px] grid w-full max-w-[780px] grid-cols-3 gap-2"
          >
            <button
              v-for="item in starterPrompts"
              :key="item.key"
              type="button"
              class="flex min-h-[60px] cursor-pointer items-start gap-[10px] rounded-[7px] border border-solid border-brand-border bg-brand-surface px-3 py-[10px] text-left transition-colors duration-150 hover:border-brand-border-strong hover:bg-brand-surface-muted"
              @click="handlePromptClick(item.prompt)"
            >
              <span
                class="grid h-7 w-7 flex-[0_0_28px] place-items-center rounded-[5px] border border-solid border-brand-border bg-brand-surface-subtle"
              >
                <GitBranch
                  v-if="item.key === 'ticket-branch'"
                  class="!h-3.5 !w-3.5 text-brand-foreground"
                />
                <Lightbulb
                  v-else-if="item.key === 'placeholder-idea'"
                  class="!h-3.5 !w-3.5 text-brand-foreground"
                />
                <Sparkles v-else class="!h-3.5 !w-3.5 text-brand-foreground" />
              </span>
              <span class="flex min-w-0 flex-col gap-[2px]">
                <strong class="text-[11px] font-600 text-brand-foreground">{{ item.label }}</strong>
                <small class="truncate text-[9px] text-brand-muted">{{ item.description }}</small>
              </span>
            </button>
          </div>

          <div
            v-else
            class="suggestions mx-auto mb-[7px] flex w-full max-w-[780px] gap-1.5 overflow-x-auto [scrollbar-width:none]"
          >
            <button
              type="button"
              class="h-7 flex-none cursor-pointer rounded-[5px] border border-solid border-brand-border bg-brand-surface px-[9px] text-[10px] text-brand-muted transition-colors duration-150 hover:bg-brand-surface-subtle hover:text-brand-foreground"
              @click="content = '把它转换成时间线'"
            >
              转换成时间线
            </button>
            <button
              type="button"
              class="h-7 flex-none cursor-pointer rounded-[5px] border border-solid border-brand-border bg-brand-surface px-[9px] text-[10px] text-brand-muted transition-colors duration-150 hover:bg-brand-surface-subtle hover:text-brand-foreground"
              @click="content = '补充发布回滚方案'"
            >
              补充回滚方案
            </button>
            <button
              type="button"
              class="h-7 flex-none cursor-pointer rounded-[5px] border border-solid border-brand-border bg-brand-surface px-[9px] text-[10px] text-brand-muted transition-colors duration-150 hover:bg-brand-surface-subtle hover:text-brand-foreground"
              @click="content = '导出为 Markdown'"
            >
              导出 Markdown
            </button>
          </div>

          <Sender
            :value="content"
            :loading="sending"
            placeholder="向 Open Chat 发送消息"
            :suffix="false"
            @change="content = $event"
            @submit="submit"
          >
            <template #footer="{ defaultNode }">
              <div class="flex w-full min-h-[34px] items-center justify-between gap-3">
                <div class="flex items-center">
                  <Tooltip title="工具">
                    <Button type="text" shape="circle" aria-label="选择工具">
                      <SlidersHorizontal class="!h-[15px] !w-[15px]" />
                    </Button>
                  </Tooltip>
                </div>
                <div class="flex items-center gap-[3px]">
                  <Dropdown :menu="modelMenu" :trigger="['click']" placement="topRight">
                    <button
                      type="button"
                      class="flex min-h-[32px] cursor-pointer items-center gap-[5px] rounded-[5px] border-0 bg-transparent px-2 py-0 text-[10px] font-600 text-brand-muted hover:bg-brand-surface-subtle hover:text-brand-foreground"
                    >
                      <span>{{ currentModelLabel }}</span>
                      <ChevronDown class="!h-3 !w-3" />
                    </button>
                  </Dropdown>
                  <Tooltip title="语音输入">
                    <button
                      type="button"
                      class="grid h-[34px] w-[34px] place-items-center rounded-md border-0 bg-transparent p-0 text-brand-muted hover:bg-brand-surface-subtle hover:text-brand-foreground"
                      aria-label="语音输入"
                    >
                      <AudioLines class="!h-[15px] !w-[15px]" />
                    </button>
                  </Tooltip>
                  <Tooltip v-if="sending" title="停止生成">
                    <button
                      type="button"
                      class="grid h-[34px] w-[34px] place-items-center rounded-md border-0 bg-brand-primary p-0 text-brand-primary-foreground"
                      aria-label="停止生成"
                      @click="stopGenerating"
                    >
                      <Square class="!h-3 !w-3 fill-current" />
                    </button>
                  </Tooltip>
                  <component :is="defaultNode" v-else />
                </div>
              </div>
            </template>
          </Sender>
          <p class="mx-auto mb-0 mt-[6px] text-center text-[9px] text-brand-muted">
            Open Chat 可能会出错，请核查重要信息。
          </p>
        </section>
      </section>
    </div>
  </div>
</template>

<style scoped>
.window-actions :deep(.ant-btn),
.demo-composer :deep(.ant-btn) {
  width: 34px;
  min-width: 34px;
  height: 34px;
  color: var(--brand-muted);
}
.demo-composer :deep(.ant-btn:hover) {
  background: var(--brand-surface-subtle);
  color: var(--brand-foreground);
}
.demo-composer :deep(.antd-sender) {
  width: 100%;
  max-width: 780px;
  margin: 0 auto;
}
.demo-composer :deep(.antd-sender-main) {
  min-height: 96px;
  padding: 0;
  border: 1px solid var(--brand-border-strong);
  border-radius: 8px;
  background: var(--brand-surface);
  box-shadow:
    0 10px 34px rgba(9, 9, 11, 0.09),
    0 1px 4px rgba(9, 9, 11, 0.04);
  transition:
    border-color 160ms ease,
    box-shadow 160ms ease;
}
.demo-composer :deep(.antd-sender-main:focus-within) {
  border-color: var(--brand-foreground);
  box-shadow:
    0 0 0 1px var(--brand-foreground),
    0 10px 34px rgba(9, 9, 11, 0.09);
}
.demo-composer :deep(.antd-sender-content) {
  min-height: 50px;
  align-items: flex-start;
  padding: 12px 12px 2px;
}
.demo-composer :deep(.antd-sender-footer) {
  min-height: 44px;
  padding: 0 12px 10px;
}
.demo-composer :deep(textarea) {
  max-height: 120px;
  min-height: 36px;
  color: var(--brand-foreground);
  caret-color: var(--brand-foreground);
  font-size: 13px;
  line-height: 1.65;
}
.demo-composer :deep(textarea::placeholder) {
  color: var(--brand-muted);
  opacity: 1;
}
.demo-composer :deep(.antd-sender-actions-btn) {
  width: 34px;
  min-width: 34px;
  height: 34px;
  border-radius: 6px;
  background: var(--brand-primary);
  color: var(--brand-primary-foreground);
}

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
  .demo-chat-header button,
  .demo-composer :deep(.ant-btn),
  .demo-composer :deep(.antd-sender-actions-btn) {
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
    min-height: 56px;
    padding: 0 8px;
  }
  .demo-messages {
    padding: 22px 14px 12px;
  }
  .starter-prompts {
    grid-template-columns: 1fr;
  }
  .suggestions {
    width: 100%;
  }
  .suggestions button {
    min-height: 44px;
  }
  .demo-composer {
    padding-inline: 12px;
  }
}

@media (max-width: 430px) {
  .live-status,
  .demo-chat-header span:has(+ span),
  .demo-chat-header .mr-\[6px\] {
    display: none;
  }
}
</style>

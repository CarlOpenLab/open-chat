<script setup lang="ts">
import {
  Check as CheckOutlined,
  Ellipsis as MoreOutlined,
  LockKeyhole,
  MessageSquare as MessageOutlined,
  PanelLeftClose as MenuFoldOutlined,
  PanelLeftOpen as MenuUnfoldOutlined,
  Search as SearchOutlined,
  Share2 as ShareAltOutlined,
  Sparkles as RobotOutlined,
  SquarePen as EditOutlined,
} from "@lucide/vue";
import { Sender } from "@antdv-next/x";
import { Button, Select, Tooltip } from "antdv-next";
import { computed, nextTick, onBeforeUnmount, ref } from "vue";

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
  <div class="demo-window" aria-label="Open Chat 交互演示">
    <div class="window-bar">
      <div class="window-controls" aria-hidden="true"><i></i><i></i><i></i></div>
      <div class="window-address"><LockKeyhole /> openchat.dev/chat</div>
      <div class="window-actions">
        <span class="live-status"><i></i> Live</span>
        <Tooltip title="分享对话">
          <Button type="text" shape="circle" aria-label="分享对话"><ShareAltOutlined /></Button>
        </Tooltip>
      </div>
    </div>

    <div class="demo-app" :class="{ 'sidebar-hidden': !sidebarOpen }">
      <aside class="demo-sidebar">
        <div class="sidebar-brand-row">
          <a class="demo-brand" href="#top"
            ><span class="brand-glyph"><RobotOutlined /></span>Open Chat</a
          >
          <Tooltip title="收起侧栏">
            <Button type="text" shape="circle" aria-label="收起侧栏" @click="sidebarOpen = false">
              <MenuFoldOutlined />
            </Button>
          </Tooltip>
        </div>

        <Button class="new-chat" block @click="startNewConversation">
          <template #icon><EditOutlined /></template>
          新对话
          <kbd>⌘ K</kbd>
        </Button>

        <label class="demo-search">
          <SearchOutlined />
          <input type="search" aria-label="搜索对话" placeholder="搜索对话" />
        </label>

        <nav class="conversation-list" aria-label="历史对话">
          <span class="list-label">今天</span>
          <button
            v-for="item in conversations.slice(0, 3)"
            :key="item.key"
            type="button"
            class="conversation-item"
            :class="{ active: activeKey === item.key }"
            @click="selectConversation(item.key)"
          >
            <MessageOutlined />
            <span>{{ item.label }}</span>
          </button>
          <span class="list-label">过去 7 天</span>
          <button
            type="button"
            class="conversation-item"
            :class="{ active: activeKey === conversations[3].key }"
            @click="selectConversation(conversations[3].key)"
          >
            <MessageOutlined />
            <span>{{ conversations[3].label }}</span>
          </button>
        </nav>

        <div class="demo-account">
          <span>CC</span>
          <div><strong>Carl Chen</strong><small>Starter workspace</small></div>
          <MoreOutlined />
        </div>
      </aside>

      <section class="demo-main">
        <header class="demo-chat-header">
          <div class="chat-heading">
            <Tooltip v-if="!sidebarOpen" title="展开侧栏">
              <Button type="text" shape="circle" aria-label="展开侧栏" @click="sidebarOpen = true">
                <MenuUnfoldOutlined />
              </Button>
            </Tooltip>
            <div>
              <strong>{{ activeConversation?.label || "新对话" }}</strong>
              <span>{{ activeConversation?.updated || "未保存" }}</span>
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

        <div ref="messagesEl" class="demo-messages" aria-live="polite">
          <div v-for="item in messages" :key="item.id" class="demo-message" :class="item.role">
            <div v-if="item.role === 'assistant'" class="assistant-mark"><RobotOutlined /></div>
            <div class="message-content">
              <div v-if="item.role === 'assistant'" class="assistant-meta">
                <strong>Open Chat</strong><span>AI 助手</span>
              </div>
              <div v-if="item.pending && !item.content" class="typing" aria-label="正在生成">
                <i></i><i></i><i></i>
              </div>
              <p v-else>{{ item.content }}</p>
              <div v-if="item.id === 2" class="task-list">
                <div>
                  <CheckOutlined /><span
                    ><strong>P0 · 数据迁移演练</strong
                    ><small>后端 · 周二前完成回滚验证</small></span
                  ><b>高风险</b>
                </div>
                <div>
                  <i></i
                  ><span
                    ><strong>P0 · 监控与告警校验</strong><small>SRE · 覆盖核心转化链路</small></span
                  ><b>高风险</b>
                </div>
                <div>
                  <i></i
                  ><span
                    ><strong>P1 · 发布说明确认</strong><small>产品 · 周四完成最终审核</small></span
                  ><b class="normal">常规</b>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="suggestions">
          <button type="button" @click="content = '把它转换成时间线'">转换成时间线</button>
          <button type="button" @click="content = '补充发布回滚方案'">补充回滚方案</button>
          <button type="button" @click="content = '导出为 Markdown'">导出 Markdown</button>
        </div>

        <div class="demo-composer">
          <Sender
            :value="content"
            :loading="sending"
            placeholder="向 Open Chat 发送消息"
            @change="content = $event"
            @submit="submit"
          />
          <p>Open Chat 可能会出错，请核查重要信息。</p>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.demo-window {
  width: min(1240px, 100%);
  height: min(680px, calc(100dvh - 154px));
  min-height: 570px;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--background);
  box-shadow: var(--shadow-xl);
}
.demo-window :deep(svg.lucide) {
  width: var(--icon-sm);
  height: var(--icon-sm);
}

.window-bar {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  height: 42px;
  padding: 0 12px;
  border-bottom: 1px solid var(--border);
  background: var(--subtle);
}

.window-controls,
.window-actions,
.live-status,
.chat-heading,
.sidebar-brand-row,
.demo-brand,
.demo-search,
.assistant-meta {
  display: flex;
  align-items: center;
}

.window-controls {
  gap: 6px;
}
.window-controls i {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--border-strong);
}
.window-address {
  display: flex;
  align-items: center;
  gap: 7px;
  height: 26px;
  padding: 0 14px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--background);
  color: var(--muted-foreground);
  font-size: 11px;
}
.window-address :deep(svg) {
  width: 11px;
  height: 11px;
}
.window-actions {
  justify-self: end;
  gap: 4px;
}
.live-status {
  gap: 6px;
  color: var(--muted-foreground);
  font-size: 11px;
}
.live-status i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--success);
}
.window-actions :deep(.ant-btn) {
  width: 32px;
  min-width: 32px;
  height: 32px;
}

.demo-app {
  display: grid;
  grid-template-columns: 238px minmax(0, 1fr);
  height: calc(100% - 42px);
  transition: grid-template-columns 180ms ease;
}
.demo-app.sidebar-hidden {
  grid-template-columns: 0 minmax(0, 1fr);
}
@media (min-width: 761px) {
  .demo-app.sidebar-hidden .demo-sidebar {
    padding-right: 0;
    padding-left: 0;
    border-right-color: transparent;
  }
}
.demo-sidebar {
  display: flex;
  min-width: 0;
  flex-direction: column;
  overflow: hidden;
  padding: 12px 10px 10px;
  border-right: 1px solid var(--border);
  background: var(--subtle);
}
.sidebar-brand-row {
  justify-content: space-between;
  min-width: 218px;
  height: 38px;
  padding: 0 4px 8px;
}
.demo-brand {
  min-height: 44px;
  gap: 8px;
  font-size: 13px;
  font-weight: 650;
}
.brand-glyph {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: 5px;
  background: var(--foreground);
  color: var(--background);
}
.brand-glyph :deep(svg) {
  width: 14px;
  height: 14px;
}
.sidebar-brand-row :deep(.ant-btn) {
  width: 32px;
  min-width: 32px;
  height: 32px;
}
.new-chat {
  display: grid !important;
  grid-template-columns: 18px 1fr auto;
  min-width: 218px;
  height: 38px;
  text-align: left;
}
.new-chat kbd {
  color: var(--muted-foreground);
  font-size: 10px;
}
.demo-search {
  gap: 8px;
  min-width: 210px;
  height: 42px;
  padding: 0 8px;
  color: var(--muted-foreground);
}
.demo-search input {
  min-width: 0;
  flex: 1;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--foreground);
  font-size: 12px;
}
.conversation-list {
  display: flex;
  min-width: 218px;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  overflow-y: auto;
}
.list-label {
  margin: 10px 8px 3px;
  color: var(--muted-foreground);
  font-size: 10px;
  font-weight: 600;
}
.conversation-item {
  display: grid;
  grid-template-columns: 16px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 34px;
  padding: 0 8px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--muted-foreground);
  text-align: left;
  font-size: 11px;
  cursor: pointer;
  transition:
    background 150ms ease,
    color 150ms ease;
}
.conversation-item:hover,
.conversation-item.active {
  background: var(--muted);
  color: var(--foreground);
}
.conversation-item span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.demo-account {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr) 20px;
  align-items: center;
  gap: 8px;
  min-width: 218px;
  padding: 10px 5px 0;
  border-top: 1px solid var(--border);
}
.demo-account > span {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 5px;
  background: var(--foreground);
  color: var(--background);
  font-size: 9px;
  font-weight: 700;
}
.demo-account div {
  display: flex;
  min-width: 0;
  flex-direction: column;
}
.demo-account strong {
  font-size: 10px;
}
.demo-account small {
  color: var(--muted-foreground);
  font-size: 9px;
}

.demo-main {
  display: grid;
  min-width: 0;
  grid-template-rows: 54px minmax(0, 1fr) auto auto;
  background: var(--background);
}
.demo-chat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 16px;
  border-bottom: 1px solid var(--border);
}
.chat-heading {
  min-width: 0;
  gap: 6px;
}
.chat-heading > div {
  display: flex;
  min-width: 0;
  flex-direction: column;
}
.chat-heading strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}
.chat-heading span {
  color: var(--muted-foreground);
  font-size: 9px;
}
.demo-chat-header :deep(.ant-select) {
  width: 142px;
  font-size: 11px;
}
.demo-chat-header :deep(.ant-select-selector) {
  border-radius: 5px;
}
.demo-messages {
  min-height: 0;
  overflow-y: auto;
  padding: 28px clamp(20px, 7%, 80px) 14px;
}
.demo-message {
  width: min(100%, 700px);
  margin: 0 auto 22px;
}
.demo-message.user {
  display: flex;
  justify-content: flex-end;
}
.demo-message.user p {
  max-width: 70%;
  margin: 0;
  padding: 10px 13px;
  border-radius: 7px 7px 2px 7px;
  background: var(--muted);
  font-size: 11px;
  line-height: 1.55;
}
.demo-message.assistant {
  display: grid;
  grid-template-columns: 26px minmax(0, 1fr);
  gap: 10px;
}
.assistant-mark {
  display: grid;
  place-items: center;
  width: 25px;
  height: 25px;
  border-radius: 5px;
  background: var(--foreground);
  color: var(--background);
  font-size: 13px;
}
.assistant-meta {
  gap: 7px;
  margin: 2px 0 8px;
}
.assistant-meta strong {
  font-size: 11px;
}
.assistant-meta span {
  padding: 1px 5px;
  border: 1px solid var(--border);
  border-radius: 3px;
  color: var(--muted-foreground);
  font-size: 8px;
}
.message-content > p {
  margin: 0 0 12px;
  font-size: 11px;
  line-height: 1.65;
}
.task-list {
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 6px;
}
.task-list > div {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr) auto;
  align-items: center;
  gap: 9px;
  min-height: 47px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
}
.task-list > div:last-child {
  border-bottom: 0;
}
.task-list > div > :first-child {
  display: grid;
  place-items: center;
  width: 16px;
  height: 16px;
  border: 1px solid var(--input);
  border-radius: 4px;
}
.task-list > div:first-child > :first-child {
  border-color: var(--foreground);
  background: var(--foreground);
  color: var(--background);
  font-size: 10px;
}
.task-list > div:first-child > :first-child :deep(svg) {
  width: 10px;
  height: 10px;
}
.task-list span {
  display: flex;
  min-width: 0;
  flex-direction: column;
}
.task-list strong,
.task-list small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.task-list strong {
  font-size: 10px;
}
.task-list small {
  color: var(--muted-foreground);
  font-size: 9px;
}
.task-list b {
  padding: 2px 6px;
  border-radius: 3px;
  background: var(--danger-subtle);
  color: var(--danger);
  font-size: 8px;
  font-weight: 500;
}
.task-list b.normal {
  background: var(--muted);
  color: var(--muted-foreground);
}
.typing {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 24px;
}
.typing i {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--muted-foreground);
  animation: demo-typing 1s ease-in-out infinite;
}
.typing i:nth-child(2) {
  animation-delay: 120ms;
}
.typing i:nth-child(3) {
  animation-delay: 240ms;
}
.suggestions {
  display: flex;
  gap: 6px;
  width: min(calc(100% - 40px), 700px);
  margin: 0 auto 7px;
  overflow-x: auto;
  scrollbar-width: none;
}
.suggestions button {
  flex: 0 0 auto;
  height: 28px;
  padding: 0 9px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--background);
  color: var(--muted-foreground);
  font-size: 9px;
  cursor: pointer;
  transition:
    background 150ms ease,
    color 150ms ease;
}
.suggestions button:hover {
  background: var(--muted);
  color: var(--foreground);
}
.demo-composer {
  width: min(calc(100% - 40px), 700px);
  margin: 0 auto;
}
.demo-composer :deep(.antd-sender-main) {
  border-radius: 7px;
  box-shadow: var(--shadow-lg);
}
.demo-composer :deep(textarea) {
  font-size: 11px;
}
.demo-composer > p {
  margin: 5px 0 8px;
  color: var(--muted-foreground);
  font-size: 8px;
  text-align: center;
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
  .sidebar-brand-row :deep(.ant-btn),
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
  .demo-sidebar {
    position: absolute;
    z-index: 4;
    inset: 0 auto 0 0;
    width: min(270px, 82%);
    box-shadow: 12px 0 30px rgba(9, 9, 11, 0.16);
    transform: translateX(0);
    transition: transform 180ms ease;
  }
  .demo-app.sidebar-hidden .demo-sidebar {
    transform: translateX(-105%);
  }
  .demo-chat-header {
    padding: 0 8px;
  }
  .demo-chat-header :deep(.ant-select-selector) {
    min-height: 44px;
    align-items: center;
  }
  .new-chat,
  .conversation-item {
    min-height: 44px;
  }
  .demo-search {
    height: 44px;
  }
  .demo-search input,
  .demo-composer :deep(textarea) {
    font-size: 16px;
  }
  .demo-messages {
    padding: 22px 14px 12px;
  }
  .demo-message.user p {
    max-width: 88%;
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
  .task-list > div {
    grid-template-columns: 18px minmax(0, 1fr);
  }
  .task-list b {
    display: none;
  }
}
</style>

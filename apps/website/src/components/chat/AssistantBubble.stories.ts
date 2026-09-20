import type { BubbleItemType } from "@antdv-next/x";
import type { Meta, StoryObj } from "@storybook/vue3-vite";
import type { ContentMessage } from "@cc-heart/open-chat-types";
import { ref } from "vue";
import AssistantBubble from "./AssistantBubble.vue";

const baseTime = Date.parse("2026-09-20T10:00:00+08:00");

/** 正文气泡项：extraInfo 结构与 modelMessagesToBubbleItems 保持一致。 */
const contentItem = (content: string): BubbleItemType => {
  const message: ContentMessage = { id: "c1", timestamp: baseTime, role: "content", content };
  return {
    key: "a1::c1",
    role: "assistant",
    status: "success",
    content,
    extraInfo: { messageRole: "content", message },
  };
};

const answer = [
  "改好了，草稿现在渲染成可关闭的 tag：",
  "",
  "1. 选中 skill 后写入 `draft`",
  "2. `SenderLayout` 的 slot 内容按 tag 形态渲染",
  "3. 提交时还原为 `/name` 参数",
].join("\n");

const meta: Meta<typeof AssistantBubble> = {
  title: "chat/AssistantBubble",
  component: AssistantBubble,
  args: {
    item: contentItem(answer),
    content: answer,
    streaming: false,
    searchResults: [],
    showActions: true,
  },
  argTypes: {
    item: { control: false },
    searchResults: { control: false },
    markdownClassName: { control: false, description: "由 render 按当前主题生成" },
    showActions: { control: "boolean", description: "仅最后一条已完成的正文显示操作栏" },
    streaming: { control: "boolean" },
    theme: { control: false, description: "由主题工具栏驱动（透传给 AssistantMessageContent）" },
  },
  render: (args, context) => {
    const theme = context.globals.theme === "dark" ? "dark" : "light";
    return {
      components: { AssistantBubble },
      setup() {
        const lastReload = ref("");
        const onReload = (messageId: string | number) => (lastReload.value = String(messageId));
        return {
          args,
          theme,
          markdownClassName: `chat-markdown x-markdown-${theme}`,
          lastReload,
          onReload,
        };
      },
      template: `<div class="w-full max-w-[820px]">
        <AssistantBubble
          v-bind="args"
          :theme="theme"
          :markdown-class-name="markdownClassName"
          @reload="onReload"
        />
        <p v-if="lastReload" class="mt-2 text-xs text-brand-muted">已触发 reload：{{ lastReload }}</p>
      </div>`,
    };
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

/** 最后一条正文：下方带复制 / 重新生成操作栏，点击重新生成会上抛 reload。 */
export const WithActions: Story = {};

/** 流式接收中：正文增量渲染，此时不显示操作栏。 */
export const Streaming: Story = {
  args: {
    content: "正在把展开态收敛到 `useMessageActivityState`",
    item: contentItem("正在把展开态收敛到 `useMessageActivityState`"),
    streaming: true,
    showActions: false,
  },
};

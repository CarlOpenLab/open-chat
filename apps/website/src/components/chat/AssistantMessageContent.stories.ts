import type { BubbleItemType } from "@antdv-next/x";
import type { Meta, StoryObj } from "@storybook/vue3-vite";
import type { ContentMessage } from "@cc-heart/open-chat-types";
import AssistantMessageContent from "./AssistantMessageContent.vue";

const baseTime = Date.parse("2026-09-20T10:00:00+08:00");

/** 正文气泡项：extraInfo 结构与 modelMessagesToBubbleItems 保持一致。 */
const contentItem = (content: string, extraInfo: Record<string, unknown> = {}): BubbleItemType => {
  const message: ContentMessage = { id: "c1", timestamp: baseTime, role: "content", content };
  return {
    key: "a1::c1",
    role: "assistant",
    status: "success",
    content,
    extraInfo: { messageRole: "content", message, ...extraInfo },
  };
};

const plainAnswer = [
  "拆分后的分工：",
  "",
  "- `ChatMessages` 只保留展示项分组与分支渲染",
  "- 展开态与计时收进 `useMessageActivityState`",
  "",
  "计时口径与重构前一致，`reasoningDurationMs` 仍按合并组记账。",
].join("\n");

const fencedAnswer = [
  "状态机改成了一个 composable：",
  "",
  "```ts",
  "const { isSummaryExpanded, setSummaryExpanded } = useMessageActivityState({",
  "  displayItems,",
  "  conversationKey: () => props.conversationKey,",
  "  workingStartedAtMs: () => props.workingStartedAtMs,",
  "});",
  "```",
  "",
  "调用方不需要改动，展开态依旧是「用户显式选择优先」。",
].join("\n");

const streamingAnswer = "正在把展开态收敛到 `useMessageActivityState`，流式中思考条目默认展开";

const meta: Meta<typeof AssistantMessageContent> = {
  title: "chat/AssistantMessageContent",
  component: AssistantMessageContent,
  args: {
    item: contentItem(plainAnswer),
    content: plainAnswer,
    streaming: false,
    searchResults: [],
  },
  argTypes: {
    item: { control: false },
    markdownClassName: { control: false, description: "由 render 按当前主题生成" },
    theme: { control: false, description: "由主题工具栏驱动（缺省继承 XProvider 侧主题）" },
  },
  render: (args, context) => {
    const theme = context.globals.theme === "dark" ? "dark" : "light";
    return {
      components: { AssistantMessageContent },
      setup: () => ({ args, theme, markdownClassName: `chat-markdown x-markdown-${theme}` }),
      template: `<div class="w-full max-w-[820px]">
        <AssistantMessageContent
          v-bind="args"
          :theme="theme"
          :markdown-class-name="markdownClassName"
        />
      </div>`,
    };
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

/** 普通回答：markdown 列表与行内代码。 */
export const Plain: Story = {};

/** 流式接收中：未完成的 markdown 也会被增量渲染。 */
export const Streaming: Story = {
  args: { content: streamingAnswer, item: contentItem(streamingAnswer), streaming: true },
};

/** fenced code（浅色）：主题工具栏切浅色，代码高亮走浅色主题。 */
export const FencedCodeLight: Story = {
  args: { content: fencedAnswer, item: contentItem(fencedAnswer) },
  globals: { theme: "light" },
};

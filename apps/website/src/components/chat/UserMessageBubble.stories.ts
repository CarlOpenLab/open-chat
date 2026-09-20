import type { Meta, StoryObj } from "@storybook/vue3-vite";
import UserMessageBubble from "./UserMessageBubble.vue";

/** 内联 SVG 占位截图：Storybook 内不发起任何网络请求。 */
const screenshotSrc = `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="224" viewBox="0 0 320 224"><rect width="320" height="224" fill="#f4f4f5"/><rect x="24" y="24" width="200" height="16" rx="8" fill="#d4d4d8"/><rect x="24" y="56" width="272" height="120" rx="10" fill="#e4e4e7"/><rect x="40" y="76" width="120" height="12" rx="6" fill="#a1a1aa"/><rect x="40" y="100" width="180" height="12" rx="6" fill="#c4c4c8"/><circle cx="268" cy="88" r="14" fill="#60a5fa"/></svg>`,
)}`;

/** 第二张占位图：用于确认多张缩略图的换行与间距。 */
const terminalSrc = `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="224" viewBox="0 0 320 224"><rect width="320" height="224" fill="#18181b"/><rect x="24" y="24" width="272" height="176" rx="10" fill="#27272a"/><rect x="40" y="44" width="140" height="10" rx="5" fill="#4ade80"/><rect x="40" y="66" width="200" height="10" rx="5" fill="#a1a1aa"/><rect x="40" y="88" width="120" height="10" rx="5" fill="#a1a1aa"/></svg>`,
)}`;

const attachments = [
  { reference: "att-9f3c", name: "sender-draft-tag.png", src: screenshotSrc },
  { reference: "att-1b28", name: "vp-check.png", src: terminalSrc },
];

const meta: Meta<typeof UserMessageBubble> = {
  title: "chat/UserMessageBubble",
  component: UserMessageBubble,
  args: {
    content: "把 sender 的斜杠选择改成 tag 形态，改完跑一下 vp check。",
  },
  argTypes: {
    content: { control: "text" },
    attachments: { control: "object", description: "已过滤好的图片附件（src 由父层解析）" },
  },
  render: (args) => ({
    components: { UserMessageBubble },
    setup: () => ({ args }),
    template: `<div class="w-full max-w-[820px]"><UserMessageBubble v-bind="args" /></div>`,
  }),
};

export default meta;
type Story = StoryObj<typeof meta>;

/** 纯文本：右对齐的填充气泡。 */
export const TextOnly: Story = {};

/** 带两张图片附件：缩略图在文本上方，换行排列。 */
export const WithImages: Story = {
  args: { content: "两张截图都在这里，第二张是 vp check 的结果。", attachments },
};

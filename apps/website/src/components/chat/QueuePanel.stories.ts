import type { Meta, StoryObj } from "@storybook/vue3-vite";
import type { QueuedChatMessage } from "../../services/chatStorage";
import QueuePanel from "./QueuePanel.vue";

/** 待发送队列（3 条，含一条纯附件）。 */
const queuedMessages: QueuedChatMessage[] = [
  {
    id: "q1",
    content: "再补一组边界测试，覆盖空目录和只读文件",
    createdAt: 1_726_700_000_000,
  },
  {
    id: "q2",
    content: "更新 README 的架构章节",
    createdAt: 1_726_700_060_000,
  },
  {
    id: "q3",
    content: "",
    createdAt: 1_726_700_120_000,
    attachments: [
      { reference: "cc-attachment:shot", name: "shot.png", isImage: true, path: "/tmp/shot.png" },
    ],
  },
];

const meta: Meta<typeof QueuePanel> = {
  title: "chat/QueuePanel",
  component: QueuePanel,
  args: {
    queuedMessages,
    queuePaused: false,
    loading: false,
  },
  render: (args) => ({
    components: { QueuePanel },
    setup: () => ({ args }),
    template: `<div style="max-width: 640px; padding: 12px;"><QueuePanel v-bind="args" /></div>`,
  }),
};

export default meta;
type Story = StoryObj<typeof meta>;

/** 空闲：每条消息都可编辑 / 删除，首条可立即发送下一条。 */
export const Idle: Story = {};

/** 运行中：隐藏「发送下一条」，队列只等待本轮结束后继续。 */
export const Running: Story = {
  args: { loading: true },
};

/** 行内编辑：play 点击首条消息的编辑按钮进入编辑态。 */
export const Editing: Story = {
  play: async ({ canvasElement }) => {
    const button = canvasElement.querySelector<HTMLButtonElement>(
      'button[aria-label="编辑队列消息"]',
    );
    button?.click();
  },
};

import type { Meta, StoryObj } from "@storybook/vue3-vite";
import WorkingIndicator from "./WorkingIndicator.vue";

const meta: Meta<typeof WorkingIndicator> = {
  title: "chat/WorkingIndicator",
  component: WorkingIndicator,
  args: {
    working: true,
    workingStartedAtMs: Date.now() - 12_000,
  },
  argTypes: {
    working: { control: "boolean", description: "会话运行中（与侧栏 busy 状态同源）" },
    workingStartedAtMs: {
      control: "number",
      description: "服务端运行起点；缺省时只显示「工作中」不带时长",
    },
  },
  render: (args) => ({
    components: { WorkingIndicator },
    setup: () => ({ args }),
    template: `<div class="w-full max-w-[820px]"><WorkingIndicator v-bind="args" /></div>`,
  }),
};

export default meta;
type Story = StoryObj<typeof meta>;

/** 运行十几秒：三个点 + "工作中 · 12 秒"，时长每秒跳动。 */
export const Seconds: Story = {};

/** 没有服务端起点（本地刚发起）：只显示"工作中"。 */
export const WithoutStartPoint: Story = {
  args: { workingStartedAtMs: undefined },
};

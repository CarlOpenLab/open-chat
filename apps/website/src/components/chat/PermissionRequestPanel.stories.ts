import type { Meta, StoryObj } from "@storybook/vue3-vite";
import type { PermissionRequest } from "../../services/OpenChatProvider";
import PermissionRequestPanel from "./PermissionRequestPanel.vue";

/** 两条选择：允许一次 / 拒绝。 */
const twoOptions: PermissionRequest = {
  id: "perm-2",
  version: "v2",
  permission: "edit",
  patterns: ["apps/website/src/components/chat/ChatInput.vue"],
  metadata: { title: "修改文件" },
  options: [
    { optionId: "o1", name: "允许一次", kind: "allow_once" },
    { optionId: "o2", name: "拒绝", kind: "reject_once" },
  ],
};

const meta: Meta<typeof PermissionRequestPanel> = {
  title: "chat/PermissionRequestPanel",
  component: PermissionRequestPanel,
  args: {
    request: twoOptions,
  },
  render: (args) => ({
    components: { PermissionRequestPanel },
    setup: () => ({ args }),
    template: `<div style="max-width: 640px; padding: 12px;"><PermissionRequestPanel v-bind="args" /></div>`,
  }),
};

export default meta;
type Story = StoryObj<typeof meta>;

/** 两条选择：一次授权与拒绝，面板最简形态。 */
export const TwoOptions: Story = {};

/** 网关未给出 options：回落到默认三键（拒绝 / 允许一次 / 始终允许）。 */
export const DefaultActions: Story = {
  args: {
    request: {
      id: "perm-default",
      version: "v1",
      permission: "webfetch",
      patterns: ["https://ant.design/components/overview-cn"],
      metadata: {},
    },
  },
};

import type { Meta, StoryObj } from "@storybook/vue3-vite";
import BoardAssistantChat from "./BoardAssistantChat.vue";

/** 消息 fixture（与 BoardAssistantChat 的 messages prop 同构）。 */
type ChatMessage = {
  role: "user" | "assistant" | "error";
  content: string;
  streaming?: boolean;
};

/** 示例 agent 下拉项：容器已完成可用性过滤与不可用标注。 */
const agentOptions = [
  { value: "omp", label: "Oh My Pi" },
  { value: "claude", label: "Claude Code" },
  { value: "codex", label: "Codex（不可用）", disabled: true },
];

/** 一轮已完成的问答（看板任务盘点 + 拆分建议）。 */
const conversation: ChatMessage[] = [
  { role: "user", content: "看板现在有什么任务？" },
  {
    role: "assistant",
    content:
      "当前看板 5 个任务：\n\n- 待办：登录页报错定位（P1，明天截止）\n- 进行中：sender 输入区重构（P0）\n- 待验收：看板抽屉拆层（P2）\n- 已完成：ACP 权限弹窗（P1）×2",
  },
];

const meta: Meta<typeof BoardAssistantChat> = {
  title: "board/BoardAssistantChat",
  component: BoardAssistantChat,
  args: {
    modelValue: "",
    messages: [],
    running: false,
    toolActivityCount: 0,
    pendingPermission: null,
    agentId: "omp",
    agentOptions,
    placeholder: "告诉助手怎么调整看板…（Enter 发送，Shift+Enter 换行）",
  },
  argTypes: {
    modelValue: { control: "text" },
    agentId: { control: "select", options: ["omp", "claude", "codex"] },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

/** 空态：尚无消息，展示自然语言操作看板的引导文案。 */
export const Empty: Story = {};

/** 已有对话 + 输入框草稿：关抽屉再打开草稿仍在（草稿由容器持有）。 */
export const Conversing: Story = {
  args: {
    messages: conversation,
    modelValue: "把「登录页报错」拆成三个任务，明天截止，P1",
  },
};

/** 权限审批（4 个选项）：reject_once / reject_always 合并为「拒绝」，渲染 3 个动作。 */
export const PermissionFourOptions: Story = {
  args: {
    messages: [...conversation, { role: "assistant", content: "", streaming: true }],
    running: true,
    pendingPermission: {
      id: "perm-bash",
      title: "执行终端命令：rm -rf node_modules",
      options: [
        { optionId: "once", name: "Allow once", kind: "allow_once" },
        { optionId: "always", name: "Always allow", kind: "allow_always" },
        { optionId: "reject_once", name: "Reject", kind: "reject_once" },
        { optionId: "reject_always", name: "Always reject", kind: "reject_always" },
      ],
    },
  },
};

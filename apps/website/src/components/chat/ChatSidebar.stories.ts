import type { Meta, StoryObj } from "@storybook/vue3-vite";
import { screen, userEvent } from "storybook/test";
import type { AgentView } from "../../services/acp";
import ChatSidebar from "./ChatSidebar.vue";

/**
 * 示例供应商：API（内置）+ ACP 就绪 / 缺适配器 / 未安装 / 已禁用各一条，
 * 覆盖 trigger 单行状态与供应商 Modal 卡片状态的全部文案分支。
 */
const agents: AgentView[] = [
  {
    id: "api",
    kind: "api",
    name: "API 模型",
    description: "通过网关调用远端模型，无需本地 CLI",
    installed: true,
    available: true,
    enabled: true,
    transport: "http",
    protocol: "HTTPS",
    command: "",
  },
  {
    id: "claude",
    kind: "acp",
    name: "Claude Code",
    description: "连接本机 Claude Code，与网页共用同一个工作目录",
    installed: true,
    available: true,
    enabled: true,
    transport: "stdio",
    protocol: "ACP",
    command: "claude-code-acp",
  },
  {
    id: "codex",
    kind: "acp",
    name: "Codex",
    description: "连接本机 Codex CLI",
    installed: true,
    available: false,
    enabled: true,
    transport: "stdio",
    protocol: "ACP",
    command: "codex-acp",
    adapterHint: "npm i -g @zed-industries/codex-acp",
  },
  {
    id: "kimi",
    kind: "acp",
    name: "Kimi CLI",
    description: "连接本机 Kimi CLI",
    installed: false,
    available: false,
    enabled: true,
    transport: "stdio",
    protocol: "CLI",
    command: "kimi",
  },
  {
    id: "grok",
    kind: "acp",
    name: "Grok CLI",
    description: "连接本机 Grok CLI",
    installed: false,
    available: false,
    enabled: false,
    transport: "stdio",
    protocol: "CLI",
    command: "grok",
  },
];

/**
 * 默认插槽的静态会话行：真实页面由 ConversationListPanel（依赖 useWorkspace）填充，
 * story 不引业务状态，只还原分组与当前会话高亮的视觉形态。
 */
const conversationGroups = [
  {
    title: "今天",
    items: [
      { label: "Storybook 组件库接入", active: true },
      { label: "重构 sender 的 skill 选择交互", active: false },
      { label: "修复 ACP 会话恢复后丢历史", active: false },
    ],
  },
  {
    title: "昨天",
    items: [
      { label: "任务看板拖拽排序", active: false },
      { label: "补充 workspace mock 视图", active: false },
    ],
  },
];

/** 默认插槽内容（v-for 需要 conversationGroups 在 setup 返回值里）。 */
const conversationListSlot = `
  <div class="flex min-h-0 flex-1 flex-col overflow-y-auto px-[10px]">
    <template v-for="group in conversationGroups" :key="group.title">
      <p class="m-0 px-[8px] pt-[10px] pb-[4px] text-[10px] text-brand-muted-strong">
        {{ group.title }}
      </p>
      <div
        v-for="item in group.items"
        :key="item.label"
        class="flex h-[30px] items-center rounded-[6px] px-[8px] text-[12.5px]"
        :class="
          item.active ? 'bg-brand-surface-subtle text-brand-foreground' : 'text-brand-muted-strong'
        "
      >
        <span class="truncate">{{ item.label }}</span>
      </div>
    </template>
  </div>
`;

const meta: Meta<typeof ChatSidebar> = {
  title: "chat/ChatSidebar",
  component: ChatSidebar,
  args: {
    open: true,
    dark: false,
    agents,
    activeAgentId: "api",
  },
  argTypes: {
    open: { control: "boolean", description: "侧栏是否展开（收起时不画右边框）" },
    dark: { control: "boolean", description: "主题标记，决定底栏切换按钮的图标" },
    agents: { control: "object", description: "可用供应商列表" },
    activeAgentId: { control: "select", options: agents.map((agent) => agent.id) },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

/** 侧栏是 h-full 布局，story 用固定尺寸容器承载；slot 为默认插槽内容。 */
const framed =
  (slot = ""): NonNullable<Story["render"]> =>
  (args) => ({
    components: { ChatSidebar },
    setup: () => ({ args, conversationGroups }),
    template: `
    <div style="height: 640px; width: 268px">
      <ChatSidebar v-bind="args">${slot}</ChatSidebar>
    </div>
  `,
  });

/** 会话列表：默认插槽内按天分组，当前会话高亮。 */
export const WithConversations: Story = {
  render: framed(conversationListSlot),
};

/** 供应商选择弹窗：play 点击供应商 trigger 打开 Modal，展示当前项与不可用原因。 */
export const ProviderPicker: Story = {
  args: { activeAgentId: "claude" },
  render: framed(),
  play: async () => {
    await userEvent.click(screen.getByRole("button", { name: "选择供应商" }));
    // antd Modal 异步挂载到 body，等「当前」标记出现即代表卡片列表已渲染
    await screen.findByText("当前");
  },
};

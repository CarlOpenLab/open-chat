import type { Meta, StoryObj } from "@storybook/vue3-vite";
import { ref } from "vue";
import type { ModelCatalogEntry } from "../../composables/useChatModels";
import SenderLayout from "./SenderLayout.vue";
import SenderToolbar from "./SenderToolbar.vue";

/** 示例模型目录（按供应商分组）。 */
const modelCatalog: ModelCatalogEntry[] = [
  {
    providerId: "opencode",
    providerName: "OpenCode 本地",
    models: [
      { id: "opencode/qwen3-coder", name: "Qwen3 Coder", contextLength: 262_144 },
      { id: "opencode/claude-sonnet-5", name: "Claude Sonnet 5", contextLength: 200_000 },
    ],
  },
  {
    providerId: "deepseek",
    providerName: "DeepSeek",
    models: [{ id: "deepseek-chat", name: "deepseek-chat", contextLength: 128_000 }],
  },
];

const meta: Meta<typeof SenderToolbar> = {
  title: "sender/SenderToolbar",
  component: SenderToolbar,
  args: {
    reasoningLevel: "lowest",
    permission: "supervised",
    mode: "build",
    model: "opencode/qwen3-coder",
    modelLabel: "Qwen3 Coder",
    modelCatalog,
  },
  argTypes: {
    reasoningLevel: { control: "select", options: ["lowest", "low", "medium", "high"] },
    permission: { control: "select", options: ["supervised", "auto", "full"] },
    mode: { control: "select", options: ["build", "plan"] },
    runState: { control: "select", options: [null, "running", "requires_action", "idle"] },
  },
  // 字面量类名（sender-footer-row / sender-flat-btn / sender-stop-button）由壳层
  // SenderLayout 的样式锚定，因此工具行的故事统一嵌在真实壳层的 #footer 里。
  render: (args) => ({
    components: { SenderLayout, SenderToolbar },
    setup() {
      const value = ref("");
      const onChange = (next: string) => {
        value.value = next;
      };
      return { args, value, onChange };
    },
    template: `
      <SenderLayout :value="value" :on-change="onChange" placeholder="做什么都可以... 输入 / 唤起指令与技能">
        <template #footer="{ defaultNode }">
          <SenderToolbar v-bind="args" :default-node="defaultNode" />
        </template>
      </SenderLayout>
    `,
  }),
};

export default meta;
type Story = StoryObj<typeof meta>;

/** 空闲工具行：构建模式 + 有监督权限 + 最低推理难度。 */
export const Idle: Story = {};

/** 运行中：深度思考与文件工作区 chip 高亮，运行状态文字与独立停止按钮出现。 */
export const Running: Story = {
  args: {
    loading: true,
    runState: "running",
    thinkingEnabled: true,
    reasoningLevel: "high",
    fileModeEnabled: true,
  },
};

/** 已有待发送附件：附件 chip 高亮，面板展开态写入 aria-expanded。 */
export const WithAttachments: Story = {
  args: {
    hasAttachments: true,
    attachmentsPanelOpen: true,
  },
};

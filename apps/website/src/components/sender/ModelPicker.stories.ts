import type { Meta, StoryObj } from "@storybook/vue3-vite";
import { ref } from "vue";
import type { ModelCatalogEntry } from "../../composables/useChatModels";
import ModelPicker from "./ModelPicker.vue";
import SenderLayout from "./SenderLayout.vue";

/** 示例模型目录（按供应商分组）。 */
const modelCatalog: ModelCatalogEntry[] = [
  {
    providerId: "opencode",
    providerName: "OpenCode 本地",
    models: [
      { id: "opencode/qwen3-coder", name: "Qwen3 Coder", contextLength: 262_144 },
      { id: "opencode/claude-sonnet-5", name: "Claude Sonnet 5", contextLength: 200_000 },
      { id: "opencode/glm-4.5", name: "GLM-4.5" },
    ],
  },
  {
    providerId: "deepseek",
    providerName: "DeepSeek",
    models: [
      { id: "deepseek-chat", name: "deepseek-chat", contextLength: 128_000 },
      { id: "deepseek-reasoner", name: "deepseek-reasoner", contextLength: 128_000 },
    ],
  },
  {
    providerId: "anthropic",
    providerName: "Anthropic",
    models: [
      { id: "anthropic/claude-sonnet-5", name: "Claude Sonnet 5", contextLength: 1_000_000 },
    ],
  },
];

const meta: Meta<typeof ModelPicker> = {
  title: "sender/ModelPicker",
  component: ModelPicker,
  args: {
    model: "opencode/claude-sonnet-5",
    modelLabel: "Claude Sonnet 5",
    modelCatalog,
  },
  // 字面量类名（sender-flat-btn / sender-flat-model-label）由壳层 SenderLayout 的样式锚定，
  // 因此模型选择的故事统一嵌在真实壳层的 #footer 里。
  render: (args) => ({
    components: { ModelPicker, SenderLayout },
    setup() {
      const value = ref("");
      const open = ref(false);
      const onChange = (next: string) => {
        value.value = next;
      };
      const onOpen = (next: boolean) => {
        open.value = next;
      };
      return { args, value, open, onChange, onOpen };
    },
    template: `
      <SenderLayout :value="value" :on-change="onChange">
        <template #footer="{ defaultNode }">
          <div class="sender-footer-row">
            <div class="sender-footer-primary" />
            <div class="sender-footer-secondary">
              <ModelPicker v-bind="args" :open="open" @update:open="onOpen" />
              <component :is="defaultNode" />
            </div>
          </div>
        </template>
      </SenderLayout>
    `,
  }),
};

export default meta;
type Story = StoryObj<typeof meta>;

/** 默认收起态：品牌图标 + 当前模型名 + 下拉箭头。 */
export const Default: Story = {};

/** 菜单展开：按供应商分组罗列模型，当前模型带选中标记与上下文窗口。 */
export const MenuOpen: Story = {
  play: async ({ canvasElement }) => {
    const button = canvasElement.querySelector<HTMLButtonElement>('button[aria-label="选择模型"]');
    button?.click();
  },
};

/** 目录为空且非 Agent 会话：按钮禁用并提示先配置模型供应商。 */
export const NoModels: Story = {
  args: {
    model: "",
    modelLabel: "",
    modelCatalog: [],
  },
};

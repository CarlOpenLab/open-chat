import type { Meta, StoryObj } from "@storybook/vue3-vite";
import type { ModelCatalogEntry } from "../../composables/useChatModels";
import ChatInput from "./ChatInput.vue";

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

const meta: Meta<typeof ChatInput> = {
  title: "chat/ChatInput",
  component: ChatInput,
  args: {
    modelValue: "",
    loading: false,
    disabled: false,
    currentModel: "opencode/qwen3-coder",
    currentModelLabel: "Qwen3 Coder",
    modelCatalog,
    thinkingEnabled: false,
    fileModeEnabled: false,
    agentMode: true,
    agentAvailable: true,
    projectPath: "",
    projectPathOptions: [],
    projectPathEnabled: false,
    queuedMessages: [],
    queuePaused: false,
    runState: null,
    mode: "build",
    permission: "supervised",
    permissionLocked: false,
    pendingPermission: null,
    isOhMyPi: false,
    agentId: "claude",
    // ===== 受控业务数据（Phase 1 起由 useComposerData 承载，stories 直接 mock） =====
    gitWorkspace: null,
    gitBusy: false,
    projectPathPicking: false,
    skills: { project: [], global: [] },
    attachments: [],
  },
  argTypes: {
    runState: {
      control: "select",
      options: [null, "running", "requires_action", "idle"],
    },
    mode: { control: "select", options: ["build", "plan"] },
    permission: { control: "select", options: ["supervised", "auto", "full"] },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

/** 空闲输入区。 */
export const Idle: Story = {};

/** 运行中：展示停止按钮与运行状态标签。 */
export const Running: Story = {
  args: {
    loading: true,
    runState: "running",
    modelValue: "帮我重构这个模块",
  },
};

/** 等待权限确认：header 面板弹出授权请求。 */
export const PendingPermission: Story = {
  args: {
    loading: true,
    runState: "requires_action",
    pendingPermission: {
      id: "perm-1",
      version: "v2",
      permission: "bash",
      patterns: ["rm -rf node_modules"],
      metadata: { title: "执行终端命令" },
      options: [
        { optionId: "o1", name: "允许一次", kind: "allow_once" },
        { optionId: "o2", name: "始终允许", kind: "allow_always" },
        { optionId: "o3", name: "拒绝", kind: "reject_once" },
      ],
    },
  },
};

/** Git 仓库上下文：底部卡片展示项目目录 + 当前分支（dirty 带 *），gitBusy 可在 Controls 切换。 */
export const GitRepo: Story = {
  args: {
    projectPath: "/Users/carl/work/open-chat",
    projectPathOptions: ["/Users/carl/work/open-chat", "/Users/carl/work/notes"],
    projectPathEnabled: true,
    gitWorkspace: {
      isRepository: true,
      root: "/Users/carl/work/open-chat",
      currentBranch: "master",
      branches: ["master", "feat/chat-input-refactor", "fix/acp-migration"],
      dirty: true,
      detached: false,
    },
    gitBusy: false,
  },
};

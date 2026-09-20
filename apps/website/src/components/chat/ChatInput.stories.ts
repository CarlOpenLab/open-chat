import type { Meta, StoryObj } from "@storybook/vue3-vite";
import { ref } from "vue";
import type { ModelCatalogEntry } from "../../composables/useChatModels";
import type { StagedAttachment } from "../../composables/useComposerData";
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

/** 带待发送队列与已启用开关。 */
export const WithQueue: Story = {
  args: {
    thinkingEnabled: true,
    fileModeEnabled: true,
    projectPath: "/Users/carl/work/open-chat",
    projectPathOptions: ["/Users/carl/work/open-chat", "/Users/carl/work/notes"],
    projectPathEnabled: true,
    queuedMessages: [
      { id: "q1", content: "再补一组边界测试", attachments: [] },
      {
        id: "q2",
        content: "仅附件",
        attachments: [{ reference: "cc-attachment:x", name: "a.png" }],
      },
    ],
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

/** 斜杠建议：内置指令 + 项目 / 全局 skills 分组。 */
export const SlashSuggestions: Story = {
  args: {
    modelValue: "/",
    agentMode: true,
    skills: {
      project: [
        {
          name: "code-review",
          description: "审查当前改动的质量与风险",
          source: "project",
          scope: ".claude/skills",
        },
        {
          name: "gen-tests",
          description: "为变更文件补齐单元测试",
          source: "project",
          scope: ".claude/skills",
        },
      ],
      global: [
        {
          name: "explain",
          description: "解释选中代码的工作原理",
          source: "global",
          scope: "~/.claude/skills",
        },
      ],
    },
  },
};

/** 附件上传：render 包装承载受控 attachments，假异步 2 秒完成上传。 */
export const UploadingAttachments: Story = {
  render: (args) => ({
    components: { ChatInput },
    setup() {
      const attachments = ref<StagedAttachment[]>([
        {
          sourceKey: "done.png:1",
          reference: "mock:done.png",
          name: "done.png",
          isImage: true,
          previewUrl: "https://picsum.photos/seed/done/64",
          uploading: false,
        },
        {
          sourceKey: "uploading.png:2",
          reference: "",
          name: "uploading.png",
          isImage: true,
          previewUrl: "https://picsum.photos/seed/uploading/64",
          uploading: true,
        },
        {
          sourceKey: "failed.png:3",
          reference: "",
          name: "failed.png",
          isImage: true,
          previewUrl: "https://picsum.photos/seed/failed/64",
          uploading: false,
          error: "网关不可用",
        },
      ]);
      // 假上传：2 秒后给 uploading 项写 reference
      const onUpload = (files: File[]) => {
        for (const file of files) {
          const entry: StagedAttachment = {
            sourceKey: `${file.name}:${file.size}:${file.lastModified}`,
            reference: "",
            name: file.name,
            isImage: true,
            previewUrl: "https://picsum.photos/seed/new/64",
            uploading: true,
          };
          attachments.value.push(entry);
          setTimeout(() => {
            entry.reference = `mock:${file.name}`;
            entry.uploading = false;
            attachments.value = [...attachments.value];
          }, 2000);
        }
      };
      return { args, attachments, onUpload };
    },
    template: `
      <ChatInput
        v-bind="args"
        v-model:attachments="attachments"
        @attachments-upload="onUpload"
      />
    `,
  }),
  args: {
    agentMode: true,
  },
};

/** 队列行内编辑：play 点击首条消息的编辑按钮进入编辑态。 */
export const QueueEditing: Story = {
  args: {
    queuedMessages: [
      { id: "q1", content: "再补一组边界测试", attachments: [] },
      { id: "q2", content: "更新 README 的架构章节", attachments: [] },
    ],
  },
  play: async ({ canvasElement }) => {
    const button = canvasElement.querySelector<HTMLButtonElement>(
      'button[aria-label="编辑队列消息"]',
    );
    button?.click();
  },
};

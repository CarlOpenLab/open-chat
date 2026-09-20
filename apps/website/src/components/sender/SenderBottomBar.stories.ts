import type { Meta, StoryObj } from "@storybook/vue3-vite";
import { ref } from "vue";
import type { GitWorkspaceInfo } from "../../services/ai";
import SenderBottomBar from "./SenderBottomBar.vue";
import SenderLayout from "./SenderLayout.vue";

const cleanRepo: GitWorkspaceInfo = {
  isRepository: true,
  root: "/Users/carl/work/open-chat",
  currentBranch: "feat/chat-input-refactor",
  branches: ["master", "feat/chat-input-refactor", "fix/acp-migration"],
  dirty: false,
  detached: false,
};

const dirtyRepo: GitWorkspaceInfo = {
  ...cleanRepo,
  currentBranch: "master",
  dirty: true,
};

const meta: Meta<typeof SenderBottomBar> = {
  title: "sender/SenderBottomBar",
  component: SenderBottomBar,
  args: {
    projectPath: "/Users/carl/work/open-chat",
    projectPathOptions: [
      "/Users/carl/work/open-chat",
      "/Users/carl/work/notes",
      "/Users/carl/work/design-system",
    ],
    gitWorkspace: cleanRepo,
  },
  // 字面量类名（sender-bottom-row / sender-flat-btn / sender-flat-project 等）由壳层
  // SenderLayout 的样式锚定，因此底部行的故事统一嵌在真实壳层的 #bottom 里。
  render: (args) => ({
    components: { SenderBottomBar, SenderLayout },
    setup() {
      const value = ref("");
      const onChange = (next: string) => {
        value.value = next;
      };
      return { args, value, onChange };
    },
    template: `
      <SenderLayout :value="value" :on-change="onChange" :has-bottom-card="true">
        <template #footer="{ defaultNode }">
          <div class="sender-footer-row">
            <div class="sender-footer-primary" />
            <div class="sender-footer-secondary">
              <component :is="defaultNode" />
            </div>
          </div>
        </template>
        <template #bottom>
          <SenderBottomBar v-bind="args" />
        </template>
      </SenderLayout>
    `,
  }),
};

export default meta;
type Story = StoryObj<typeof meta>;

/** 非 Git 仓库：只有项目目录，没有分支段与分隔线。 */
export const ProjectPathOnly: Story = {
  args: {
    gitWorkspace: null,
  },
};

/** Git 仓库有改动：分支名带 `*` dirty 标记。 */
export const GitDirty: Story = {
  args: {
    gitWorkspace: dirtyRepo,
  },
};

/** 未选目录：展示占位文案，清除按钮隐藏。 */
export const NoProjectPath: Story = {
  args: {
    projectPath: "",
    projectPathOptions: [],
    gitWorkspace: null,
  },
};

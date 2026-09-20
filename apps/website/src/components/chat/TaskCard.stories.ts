import type { Meta, StoryObj } from "@storybook/vue3-vite";
import type { Task } from "../../services/taskStorage";
import TaskCard from "./TaskCard.vue";

/** 示例任务实体。 */
const baseTask: Task = {
  id: "task-1",
  title: "重构 sender 的 skill 选择交互",
  status: "doing",
  priority: "P1",
  tags: ["frontend", "ux"],
  dueAt: Date.now() + 86_400_000,
  description:
    "## 背景\n\n斜杠选择 skill 后输入区应为 tag 形态。\n\n## 验收标准\n- [ ] 选中后渲染为可关闭 tag\n- [ ] 提交时还原为 /name 参数",
  projectPath: "/Users/carl/work/open-chat",
  createdAt: Date.now() - 3_600_000,
  updatedAt: Date.now() - 60_000,
  sessionKeys: [],
};

const meta: Meta<typeof TaskCard> = {
  title: "chat/TaskCard",
  component: TaskCard,
  args: {
    task: baseTask,
    nowTick: Date.now(),
    sessionStatus: "idle",
    isOpen: false,
    editingTitle: false,
  },
  argTypes: {
    sessionStatus: {
      control: "select",
      options: ["idle", "running", "queued", "permission", "done", "stopped"],
    },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

/** 默认卡片。 */
export const Default: Story = {};

/** 会话运行中：展示忙碌徽标与耗时。 */
export const SessionBusy: Story = {
  args: {
    sessionStatus: "running",
    sessionBusyDuration: "12m",
  },
};

/** 会话出错（已终止）：徽标带错误提示。 */
export const SessionError: Story = {
  args: {
    sessionStatus: "stopped",
    sessionError: "上游模型请求超时",
  },
};

/** 展开态 + 标题编辑中。 */
export const OpenEditing: Story = {
  args: {
    isOpen: true,
    editingTitle: true,
  },
};

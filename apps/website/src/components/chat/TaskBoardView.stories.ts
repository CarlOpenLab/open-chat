import type { Meta, StoryObj } from "@storybook/vue3-vite";
import type { OpenChatConversation } from "../../composables/useChatPersistence";
import type { Task } from "../../services/taskStorage";
import type { SessionStatusSignals } from "../../utils/sessionStatus";
import TaskBoardView from "./TaskBoardView.vue";

const nowTick = Date.now();

/** 任务样例：同上，覆盖四列 + 归档列。 */
const task = (patch: Partial<Task> & Pick<Task, "id" | "title" | "status">): Task => ({
  priority: null,
  tags: [],
  dueAt: null,
  description: "",
  projectPath: null,
  createdAt: nowTick - 7_200_000,
  updatedAt: nowTick - 120_000,
  sessionKeys: [],
  ...patch,
});

const tasks: Task[] = [
  task({
    id: "board-1",
    title: "重构 sender 的 skill 选择交互",
    status: "todo",
    priority: "P1",
    tags: ["frontend", "ux"],
    dueAt: nowTick + 86_400_000,
    description: "斜杠选择 skill 后输入区应为 tag 形态，提交时还原为 /name。",
    projectPath: "/Users/carl/work/open-chat",
    createdAt: nowTick - 3_600_000,
  }),
  task({
    id: "board-2",
    title: "看板列拖拽落点修复",
    status: "doing",
    priority: "P0",
    tags: ["bug"],
    dueAt: nowTick - 86_400_000,
    description: "松手后卡片应落到悬停列，而不是相邻列。",
    sessionKeys: ["sess-run"],
  }),
  task({
    id: "board-3",
    title: "补齐 acp 迁移文档",
    status: "doing",
    tags: ["docs"],
    dueAt: nowTick,
    description: "覆盖握手流程、错误码与回滚步骤。",
    sessionKeys: ["sess-perm"],
  }),
  task({
    id: "board-4",
    title: "会话抽屉拆分为独立组件",
    status: "review",
    priority: "P2",
    tags: ["refactor"],
    projectPath: "/Users/carl/work/notes",
    description: "左任务详情 / 右对话两栏可独立演进。",
  }),
  task({
    id: "board-5",
    title: "虚拟滚动改造消息列表",
    status: "done",
    priority: "P3",
    tags: ["perf"],
    updatedAt: nowTick - 600_000,
  }),
  task({
    id: "board-6",
    title: "旧版输入区归档",
    status: "archived",
    priority: "P3",
  }),
];

const conversationList: OpenChatConversation[] = [
  {
    key: "sess-run",
    label: "看板拖拽会话",
    projectPath: "/Users/carl/work/open-chat",
  },
  {
    key: "sess-perm",
    label: "文档迁移会话",
    projectPath: "/Users/carl/work/notes",
    queuedMessages: [
      { id: "q1", content: "再补一节错误码表", createdAt: nowTick, attachments: [] },
    ],
  },
];

const idleSignals: SessionStatusSignals = {
  busyStates: {},
  permissionKeys: new Set<string>(),
  stoppedKeys: new Set<string>(),
};

const meta: Meta<typeof TaskBoardView> = {
  title: "chat/TaskBoardView",
  component: TaskBoardView,
  args: {
    tasks,
    conversationList,
    openTaskId: "",
    statusSignals: idleSignals,
    projectPathOptions: ["/Users/carl/work/open-chat", "/Users/carl/work/notes"],
    currentProjectPath: "/Users/carl/work/open-chat",
    dark: false,
    loading: false,
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

/** 默认看板：四列（归档列默认隐藏）+ 工具栏统计。 */
export const Default: Story = {};

/** 空看板：四列空态与快捷创建入口，工具栏指标为 0。 */
export const Empty: Story = {
  args: {
    tasks: [],
    conversationList: [],
  },
};

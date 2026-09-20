import type { Meta, StoryObj } from "@storybook/vue3-vite";
import { Button } from "antdv-next";
import { fn } from "storybook/test";
import { ref } from "vue";
import type { OpenChatConversation } from "../../composables/useChatPersistence";
import type { AgentView } from "../../services/acp";
import type { Task } from "../../services/taskStorage";
import type { SessionStatusSignals } from "../../utils/sessionStatus";
import TaskDetailDrawer from "./TaskDetailDrawer.vue";

const NOW = Date.now();
const DAY = 24 * 60 * 60 * 1000;

/** 示例供应商：API（内置）+ ACP 就绪 / 缺适配器 / 未安装。 */
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
];

const projectPathOptions = [
  "/Users/carl/Desktop/carl-github/open-chat",
  "/Users/carl/Desktop/carl-github/notes",
];

/** 会话池：由任务的 sessionKeys 挑选并排序，模拟真实数据形态。 */
const conversations: OpenChatConversation[] = [
  {
    key: "conv-running",
    label: "实现任务详情抽屉的会话列表拆分",
    agentId: "claude",
    updatedAt: NOW - 60 * 1000,
    messages: [{ message: { role: "user", content: "把会话列表抽成独立组件" } }],
  },
  {
    key: "conv-permission",
    label: "批量整理 components/chat 目录",
    agentId: "codex",
    updatedAt: NOW - 5 * 60 * 1000,
    messages: [{ message: { role: "user", content: "按功能拆分目录" } }],
  },
  {
    key: "conv-stopped",
    label: "修复 ACP 会话恢复后丢历史",
    modelId: "gpt-5-codex",
    updatedAt: NOW - 42 * 60 * 1000,
    lastError: "上游模型请求超时",
    messages: [{ message: { role: "assistant", content: "连接中断，请重试。" } }],
  },
  {
    key: "conv-done",
    label: "梳理看板状态推导规则",
    modelId: "claude-sonnet-4.5",
    updatedAt: NOW - 2 * 60 * 60 * 1000,
    messages: [
      { message: { role: "user", content: "看板的六列怎么来的？" } },
      { message: { role: "assistant", content: "按运行信号优先级推导。" } },
    ],
  },
  {
    key: "conv-idle",
    label: "了解一下抽屉会话行的样式 token",
    agentId: "claude",
    updatedAt: NOW - 5 * 60 * 60 * 1000,
    messages: [],
  },
];

/** 会话运行信号：驱动徽标与耗时（运行中的会话已跑 2 分 05 秒）。 */
const statusSignals: SessionStatusSignals = {
  busyStates: { "conv-running": { startedAt: NOW - 125_000 } },
  permissionKeys: new Set(["conv-permission"]),
  stoppedKeys: new Set<string>(),
};

/** 示例任务：可拆分出会话列表的任务详情。 */
const baseTask: Task = {
  id: "task-1",
  title: "抽出任务抽屉的会话列表组件",
  status: "doing",
  priority: "P1",
  tags: ["refactor", "chat"],
  dueAt: NOW + DAY,
  description:
    "## 背景\n\nTaskDetailDrawer 模板里会话列表与表单混在一起。\n\n## 验收标准\n- [ ] 会话行 / 会话列表 / 表单拆成独立组件\n- [ ] 行为与拆分前完全一致",
  projectPath: "/Users/carl/Desktop/carl-github/open-chat",
  createdAt: NOW - 6 * 60 * 60 * 1000,
  updatedAt: NOW - 5 * 60 * 1000,
  sessionKeys: [],
};

const meta: Meta<typeof TaskDetailDrawer> = {
  title: "chat/TaskDetailDrawer",
  component: TaskDetailDrawer,
  // 本地维护 open / task / 当前会话：抽屉可关闭后再打开，表单保存与选中会话即时反映
  render: (args) => {
    // args 类型由 @storybook/vue3-vite 从 SFC 推导，这里按抽屉 props 收窄一次取初值
    const initial = args as Partial<{
      open: boolean;
      task: Task | null;
      activeSessionKey: string;
    }>;
    return {
      components: { Button, TaskDetailDrawer },
      setup() {
        const open = ref<boolean>(initial.open ?? false);
        const task = ref<Task | null>(initial.task ?? null);
        const activeSessionKey = ref<string>(initial.activeSessionKey ?? "");
        const updateTask = (_id: string, patch: Partial<Task>) => {
          task.value = { ...(task.value as Task), ...patch };
        };
        return { args, open, task, activeSessionKey, updateTask };
      },
      template: `
        <div class="p-4">
          <Button @click="open = true">打开任务抽屉</Button>
          <TaskDetailDrawer
            v-bind="args"
            :open="open"
            :task="task"
            :active-session-key="activeSessionKey"
            @close="open = false"
            @update-task="updateTask"
            @open-session="activeSessionKey = $event"
          />
        </div>
      `,
    };
  },
  args: {
    open: true,
    task: baseTask,
    conversationList: conversations,
    statusSignals,
    nowTick: NOW,
    split: true,
    activeSessionKey: "",
    projectPathOptions,
    agents,
    activeAgentId: "api",
    onCreateSession: fn(),
    onDeleteSession: fn(),
    onRenameSession: fn(),
    onAgentChange: fn(),
  },
  argTypes: {
    split: { control: "boolean", description: "双栏布局：左任务信息｜右 AI 对话" },
    activeAgentId: { control: "select", options: agents.map((agent) => agent.id) },
    activeSessionKey: { control: "select", options: conversations.map((conv) => String(conv.key)) },
    task: { control: "object", description: "任务实体（null 时抽屉内不渲染内容）" },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

/** 打开的空任务：会话区显示虚线空态与新建按钮。 */
export const OpenTaskNoSessions: Story = {};

/** 运行中会话：蓝色徽标转圈并展示已耗时（2:05），卡片高亮。 */
export const RunningSession: Story = {
  args: {
    task: { ...baseTask, sessionKeys: ["conv-running", "conv-idle"] },
    activeSessionKey: "conv-running",
  },
};

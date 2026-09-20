import type { BubbleItemType } from "@antdv-next/x";
import type { Meta, StoryObj } from "@storybook/vue3-vite";
import type {
  ContentMessage,
  FileChangeMessage,
  ReasoningMessage,
  ToolMessage,
  TranscriptAttachment,
  TranscriptMessage,
  UserMessage,
} from "@cc-heart/open-chat-types";
import type { WebSearchSourceItem } from "../../services/ai";
import ChatMessages from "./ChatMessages.vue";

/** 固定基准时间：让历史消息耗时/顺序可复现。 */
const baseTime = Date.parse("2026-09-20T10:00:00+08:00");

const userMessage = (
  id: string,
  content: string,
  attachments?: TranscriptAttachment[],
): UserMessage => ({
  id,
  timestamp: baseTime,
  role: "user",
  content,
  ...(attachments ? { attachments } : {}),
});

const contentMessage = (id: string, content: string): ContentMessage => ({
  id,
  timestamp: baseTime + 30_000,
  role: "content",
  content,
});

const reasoningMessage = (id: string, content: string): ReasoningMessage => ({
  id,
  timestamp: baseTime + 1_000,
  role: "reasoning",
  content,
});

const toolMessage = (
  id: string,
  name: string,
  input: unknown,
  output: string,
  durationMs: number,
): ToolMessage => ({
  id,
  timestamp: baseTime + 2_000,
  role: "tool",
  name,
  status: "completed",
  input,
  output,
  durationMs,
});

const fileChangeMessage = (patch: string): FileChangeMessage => ({
  id: "f1",
  timestamp: baseTime + 3_000,
  role: "fileChange",
  path: "apps/website/src/components/sender/SenderLayout.vue",
  additions: 12,
  deletions: 4,
  status: "completed",
  patch,
});

interface BubbleExtra {
  status?: BubbleItemType["status"];
  reasoningDone?: boolean;
  chatError?: string;
  chatNotices?: string[];
  turnDurationMs?: number;
}

/** 单条扁平片段 → 气泡项：键与 extraInfo 结构跟 modelMessagesToBubbleItems 一致。 */
const bubbleItem = (
  messageId: string,
  fragment: TranscriptMessage,
  extra: BubbleExtra = {},
): BubbleItemType => ({
  key: `${messageId}::${fragment.id}`,
  role: fragment.role === "user" ? "user" : "assistant",
  status: extra.status ?? "success",
  content: fragment.role === "user" || fragment.role === "content" ? fragment.content : "",
  extraInfo: {
    messageRole: fragment.role,
    message: fragment,
    ...(extra.reasoningDone !== undefined ? { reasoningDone: extra.reasoningDone } : {}),
    ...(extra.chatError ? { chatError: extra.chatError } : {}),
    ...(extra.chatNotices ? { chatNotices: extra.chatNotices } : {}),
    ...(extra.turnDurationMs ? { turnDurationMs: extra.turnDurationMs } : {}),
    ...(fragment.role === "user" || fragment.role === "content"
      ? { attachments: fragment.attachments }
      : {}),
  },
});

/** 一轮问答：用户提问 + assistant 正文。 */
const shortTurn: BubbleItemType[] = [
  bubbleItem(
    "u1",
    userMessage("u1", "ChatMessages 拆到什么程度了？还有哪些状态该收进 composable？"),
  ),
  bubbleItem(
    "a1",
    contentMessage(
      "c1",
      [
        "已经拆到只剩三件事：",
        "",
        "- 展示项分组：相邻活动气泡合并成一组",
        "- 逐条 UI 状态机：展开态 + 回合/思考计时（`useMessageActivityState`）",
        "- 分支渲染：用户气泡 / 正文气泡 / 活动行各一个组件",
      ].join("\n"),
    ),
  ),
];

const diffPatch = [
  "@@ -41,7 +41,11 @@",
  '-        <span class="sender-draft-text">{{ draft }}</span>',
  '+        <span class="sender-draft-tag inline-flex items-center gap-1">',
  "+          {{ draft }}",
  '+          <button type="button" @click="clearDraft">×</button>',
  "+        </span>",
].join("\n");

/** 带活动的一轮：思考 → 读文件 → 改文件 → 跑校验 → 正文。 */
const activityTurn: BubbleItemType[] = [
  bubbleItem("u2", userMessage("u2", "把 sender 的斜杠选择改成 tag 形态，改完跑一下 vp check。")),
  bubbleItem(
    "a2",
    reasoningMessage(
      "r1",
      [
        "先确认草稿的渲染路径：",
        "1. ChatInput 把草稿写进 draft 状态",
        "2. SenderLayout 用 draft 渲染 tag 形态",
      ].join("\n"),
    ),
    { reasoningDone: true },
  ),
  bubbleItem(
    "a2",
    toolMessage(
      "t1",
      "read_file",
      { path: "apps/website/src/components/sender/SenderLayout.vue" },
      "apps/website/src/components/sender/SenderLayout.vue · 412 行",
      720,
    ),
  ),
  bubbleItem("a2", fileChangeMessage(diffPatch)),
  bubbleItem(
    "a2",
    toolMessage(
      "t2",
      "bash",
      { command: "vp check --fix apps/website/src/components/sender/SenderLayout.vue" },
      "pass: Found no warnings, lint errors, or type errors in 1 file",
      1840,
    ),
  ),
  bubbleItem(
    "a2",
    contentMessage(
      "c2",
      [
        "改好了，草稿现在渲染成可关闭的 tag：",
        "",
        "1. 选中 skill 后写入 `draft`",
        "2. `SenderLayout` 的 slot 内容按 tag 形态渲染",
        "3. 提交时还原为 `/name` 参数",
      ].join("\n"),
    ),
  ),
];

/** 流式一轮：思考未完成自动展开，右侧列尾显示"工作中"。 */
const streamingTurn: BubbleItemType[] = [
  bubbleItem("u3", userMessage("u3", "顺手把 activity 的展开态也收敛一下。")),
  bubbleItem("a3", reasoningMessage("r2", "用户在流式中手动折叠过思考，自动展开要尊重这个选择…"), {
    status: "updating",
    reasoningDone: false,
  }),
  bubbleItem("a3", contentMessage("c3", "正在把展开态收敛到 `useMessageActivityState`"), {
    status: "updating",
  }),
];

const longAnswer = [
  "## 重构结论",
  "",
  "拆分后 `ChatMessages` 只负责三件事，UI 状态机整体收进 composable：",
  "",
  "- 用户气泡：`UserMessageBubble`",
  "- 正文气泡：`AssistantBubble` + `AssistantMessageContent`",
  "- 列尾计时：`WorkingIndicator`",
  "",
  "### 计时口径",
  "",
  "| 场景 | 起点 | 终点 |",
  "| --- | --- | --- |",
  "| 回合 | 首次出现 / 重新生成 | 流式结束 |",
  "| 思考 | 首次看到思考片段 | `reasoningDone` |",
  "",
  "### useMessageActivityState",
  "",
  "```ts",
  "const { isSummaryExpanded, isItemExpandedIds } = useMessageActivityState({",
  "  displayItems,",
  "  conversationKey: () => props.conversationKey,",
  "  workingStartedAtMs: () => props.workingStartedAtMs,",
  "});",
  "```",
  "",
  "### 活动列表的折叠 diff",
  "",
  "```diff",
  "@@ -118,6 +118,7 @@",
  "-  const summaryExpandedMap = ref<Record<string, boolean>>({});",
  "-  const itemExpandedMap = ref<Record<string, string[]>>({});",
  "+  // 状态机整体移到 composables/useMessageActivityState.ts",
  "```",
  "",
  "行为与重构前完全一致：展开态、自动收敛、耗时记账都没有改动。",
].join("\n");

const searchSources: WebSearchSourceItem[] = [
  {
    key: "s1",
    title: "Vue 3 scoped CSS 与 keyframes 的作用域规则",
    // url 留空：Storybook 内不发起 favicon 外网请求，图标走 Globe 兜底
    url: "",
    description: "scoped 样式里的 @keyframes 会跟随作用域重命名，仅在同一个 style 块内改写引用。",
  },
  {
    key: "s2",
    title: "Storybook 9：Vue 3 + defineProps 类型推导",
    url: "",
    description: "CSF3 的 args 与组件 props 类型对齐，argTypes 可声明枚举控件。",
  },
];

/** 长回答：表格、fenced code、diff 代码块 + 联网来源。 */
const longTurn: BubbleItemType[] = [
  bubbleItem("u6", userMessage("u6", "把这次重构的结论和计时口径整理成一份说明。")),
  bubbleItem("a6", contentMessage("c6", longAnswer), { chatNotices: ["已启用联网搜索"] }),
];

const meta: Meta<typeof ChatMessages> = {
  title: "chat/ChatMessages",
  component: ChatMessages,
  args: {
    showWelcome: false,
    bubbleItems: shortTurn,
    conversationKey: "story-conversation",
    projectPath: "/Users/carl/work/open-chat",
    projectPathOptions: ["/Users/carl/work/open-chat", "/Users/carl/work/ai-hub"],
  },
  argTypes: {
    // 明暗由 Storybook 主题工具栏驱动（与 App.vue 同源），不单独暴露控件
    dark: { control: false, description: "跟随主题工具栏（与 App.vue 同源）" },
    working: { control: "boolean" },
    bubbleItems: { control: false },
  },
  render: (args, context) => ({
    components: { ChatMessages },
    setup: () => ({ args, dark: context.globals.theme === "dark" }),
    template: '<ChatMessages v-bind="args" :dark="dark" />',
  }),
};

export default meta;
type Story = StoryObj<typeof meta>;

/** 欢迎空状态：展示项目目录选择，没有消息时整列居中。 */
export const Welcome: Story = {
  args: { showWelcome: true, bubbleItems: [] },
};

/** 带活动的一轮：思考、读文件、文件修改、跑校验合并成一个活动列表，默认折叠为分割线。 */
export const ActivityTurn: Story = {
  args: { bubbleItems: activityTurn },
};

/** 流式回合：思考条目自动展开，列尾"工作中 · Xs"每秒跳动。 */
export const Streaming: Story = {
  args: {
    bubbleItems: streamingTurn,
    working: true,
    workingStartedAtMs: Date.now() - 12_000,
  },
};

/** 长回答：表格、fenced code、diff 代码块与联网来源，明暗两套主题下都应可读。 */
export const LongAnswer: Story = {
  args: {
    bubbleItems: longTurn,
    searchResultsByMessageId: { [String(longTurn[1].key)]: searchSources },
  },
};

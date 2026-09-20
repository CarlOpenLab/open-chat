import type { Meta, StoryObj } from "@storybook/vue3-vite";
import { computed, provide, ref } from "vue";
import type { TranscriptMessage } from "@cc-heart/open-chat-types";
import ActivityList from "./ActivityList.vue";
import { buildActivityEntries } from "./activityEntry";
import { markdownThemeKey, type MarkdownTheme } from "./markdownTheme";

/** 固定时间基准，避免 story 每次渲染的时间戳漂移。 */
const T0 = Date.UTC(2026, 8, 20, 9, 30, 0);

/** 一次完整活动的典型顺序：思考 → 命令 → 计划 → 文件修改。 */
const activityMessages: TranscriptMessage[] = [
  {
    id: "r1",
    timestamp: T0,
    role: "reasoning",
    content:
      "用户希望给 sender 加一个斜杠指令浮层。\n\n先确认现状：\n\n1. `SenderLayout` 负责壳层与 footer 工具行；\n2. `QuickCommands` 已经是纯展示组件，只差一个挂载点。\n\n所以改动集中在 header 插槽，不需要碰服务层。",
  },
  {
    id: "t1",
    timestamp: T0 + 4_000,
    role: "tool",
    name: "bash",
    status: "completed",
    durationMs: 4_200,
    input: { command: "pnpm --filter website test", timeoutMs: 120_000 },
    output: JSON.stringify({ stdout: "✓ 42 passed (3.1s)", stderr: "", exitCode: 0 }, null, 2),
  },
  {
    id: "p1",
    timestamp: T0 + 9_000,
    role: "plan",
    entries: [
      { content: "梳理 SenderLayout 的插槽契约", status: "completed" },
      { content: "在 footer 行接入 QuickCommands 浮层", status: "in_progress" },
      { content: "补齐 Storybook 用例并检查暗色主题", status: "pending" },
    ],
  },
  {
    id: "f1",
    timestamp: T0 + 12_000,
    role: "fileChange",
    path: "apps/website/src/components/sender/SenderLayout.vue",
    additions: 24,
    deletions: 6,
    status: "completed",
    patch: [
      "@@ -42,7 +42,12 @@ const props = withDefaults(defineProps<Props>(), {",
      "   hasBottomCard: false,",
      " });",
      "+",
      "+/** 浮层插槽：无内容时不渲染，避免空 div 撑开间距。 */",
      "+const hasHeader = computed(() => Boolean(slots.header));",
      " ",
      " const emit = defineEmits<Emits>();",
    ].join("\n"),
  },
];

/** 正在执行：思考未完成 + 命令执行中（摘要行显示「正在执行」，条目显示脉冲状态）。 */
const runningMessages: TranscriptMessage[] = [
  {
    id: "r-live",
    timestamp: T0,
    role: "reasoning",
    content:
      "正在比对两个版本的差异……\n\n先看 `UnifiedDiff` 的 patch 归一化，再确认新增分组是否会影响 key 稳定性。",
  },
  {
    id: "t-live",
    timestamp: T0 + 800,
    role: "tool",
    name: "bash",
    status: "running",
    input: { command: "pnpm --filter website test --watch" },
  },
];

/** 取一份与运行时同源的条目 id，用于在 story 里展开指定条目。 */
const entryIdsOf = (messages: TranscriptMessage[]): string[] =>
  buildActivityEntries(messages, { streaming: false }).map((entry) => entry.id);

type ActivityListArgs = Partial<{
  messages: TranscriptMessage[];
  streaming: boolean;
  reasoningDone: boolean;
  summaryExpanded: boolean;
  itemExpandedIds: string[];
  reasoningDurationMs: number;
}>;

/** 交互壳：summaryExpanded / itemExpandedIds 由本地状态承载（对应上游的两个 v-model）。 */
const renderActivity =
  (initial: { summaryExpanded?: boolean; itemExpandedIds?: string[] }) =>
  (args: ActivityListArgs) => ({
    components: { ActivityList },
    setup() {
      const summaryExpanded = ref(initial.summaryExpanded ?? false);
      const itemExpandedIds = ref<string[]>([...(initial.itemExpandedIds ?? [])]);
      return { args, summaryExpanded, itemExpandedIds };
    },
    template: `
      <ActivityList
        v-bind="args"
        v-model:summary-expanded="summaryExpanded"
        v-model:item-expanded-ids="itemExpandedIds"
      />
    `,
  });

const meta: Meta<typeof ActivityList> = {
  title: "chat/ActivityList",
  component: ActivityList,
  // 应用内高亮主题由 ChatMessages provide；story 里改由主题工具栏驱动，保证明暗都正确。
  decorators: [
    (story, context) => ({
      setup() {
        provide(
          markdownThemeKey,
          computed<MarkdownTheme>(() => (context.globals.theme === "dark" ? "dark" : "light")),
        );
      },
      components: { story },
      template: "<story />",
    }),
  ],
  args: {
    messages: activityMessages,
    streaming: false,
    reasoningDone: true,
    summaryExpanded: false,
    itemExpandedIds: [],
    reasoningDurationMs: 8_600,
  },
  argTypes: {
    messages: { control: false },
    summaryExpanded: { control: "boolean" },
    itemExpandedIds: { control: "object" },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

/** 折叠摘要：只显示摘要行（已执行：N 次命令，M 次思考…）。 */
export const CollapsedSummary: Story = {};

/** 展开全部条目：思考 markdown + bash JSON 输出 + 计划步骤 + 文件变更 diff。 */
export const ExpandedDetails: Story = {
  render: renderActivity({ summaryExpanded: true, itemExpandedIds: entryIdsOf(activityMessages) }),
};

/** 流式思考：streaming + reasoningDone=false，条目显示「正在思考」与脉冲状态。 */
export const StreamingReasoning: Story = {
  args: { messages: runningMessages, streaming: true, reasoningDone: false },
  render: renderActivity({ summaryExpanded: true, itemExpandedIds: entryIdsOf(runningMessages) }),
};

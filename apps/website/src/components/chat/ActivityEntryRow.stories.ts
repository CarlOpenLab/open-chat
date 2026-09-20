import type { Meta, StoryObj, StoryContext } from "@storybook/vue3-vite";
import { computed, ref } from "vue";
import type { TranscriptMessage } from "@cc-heart/open-chat-types";
import ActivityEntryRow from "./ActivityEntryRow.vue";
import { buildActivityEntries, type ActivityEntry } from "./activityEntry";
import type { MarkdownTheme } from "./markdownTheme";

/** 固定时间基准，避免 story 每次渲染的时间戳漂移。 */
const T0 = Date.UTC(2026, 8, 20, 9, 30, 0);

/** 用与 ActivityList 相同的派生逻辑构造条目，保证 story 数据与运行时一致。 */
const entryOf = (messages: TranscriptMessage[], index = 0): ActivityEntry =>
  buildActivityEntries(messages, { streaming: false })[index];

const reasoningText =
  "先确认 `SenderLayout` 的插槽契约：\n\n- header 插槽由业务侧提供，壳层只负责定位；\n- footer 行的字面量类名（`sender-footer-row`）是样式锚点，不能改名。\n\n所以改动集中在壳层，不需要碰服务层。";

/** 思考条目：展开后走 markdown 渲染。 */
const reasoningEntry = entryOf([
  { id: "r1", timestamp: T0, role: "reasoning", content: reasoningText },
]);

/** 工具条目：参数 + JSON 输出两个可复制分区。 */
const toolEntry = entryOf([
  {
    id: "t1",
    timestamp: T0,
    role: "tool",
    name: "bash",
    status: "completed",
    durationMs: 4_200,
    input: { command: "pnpm --filter website test", timeoutMs: 120_000 },
    output: JSON.stringify({ stdout: "✓ 42 passed (3.1s)", stderr: "", exitCode: 0 }, null, 2),
  },
]);

/** 文件修改条目：路径行 + 统一 diff。 */
const fileChangeEntry = entryOf([
  {
    id: "f1",
    timestamp: T0,
    role: "fileChange",
    path: "apps/website/src/components/chat/ActivityList.vue",
    additions: 24,
    deletions: 6,
    status: "completed",
    patch: [
      "@@ -112,6 +112,9 @@ const entries = computed<ActivityEntry[]>(() => {",
      "   for (const message of props.messages) {",
      '     if (message.role === "reasoning") {',
      "+      list.push(reasoningActivityEntry(message, list.length));",
      '     } else if (message.role === "tool") {',
      "       list.push(toolActivityEntry(message));",
      "     }",
    ].join("\n"),
  },
]);

/** 四种状态字形的对照组：等待 / 运行中 / 成功 / 失败。 */
const statusEntries: ActivityEntry[] = [
  entryOf([{ id: "t-pending", timestamp: T0, role: "tool", name: "read_file", status: "pending" }]),
  entryOf([
    {
      id: "t-running",
      timestamp: T0,
      role: "tool",
      name: "bash",
      status: "running",
      input: { command: "pnpm --filter website test --watch" },
    },
  ]),
  entryOf([
    {
      id: "t-done",
      timestamp: T0,
      role: "tool",
      name: "bash",
      status: "completed",
      durationMs: 1_200,
    },
  ]),
  entryOf([
    {
      id: "t-error",
      timestamp: T0,
      role: "tool",
      name: "bash",
      status: "error",
      error: "Command failed with exit code 1\nENOSPC: no space left on device",
    },
  ]),
];

type RowArgs = Partial<{
  entry: ActivityEntry;
  expanded: boolean;
  streaming: boolean;
  reasoningContent: string;
  reasoningLive: boolean;
  reasoningStreaming: { hasNextChunk: boolean; enableAnimation: boolean; tail?: boolean };
  copiedSection: string;
}>;

/** 交互壳：expanded / copiedSection 由本地状态承载（对应上游的展开与复制反馈）。 */
const renderRow = (args: RowArgs, context: StoryContext) => ({
  components: { ActivityEntryRow },
  setup() {
    const expanded = ref(args.expanded ?? false);
    const copied = ref("");
    const theme = computed<MarkdownTheme>(() =>
      context.globals.theme === "dark" ? "dark" : "light",
    );
    return { args, expanded, copied, theme };
  },
  template: `
    <ActivityEntryRow
      v-bind="args"
      :theme="theme"
      :expanded="expanded"
      :copied-section="copied"
      @toggle="expanded = !expanded"
      @copy="copied = args.entry.id"
    />
  `,
});

const meta: Meta<typeof ActivityEntryRow> = {
  title: "chat/ActivityEntryRow",
  component: ActivityEntryRow,
  args: {
    entry: reasoningEntry,
    expanded: false,
    streaming: false,
    reasoningContent: reasoningText,
    reasoningLive: false,
    reasoningStreaming: { hasNextChunk: false, enableAnimation: false, tail: false },
    copiedSection: "",
  },
  argTypes: {
    entry: { control: false },
    reasoningStreaming: { control: false },
    expanded: { control: "boolean" },
    copiedSection: { control: false },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

/** 工具展开：参数与输出两个可复制分区。 */
export const ToolSectionsExpanded: Story = {
  args: { entry: toolEntry, reasoningContent: "", expanded: true },
  render: renderRow,
};

/** 文件变更展开：路径行 + 统一 diff 高亮。 */
export const FileChangeDiff: Story = {
  args: { entry: fileChangeEntry, reasoningContent: "", expanded: true },
  render: renderRow,
};

/** 状态字形：等待（灰点）/ 运行中（脉冲点）/ 成功（✓）/ 失败（×）。 */
export const StatusGlyphs: Story = {
  render: (_args, context) => ({
    components: { ActivityEntryRow },
    setup() {
      const theme = computed<MarkdownTheme>(() =>
        context.globals.theme === "dark" ? "dark" : "light",
      );
      return { theme, statusEntries };
    },
    template: `
      <div class="flex w-full min-w-0 flex-col gap-4">
        <ActivityEntryRow
          v-for="entry in statusEntries"
          :key="entry.id"
          :entry="entry"
          :expanded="false"
          :streaming="false"
          reasoning-content=""
          :reasoning-live="false"
          :reasoning-streaming="{ hasNextChunk: false, enableAnimation: false, tail: false }"
          :theme="theme"
          copied-section=""
        />
      </div>
    `,
  }),
};

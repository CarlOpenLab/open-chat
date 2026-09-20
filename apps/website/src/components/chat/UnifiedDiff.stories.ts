import type { Meta, StoryObj } from "@storybook/vue3-vite";
import UnifiedDiff from "./UnifiedDiff.vue";

/** 裸 hunk（无文件头）：组件会补 `--- /+++` 头。 */
const singleHunk = [
  "@@ -118,6 +118,7 @@ const displayItems = computed<BubbleItemType[]>(() => {",
  "   const grouped: BubbleItemType[] = [];",
  "   let pending: BubbleItemType[] = [];",
  "-  const flush = () => grouped.push(buildActivityGroup(pending));",
  "+  const flush = () => {",
  "+    if (pending.length) grouped.push(buildActivityGroup(pending));",
  "+    pending = [];",
  "+  };",
  "   for (const item of items) {",
].join("\n");

/** 删除文件：`+++ /dev/null` + 全为删除行。 */
const deletedFile = [
  "diff --git a/apps/website/src/components/chat/LegacyTimeline.vue b/apps/website/src/components/chat/LegacyTimeline.vue",
  "deleted file mode 100644",
  "--- a/apps/website/src/components/chat/LegacyTimeline.vue",
  "+++ /dev/null",
  "@@ -1,6 +0,0 @@",
  '-<script setup lang="ts">',
  '-import type { TranscriptTimelineItem } from "@cc-heart/open-chat-types";',
  "-",
  "-defineProps<{ items: TranscriptTimelineItem[] }>();",
  "-</script>",
  "-",
].join("\n");

const meta: Meta<typeof UnifiedDiff> = {
  title: "chat/UnifiedDiff",
  component: UnifiedDiff,
  args: {
    patch: singleHunk,
    path: "apps/website/src/components/chat/ChatMessages.vue",
  },
  argTypes: {
    theme: {
      control: false,
      description: "由主题工具栏驱动（活动列表内由注入的 markdownThemeKey 决定）",
    },
  },
  render: (args, context) => {
    const theme = context.globals.theme === "dark" ? "dark" : "light";
    return {
      components: { UnifiedDiff },
      setup: () => ({ args, theme }),
      template: `<div class="w-full max-w-[820px]"><UnifiedDiff v-bind="args" :theme="theme" /></div>`,
    };
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

/** 单 hunk：三增一删，无文件头时自动补 `--- /+++`。 */
export const SingleHunk: Story = {};

/** 删除文件：`+++ /dev/null`，整块都是删除行。 */
export const DeletedFile: Story = { args: { patch: deletedFile } };

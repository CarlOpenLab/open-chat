import type { Meta, StoryObj } from "@storybook/vue3-vite";
import type { SkillsIndex } from "../../services/ai";
import QuickCommands from "./QuickCommands.vue";

/** 示例 skills：项目 / 全局各一条，展示分组与来源徽标。 */
const skills: SkillsIndex = {
  project: [
    {
      name: "review-pr",
      description: "审查 PR 的代码质量、安全性与测试覆盖",
      source: "project",
      scope: ".claude/skills",
    },
    {
      name: "write-test",
      description: "为改动补充单元测试与边界用例",
      source: "project",
      scope: ".claude/skills",
    },
  ],
  global: [
    {
      name: "commit-helper",
      description: "生成规范的 conventional commit message",
      source: "global",
      scope: "~/.claude/skills",
    },
  ],
};

const meta: Meta<typeof QuickCommands> = {
  title: "chat/QuickCommands",
  component: QuickCommands,
  args: {
    modelValue: "/",
    skills,
    isOhMyPi: false,
  },
  argTypes: {
    modelValue: {
      control: "text",
      description: "输入区内容；以 / 开头时展示建议面板",
    },
    isOhMyPi: { control: "boolean" },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

/** 默认：输入 / 唤起全部指令与 skills。 */
export const Default: Story = {};

/** 过滤：斜杠后输入过滤词。 */
export const Filtered: Story = {
  args: { modelValue: "/rev" },
};

/** Oh My Pi：Goal / Review 置顶并带专属徽标。 */
export const OhMyPi: Story = {
  args: { isOhMyPi: true },
};

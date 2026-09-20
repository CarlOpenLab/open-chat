import type { Meta, StoryObj } from "@storybook/vue3-vite";
import { ref } from "vue";
import type { SkillsIndex } from "../../services/ai";
import QuickCommands from "../chat/QuickCommands.vue";
import SenderLayout from "./SenderLayout.vue";

/** 示例 skills：供 SlashFloat story 的 QuickCommands 消费。 */
const skills: SkillsIndex = {
  project: [
    {
      name: "code-review",
      description: "审查当前改动的质量与风险",
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
};

const meta: Meta<typeof SenderLayout> = {
  title: "sender/SenderLayout",
  component: SenderLayout,
  args: {
    value: "",
    loading: false,
    disabled: false,
    hasBottomCard: false,
    headerVariant: "card",
    headerNavigable: false,
    placeholder: "做什么都可以... 输入 / 唤起指令与技能",
  },
  argTypes: {
    headerVariant: { control: "select", options: ["card", "float"] },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * 基础组合：footer 工具行 + 底部卡片，业务内容全部由 slots 提供。
 * 字面量类名（sender-footer-row / sender-flat-btn / sender-bottom-row）由壳层样式锚定。
 */
export const Composed: Story = {
  render: (args) => ({
    components: { SenderLayout },
    setup() {
      const value = ref("帮我看看这个报错");
      const onChange = (v: string) => (value.value = v);
      return { args, value, onChange };
    },
    template: `
      <SenderLayout v-bind="args" :value="value" :on-change="onChange" has-bottom-card>
        <template #footer="{ defaultNode }">
          <div class="sender-footer-row">
            <div class="sender-footer-primary">
              <span style="font-size: 12px; color: gray; padding: 0 8px;">业务 chips 经 slot 组合</span>
            </div>
            <div class="sender-footer-secondary">
              <button type="button" class="sender-flat-btn sender-flat-btn-model">
                <span class="sender-flat-model-label">Qwen3 Coder</span>
              </button>
              <component :is="defaultNode" />
            </div>
          </div>
        </template>
        <template #bottom>
          <div class="sender-bottom-row">
            <button type="button" class="sender-flat-btn">
              <span class="sender-flat-label">open-chat</span>
            </button>
            <span class="sender-flat-sep" />
            <button type="button" class="sender-flat-btn">
              <span class="sender-flat-label">master *</span>
            </button>
            <div class="min-w-0 flex-1" />
          </div>
        </template>
      </SenderLayout>
    `,
  }),
};

/** header 浮层（card 变体）：壳层绘制白底卡片，内容可以是任意业务面板。 */
export const HeaderPanel: Story = {
  render: (args) => ({
    components: { SenderLayout },
    setup() {
      const value = ref("");
      const onChange = (v: string) => (value.value = v);
      return { args, value, onChange };
    },
    template: `
      <SenderLayout v-bind="args" :value="value" :on-change="onChange">
        <template #header>
          <div style="padding: 10px 12px; font-size: 12px;">
            <div style="font-weight: 600; margin-bottom: 4px;">需要授权：执行终端命令</div>
            <div style="opacity: 0.65;">rm -rf node_modules</div>
            <div style="display: flex; gap: 6px; margin-top: 8px;">
              <button type="button" style="border: 1px solid currentColor; border-radius: 6px; padding: 2px 10px; font-size: 11px;">允许一次</button>
              <button type="button" style="border: 1px solid currentColor; border-radius: 6px; padding: 2px 10px; font-size: 11px;">拒绝</button>
            </div>
          </div>
        </template>
        <template #footer="{ defaultNode }">
          <div class="sender-footer-row">
            <div class="sender-footer-primary" />
            <div class="sender-footer-secondary">
              <component :is="defaultNode" />
            </div>
          </div>
        </template>
      </SenderLayout>
    `,
  }),
};

/** header 面板导航：headerNavigable 时壳层提供左右箭头，点击经 headerNav 事件上抛。 */
export const HeaderNavigation: Story = {
  args: { headerNavigable: true },
  render: (args) => ({
    components: { SenderLayout },
    setup() {
      const value = ref("");
      const onChange = (v: string) => (value.value = v);
      const panel = ref(0);
      const titles = ["队列（2 条待发送）", "附件（1 张图片）"];
      const onHeaderNav = (d: -1 | 1) => {
        panel.value = (panel.value + d + titles.length) % titles.length;
      };
      return { args, value, onChange, panel, titles, onHeaderNav };
    },
    template: `
      <SenderLayout v-bind="args" :value="value" :on-change="onChange" @header-nav="onHeaderNav">
        <template #header>
          <div style="padding: 12px; font-size: 12px;">{{ titles[panel] }}</div>
        </template>
        <template #footer="{ defaultNode }">
          <div class="sender-footer-row">
            <div class="sender-footer-primary" />
            <div class="sender-footer-secondary">
              <component :is="defaultNode" />
            </div>
          </div>
        </template>
      </SenderLayout>
    `,
  }),
};

/**
 * float 变体 + 真实业务组件：斜杠建议浮在输入框上方，
 * QuickCommands 自绘卡片表面（底色 / 边框 / 投影与 card 浮层同一套 token）。
 * 在输入框键入 / 可看到浮层弹出。
 */
export const SlashFloat: Story = {
  args: { headerVariant: "float" },
  render: (args) => ({
    components: { SenderLayout, QuickCommands },
    setup() {
      const value = ref("/");
      const onChange = (v: string) => (value.value = v);
      return { args, value, onChange, skills };
    },
    template: `
      <SenderLayout v-bind="args" :value="value" :on-change="onChange">
        <template #header>
          <QuickCommands :model-value="value" :skills="skills" @select="() => {}" />
        </template>
        <template #footer="{ defaultNode }">
          <div class="sender-footer-row">
            <div class="sender-footer-primary" />
            <div class="sender-footer-secondary">
              <component :is="defaultNode" />
            </div>
          </div>
        </template>
      </SenderLayout>
    `,
  }),
};

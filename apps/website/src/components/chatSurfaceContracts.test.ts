import { describe, expect, test } from "vite-plus/test";
import app from "../App.vue?raw";
import chat from "./Chat.vue?raw";
import header from "./chat/ChatHeader.vue?raw";
import sidebar from "./chat/ChatSidebar.vue?raw";
import input from "./chat/ChatInput.vue?raw";
import emptyState from "./chat/EmptyState.vue?raw";
import messages from "./chat/ChatMessages.vue?raw";
import starterPrompts from "./chat/StarterPrompts.vue?raw";

const chatComponentPaths = Object.keys(
  import.meta.glob("./chat/*.vue", { eager: true, import: "default", query: "?raw" }),
);

describe("Chat product surface contracts", () => {
  test("does not expose the removed sharing feature", () => {
    const combined = `${chat}\n${header}`;

    expect(combined).not.toMatch(/ShareConversationModal|shareOpen|@share|Share2|分享/);
    expect(chatComponentPaths).not.toContain("./chat/ShareConversationModal.vue");
  });

  test("landing and auth pages are removed", () => {
    const pagePaths = Object.keys(
      import.meta.glob("../pages/*.vue", { eager: true, import: "default", query: "?raw" }),
    );
    const componentPaths = Object.keys(
      import.meta.glob("./landing/*.vue", { eager: true, import: "default", query: "?raw" }),
    ).concat(
      Object.keys(
        import.meta.glob("./auth/*.vue", { eager: true, import: "default", query: "?raw" }),
      ),
    );

    expect(pagePaths).not.toContain("../pages/LandingPage.vue");
    expect(pagePaths).not.toContain("../pages/AuthPage.vue");
    expect(componentPaths).toHaveLength(0);
  });

  test("Waku-style sidebar keeps new-task and search commands", () => {
    expect(sidebar).toContain("新任务");
    expect(sidebar).toContain("搜索");
  });

  test("Waku-style composer keeps model chip and circular send action", () => {
    expect(input).toContain("currentModel");
    expect(input).toContain("defaultNode");
  });

  test("sidebar renders two-line conversation entries with relative time", () => {
    // labelRender 是两行条目的唯一渲染入口，退回 #iconRender 插槽即视为回归
    expect(sidebar).toContain("labelRender");
    expect(sidebar).toContain("conversation-entry-title");
    expect(sidebar).toContain("conversation-entry-meta");
    expect(sidebar).toContain("formatRelativeTime");
    // 进行中条目的计时来自父级传入的 busyKey / busySince
    expect(sidebar).toContain("busyKey");
    expect(sidebar).toContain("formatElapsedDuration");
    expect(sidebar).not.toContain("#iconRender");
    // 条目副行不再展示文件夹图标与 open-chat 工作区名
    expect(sidebar).not.toContain("projectName");
    expect(sidebar).not.toContain("conversation-entry-folder");
  });

  test("header exposes workspace diff stats without the session info popover", () => {
    expect(header).toContain("diffAdded");
    expect(header).toContain("diffRemoved");
    // 右上角的会话信息 Info 浮层已按需求移除
    expect(header).not.toContain("Popover");
    expect(header).not.toMatch(/\bInfo\b/);
    expect(chat).toContain("collectWorkspaceDiffStats");
    expect(chat).toContain(":diff-added");
  });

  test("composer keeps reasoning/search chips on the left and the model picker on the right", () => {
    expect(input).toContain("reasoningMenu");
    expect(input).toContain("REASONING_LABEL");
    expect(input).toContain("联网搜索");
    // 模型选择挪到右排（发送按钮旁），下拉朝右上展开
    expect(input).toContain('placement="topRight"');
    // sender 下方的 open-chat / 本地 / 模型状态条已按需求移除
    expect(input).not.toContain("composer-status");
    expect(input).not.toContain("projectName");
    // 截图中免责声明也不再出现
    expect(input).not.toMatch(/可能会出错/);
  });

  test("conversation groups start expanded instead of collapsed", () => {
    // Conversations 的 expandedKeys 默认是空数组，开了 collapsible 后所有日期分组
    // 一上来全是折叠的，一条会话都看不见。必须传受控的 groupable 才能默认展开。
    expect(sidebar).toContain("collapsedGroups");
    expect(sidebar).toContain('groupable="groupable"');
    expect(sidebar).not.toContain("{ collapsible: true }");
  });

  test("sidebar fills its shell and collapses to zero width when closed", () => {
    // aside 是 .sidebar-shell（display:flex）的子项，缺了 w-full 就会收缩到内容宽度
    expect(sidebar).toMatch(/class="chat-sidebar[^"]*\bw-full\b/);
    // 收起时 shell 本身必须归零，否则桌面端留下一条空白列
    expect(chat).toContain("conversationsOpen ? sidebarWidth : 0");
  });

  test("empty state uses the Waku asterisk prompt", () => {
    expect(emptyState).toContain("Asterisk");
    expect(emptyState).toContain("中构建什么？");
    // ProjectNameSelector 的 1px 虚线（dash 1 / gap 2）用背景渐变实现，
    // text-decoration: dotted 控制不了点距
    expect(emptyState).toContain("project-name");
    expect(emptyState).toContain("linear-gradient");
  });

  test("sidebar collapse animates and content is clipped, not squashed", () => {
    // shell 宽度过渡出滑动动画；内层保持固定宽度，收起时从右侧裁掉而不是压扁换行
    expect(chat).toContain("transition: width");
    expect(chat).toContain("sidebar-clip");
    // 拖拽调宽时必须禁掉过渡，否则手柄跟不上鼠标
    expect(chat).toContain("sidebar-shell-resizing");
  });

  test("theme supports system / light / dark modes", () => {
    // 未显式选择时跟随系统，且监听系统明暗变化
    expect(app).toContain('"system"');
    expect(app).toContain("prefers-color-scheme");
    expect(app).toContain('addEventListener("change"');
    expect(chat).toContain("themeModeChange");
  });

  test("starter prompts are pills inside the empty state, not cards above the composer", () => {
    // 三张卡片挤在 composer 上方视觉太重；胶囊建议放在空状态标题下方
    expect(messages).toContain("StarterPrompts");
    expect(starterPrompts).toContain("rounded-full");
    expect(input).not.toContain("StarterPrompts");
  });

  test("sidebar list keeps the Waku session-card metrics", () => {
    // SIDEBAR_SESSION_CARD_HEIGHT = 51（py 7×2 + 标题 18 + gap 4 + 副行 15），
    // 行距 SIDEBAR_SESSION_ROW_GAP = 1，整列 px 10 内缩要和新任务/搜索行同轴
    expect(sidebar).toContain("min-height: 51px");
    expect(sidebar).toContain("padding: 0 10px 10px");
    expect(sidebar).toMatch(/\.antd-conversations-list\)\s*\{[^}]*gap:\s*0/);
  });
});

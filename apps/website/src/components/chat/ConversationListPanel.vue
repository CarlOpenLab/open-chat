<script setup lang="ts">
/**
 * 会话列表（展示层）：纯对话页左侧的会话导航。
 * 使用 @antdv-next/x 的 Conversations 组件，按日期分组；
 * 状态与操作全部来自 `useWorkspace()`。
 */
import { computed, h, nextTick, ref } from "vue";
import { Conversations } from "@antdv-next/x";
import type { ConversationItemRenderInfo, ConversationItemType } from "@antdv-next/x";
import { Archive, Pin, SquarePen, Trash2 } from "@lucide/vue";
import { Input, message } from "antdv-next";
import { resolveConversationGroup } from "../../utils/sessionDateGroup";
import { useWorkspace } from "../../pages/workspace";

const ws = useWorkspace();

/** 内联重命名：替换该行 label 为输入框，Enter/失焦确认，Esc 取消 */
const renamingKey = ref("");
const renameDraft = ref("");
const renameInput = ref<InstanceType<typeof Input>>();

const beginRename = (item: ConversationItemType) => {
  renamingKey.value = String(item.key);
  renameDraft.value = String(item.label ?? "");
  void nextTick(() => {
    const el = renameInput.value?.$el?.querySelector?.("input");
    el?.focus();
    el?.select();
  });
};

const confirmRename = () => {
  const key = renamingKey.value;
  const next = renameDraft.value.trim();
  renamingKey.value = "";
  if (key && next) ws.handleSidebarRename(key, next);
};

const cancelRename = () => {
  renamingKey.value = "";
};

const items = computed<ConversationItemType[]>(() =>
  ws.visibleConversationList.map((conversation) => ({
    key: String(conversation.key),
    label: conversation.label || "新对话",
    group: resolveConversationGroup(conversation.updatedAt, conversation.group),
    timestamp: conversation.updatedAt,
  })),
);

const labelRender = (item: ConversationItemType, _info: ConversationItemRenderInfo) => {
  if (String(item.key) !== renamingKey.value) return item.label;
  return h(Input, {
    ref: renameInput,
    value: renameDraft.value,
    size: "small",
    "onUpdate:value": (v: string) => {
      renameDraft.value = v;
    },
    onPressEnter: confirmRename,
    onBlur: confirmRename,
    onKeydown: (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        cancelRename();
      }
    },
  });
};

/** 菜单图标统一 14px 见方：lucide 图标按 em 伸缩，用 font-size + size 保持等比，
 *  避免只压 h/w 把 24×24 视口挤成非等比形状。 */
const MENU_ICON_CLASS = "menu-icon";
const menuIcon = (component: typeof SquarePen) =>
  h(component, { class: MENU_ICON_CLASS, size: 14, "stroke-width": 1.8 });

const menu = (conversation: ConversationItemType) => ({
  items: [
    { key: "rename", label: "重命名", icon: menuIcon(SquarePen) },
    { key: "pin", label: "置顶 / 取消置顶", icon: menuIcon(Pin) },
    { key: "archive", label: "归档", icon: menuIcon(Archive) },
    { type: "divider" as const },
    {
      key: "delete",
      label: "删除",
      danger: true,
      icon: menuIcon(Trash2),
    },
  ],
  onClick: ({ key }: { key: string | number }) => {
    const conversationKey = String(conversation.key);
    if (key === "rename") return beginRename(conversation);
    if (key === "pin") return ws.handlePinConversation(conversationKey);
    if (key === "archive") {
      ws.handleArchiveConversation(conversationKey);
      message.success("对话已归档");
      return;
    }
    if (key === "delete") return ws.handleDeleteConversation(conversationKey);
  },
});
</script>

<template>
  <aside class="flex min-h-0 w-full flex-1 flex-col overflow-hidden" aria-label="会话列表">
    <Conversations
      class="conversation-list min-h-0 flex-1"
      :items="items"
      :active-key="ws.currentConversationKey"
      :menu="menu"
      :label-render="labelRender"
      groupable
      @active-change="ws.handleActiveChange($event)"
    />
  </aside>
</template>

<style scoped>
/* 会话列表形态对齐参考设计（memoh 侧栏）：
   小号分组标签 + 纯文本行（无卡片描边），悬停出操作，当前会话仅文字提亮。 */
.conversation-list {
  padding: 0 6px 8px;
}

.conversation-list :deep(.antd-conversations-group-title) {
  height: auto;
  min-height: 24px;
  padding: 4px 8px 2px;
}

.conversation-list :deep(.antd-conversations-group-label) {
  color: var(--brand-muted-strong);
  font-size: 11px;
  line-height: 16px;
}

.conversation-list :deep(.antd-conversations-item) {
  height: 32px;
  min-height: 32px;
  border-radius: 6px;
  padding: 0 8px;
  font-size: 13px;
  line-height: 20px;
}

.conversation-list :deep(.antd-conversations-label) {
  font-size: 13px;
}

/* 菜单图标：14px 等比、固定宽高，保证四行图标左缘与颜色一致（删除行只换色不换形）。 */
.conversation-list :deep(.menu-icon) {
  flex: none;
  width: 14px;
  height: 14px;
  color: currentColor;
}
</style>

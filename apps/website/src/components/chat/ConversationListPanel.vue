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

const menu = (conversation: ConversationItemType) => ({
  items: [
    { key: "rename", label: "重命名", icon: h(SquarePen, { class: "!h-[13px] !w-[13px]" }) },
    { key: "pin", label: "置顶 / 取消置顶", icon: h(Pin, { class: "!h-[13px] !w-[13px]" }) },
    { key: "archive", label: "归档", icon: h(Archive, { class: "!h-[13px] !w-[13px]" }) },
    { type: "divider" as const },
    {
      key: "delete",
      label: "删除",
      danger: true,
      icon: h(Trash2, { class: "!h-[13px] !w-[13px]" }),
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
      :creation="{ label: '新对话', onClick: () => ws.handleNewConversation() }"
      @active-change="ws.handleActiveChange($event)"
    />
  </aside>
</template>

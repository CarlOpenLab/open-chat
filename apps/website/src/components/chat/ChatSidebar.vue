<script setup lang="ts">
import type { ConversationItemType, ConversationsProps } from "@antdv-next/x";
import { Conversations } from "@antdv-next/x";
import {
  Archive,
  ArrowLeft,
  ArrowRight,
  Ellipsis,
  LoaderCircle,
  Moon,
  PanelLeftClose,
  Pencil,
  Pin,
  Search,
  Settings,
  SquarePen,
  Sun,
  Trash2,
} from "@lucide/vue";
import { Input, Modal, Tooltip, message } from "antdv-next";
import { computed, h, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { OpenChatConversation } from "../../composables/useChatPersistence";
import { resolveConversationGroup } from "../../utils/sessionDateGroup";
import { formatElapsedDuration, formatRelativeTime } from "../../utils/relativeTime";

interface Props {
  open: boolean;
  conversationList: OpenChatConversation[];
  currentKey: string;
  canGoBack?: boolean;
  canGoForward?: boolean;
  /** 正在请求的会话 key，该条目显示「工作中」与已运行时长 */
  busyKey?: string;
  /** 当前请求开始时间，用于「工作中」条目的计时 */
  busySince?: number;
  /** 当前是否深色主题，底栏的主题切换按钮据此换图标 */
  dark?: boolean;
}

interface Emits {
  (e: "toggleSidebar"): void;
  (e: "toggleTheme"): void;
  (e: "newConversation"): void;
  (e: "openSearch"): void;
  (e: "openSettings"): void;
  (e: "navigateBack"): void;
  (e: "navigateForward"): void;
  (e: "activeChange", key: string): void;
  (e: "rename", key: string, title: string): void;
  (e: "pin", key: string): void;
  (e: "archive", key: string): void;
  (e: "delete", key: string): void;
}

const props = withDefaults(defineProps<Props>(), {
  canGoBack: false,
  canGoForward: false,
  busyKey: "",
  busySince: 0,
  dark: true,
});
const emit = defineEmits<Emits>();

const search = ref("");
const renameOpen = ref(false);
const renameKey = ref("");
const renameDraft = ref("");

// 条目副行的时间需要随时间走动：进行中每秒刷新（要显示秒），空闲时 30 秒刷新即可。
const nowTick = ref(Date.now());
let tickTimer: ReturnType<typeof setInterval> | undefined;

const stopTick = () => {
  if (!tickTimer) return;
  clearInterval(tickTimer);
  tickTimer = undefined;
};

const startTick = (periodMs: number) => {
  stopTick();
  tickTimer = setInterval(() => {
    nowTick.value = Date.now();
  }, periodMs);
};

const DATE_GROUP_LABEL: Record<string, string> = {
  置顶: "置顶",
  今天: "今天",
  昨天: "昨天",
  本周: "本周",
  本月: "本月",
  今年: "今年",
  更早: "更早",
};

const GROUP_WEIGHT: Record<string, number> = {
  置顶: 0,
  今天: 1,
  昨天: 2,
  本周: 3,
  本月: 4,
  今年: 5,
  更早: 6,
};

const groupedConversations = computed<ConversationItemType[]>(() => {
  const query = search.value.trim().toLocaleLowerCase();
  const list = props.conversationList
    .map((item) => ({
      ...item,
      group: resolveConversationGroup(item.updatedAt, item.group),
    }))
    .filter((item) =>
      query
        ? String(item.label ?? "")
            .toLocaleLowerCase()
            .includes(query)
        : true,
    );

  return list.sort((a, b) => {
    const ga = GROUP_WEIGHT[a.group ?? "今天"] ?? 6;
    const gb = GROUP_WEIGHT[b.group ?? "今天"] ?? 6;
    if (ga !== gb) return ga - gb;
    return String(b.updatedAt ?? 0) - String(a.updatedAt ?? 0);
  });
});

const hasConversations = computed(() => props.conversationList.length > 0);

/**
 * Conversations 的 expandedKeys 默认是空数组，只要开了 collapsible，
 * 「今天 / 昨天」这些分组一上来就是折叠的、一条会话都看不见。
 * 这里改成受控：默认全展开，只记住用户手动折叠过的分组，新出现的分组也是展开的。
 */
const collapsedGroups = ref<string[]>([]);

const groupNames = computed(() =>
  Array.from(new Set(groupedConversations.value.map((item) => item.group ?? "今天"))),
);

const groupable = computed<ConversationsProps["groupable"]>(() => ({
  collapsible: true,
  expandedKeys: groupNames.value.filter((name) => !collapsedGroups.value.includes(name)),
  onExpand: (keys) => {
    collapsedGroups.value = groupNames.value.filter((name) => !keys.includes(name));
  },
}));

/**
 * Waku 条目为两行：标题 + （助手名 / 相对时间）。
 * 进行中的会话把时间换成「工作中 · 已运行时长」并附一个转圈图标。
 */
const conversationLabelRender: ConversationsProps["labelRender"] = (item) => {
  const conversation = item as OpenChatConversation;
  const busy = Boolean(props.busyKey) && String(item.key) === props.busyKey;
  const title = String(conversation.label ?? "").trim() || "新对话";

  return h("span", { class: "conversation-entry" }, [
    // 首行：标题占满，进行中时右端挂一个珊瑚色转圈（与 Waku 位置一致）
    h("span", { class: "conversation-entry-head" }, [
      h("span", { class: "conversation-entry-title" }, title),
      busy ? h(LoaderCircle, { class: "conversation-entry-spinner" }) : null,
    ]),
    h("span", { class: "conversation-entry-meta" }, [
      // 副行只保留助手名（若有）与时间；助手名同时充当把时间推到右端的弹性占位
      h("span", { class: "conversation-entry-project" }, conversation.assistant?.name ?? ""),
      h(
        "span",
        { class: busy ? "conversation-entry-time is-busy" : "conversation-entry-time" },
        busy
          ? `工作中 · ${formatElapsedDuration(nowTick.value - (props.busySince || nowTick.value))}`
          : formatRelativeTime(conversation.updatedAt as number | undefined, nowTick.value),
      ),
    ]),
  ]);
};

const handleActiveChange: ConversationsProps["onActiveChange"] = (key) => {
  emit("activeChange", String(key));
};

const openRename = (item: ConversationItemType) => {
  renameKey.value = item.key;
  renameDraft.value = String(item.label ?? "").trim();
  renameOpen.value = true;
};

const confirmRename = () => {
  const title = renameDraft.value.trim();
  if (!renameKey.value || !title) {
    message.warning("请输入对话名称");
    return;
  }
  emit("rename", renameKey.value, title);
  renameOpen.value = false;
};

const conversationMenu: ConversationsProps["menu"] = (item) => ({
  trigger: () =>
    h(
      "button",
      {
        type: "button",
        class: "conversation-menu-trigger",
        "aria-label": "打开对话操作菜单",
      },
      [h(Ellipsis)],
    ),
  items: [
    { key: "rename", label: "重命名", icon: h(Pencil) },
    { key: "pin", label: item.group === "置顶" ? "取消置顶" : "置顶对话", icon: h(Pin) },
    { key: "archive", label: "归档对话", icon: h(Archive) },
    { type: "divider" },
    { key: "delete", label: "删除对话", icon: h(Trash2), danger: true },
  ],
  onClick: ({ key }) => {
    if (key === "rename") openRename(item);
    if (key === "pin") emit("pin", item.key);
    if (key === "archive") emit("archive", item.key);
    if (key === "delete") emit("delete", item.key);
  },
});

const iconButtonClass =
  "grid h-[26px] w-[26px] flex-none place-items-center rounded-[6px] border-0 bg-transparent p-0 text-brand-muted-strong cursor-pointer hover:bg-brand-surface-subtle hover:text-brand-foreground active:opacity-80";

/* 新任务是侧栏唯一的「主操作」：带边框的软按钮，与下面的幽灵行拉开层级 */
const newTaskRowClass =
  "flex h-[32px] w-full flex-none items-center gap-[8px] rounded-[8px] border border-solid border-brand-border bg-transparent px-[9px] text-left text-[13px] font-medium text-brand-foreground cursor-pointer transition-colors duration-150 hover:border-brand-border-strong hover:bg-brand-surface-subtle active:opacity-80";

const actionRowClass =
  "flex h-[32px] w-full flex-none items-center gap-[10px] rounded-[7px] border-0 bg-transparent px-1 text-left text-[13px] text-brand-muted cursor-pointer hover:bg-brand-surface-subtle hover:text-brand-foreground active:opacity-80";

const handleShortcut = (event: KeyboardEvent) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "k") {
    event.preventDefault();
    emit("openSearch");
  }
  if (event.key === "Escape") {
    renameOpen.value = false;
  }
};

watch(
  () => Boolean(props.busyKey),
  (busy) => {
    nowTick.value = Date.now();
    startTick(busy ? 1000 : 30000);
  },
  { immediate: true },
);

onMounted(() => window.addEventListener("keydown", handleShortcut));
onBeforeUnmount(() => {
  window.removeEventListener("keydown", handleShortcut);
  stopTick();
});
</script>

<template>
  <aside
    class="chat-sidebar relative z-sidebar flex h-full min-h-0 w-full flex-col overflow-hidden bg-brand-sidebar"
    :class="open ? 'border-r border-r-solid border-r-brand-border' : ''"
    aria-label="会话导航"
  >
    <!-- Waku sidebar titlebar：48px，折叠按钮 + 历史导航 -->
    <div class="flex h-[48px] flex-none items-center gap-[2px] px-[10px]">
      <button
        type="button"
        class="grid h-[26px] w-[26px] place-items-center rounded-[6px] border-0 bg-transparent p-0 text-brand-muted-strong hover:bg-brand-surface-subtle hover:text-brand-foreground"
        :aria-label="open ? '收起侧边栏' : '展开侧边栏'"
        @click="emit('toggleSidebar')"
      >
        <PanelLeftClose :class="open ? '' : 'rotate-180'" />
      </button>
      <button
        type="button"
        class="grid h-[26px] w-[26px] place-items-center rounded-[6px] border-0 bg-transparent p-0 text-brand-muted-strong"
        :class="
          canGoBack ? 'hover:bg-brand-surface-subtle hover:text-brand-foreground' : 'opacity-35'
        "
        :disabled="!canGoBack"
        aria-label="返回上一个会话"
        @click="emit('navigateBack')"
      >
        <ArrowLeft class="!h-[14px] !w-[14px]" />
      </button>
      <button
        type="button"
        class="grid h-[26px] w-[26px] place-items-center rounded-[6px] border-0 bg-transparent p-0 text-brand-muted-strong"
        :class="
          canGoForward ? 'hover:bg-brand-surface-subtle hover:text-brand-foreground' : 'opacity-35'
        "
        :disabled="!canGoForward"
        aria-label="前进到下一个会话"
        @click="emit('navigateForward')"
      >
        <ArrowRight class="!h-[14px] !w-[14px]" />
      </button>
    </div>

    <!-- 新任务 / 搜索 -->
    <!-- 动作行紧贴 titlebar，搜索行下方留 10px（SIDEBAR_SEARCH_BOTTOM_GAP） -->
    <div class="flex flex-none flex-col gap-[4px] px-[10px] pb-[10px]">
      <button type="button" :class="newTaskRowClass" @click="emit('newConversation')">
        <SquarePen class="!h-[14px] !w-[14px] flex-none text-brand-accent" />
        <span class="min-w-0 flex-1 truncate">新任务</span>
      </button>
      <button type="button" :class="actionRowClass" @click="emit('openSearch')">
        <span class="grid h-5 w-5 flex-none place-items-center">
          <Search class="!h-[15px] !w-[15px]" />
        </span>
        <span class="min-w-0 flex-1 truncate">搜索</span>
        <kbd
          class="flex h-[18px] flex-none items-center rounded-[4px] border border-solid border-brand-border bg-transparent px-[5px] text-[10px] tracking-[0.5px] text-brand-muted-strong [font-family:inherit]"
          >⌘K</kbd
        >
      </button>
    </div>

    <!-- 会话列表（按日期分组） -->
    <div class="conversation-scroll relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
      <!-- 空列表：安静的两行文案，靠上放置，不用图标撑场面 -->
      <div
        v-if="!hasConversations"
        class="flex flex-col items-center gap-[3px] px-6 pt-[56px] text-center"
      >
        <span class="text-[12px] text-brand-muted">还没有对话</span>
        <span class="text-[11px] text-brand-ghost">点击「新任务」开始</span>
      </div>
      <Conversations
        v-else
        :items="groupedConversations"
        :active-key="currentKey"
        :groupable="groupable"
        :menu="conversationMenu"
        :label-render="conversationLabelRender"
        @active-change="handleActiveChange"
      />
    </div>

    <!-- 底栏：设置在左，主题切换在右，两端平衡 -->
    <div class="flex h-[40px] flex-none items-center px-[10px]">
      <Tooltip title="设置">
        <button
          type="button"
          :class="iconButtonClass"
          aria-label="打开设置"
          @click="emit('openSettings')"
        >
          <Settings class="!h-[14px] !w-[14px]" />
        </button>
      </Tooltip>
      <div class="flex-1" />
      <Tooltip :title="dark ? '切换到浅色' : '切换到深色'">
        <button
          type="button"
          :class="iconButtonClass"
          aria-label="切换主题"
          @click="emit('toggleTheme')"
        >
          <Sun v-if="dark" class="!h-[14px] !w-[14px]" />
          <Moon v-else class="!h-[14px] !w-[14px]" />
        </button>
      </Tooltip>
    </div>

    <Modal
      v-model:open="renameOpen"
      title="重命名对话"
      ok-text="保存"
      cancel-text="取消"
      :width="360"
      @ok="confirmRename"
    >
      <Input
        v-model:value="renameDraft"
        autofocus
        aria-label="对话名称"
        placeholder="输入对话名称"
        @press-enter="confirmRename"
      />
    </Modal>
  </aside>
</template>

<style scoped>
/* 保留原因：以下全部是 antd/x Conversations 内部类（.antd-*）与滚动条伪元素的
   :deep 覆盖，无法迁移为模板工具类。 */
/* Waku 侧栏整列（含新任务/搜索行）都是 px 10 内缩，会话列表必须同轴 */
.chat-sidebar :deep(.antd-conversations) {
  min-height: 100%;
  padding: 0 10px 10px;
}
/* 行距只由 SIDEBAR_SESSION_ROW_GAP = 1 决定，清掉组件自带的 gap / 顶部留白 */
.chat-sidebar :deep(.antd-conversations-list) {
  padding-top: 0;
  gap: 0;
}
/* session_group_header()：h 28 / px 8 / 12.5px medium / text_tertiary */
.chat-sidebar :deep(.antd-conversations-group-title) {
  height: 28px;
  min-height: 28px;
  align-items: center;
  margin-top: 10px;
  padding: 0 8px;
  color: var(--brand-muted-strong);
  font-size: 12.5px;
  font-weight: 500;
  line-height: 28px;
}
/* Waku 的折叠箭头紧跟分组名（gap 5），且只在分组 hover 时显形 */
.chat-sidebar :deep(.antd-conversations-group-label) {
  flex: none;
}
.chat-sidebar :deep(.antd-conversations-group-collapse-trigger) {
  margin-inline-start: 5px;
  color: var(--brand-ghost);
  opacity: 0;
  transition: opacity 120ms ease;
}
.chat-sidebar
  :deep(.antd-conversations-group-title:hover .antd-conversations-group-collapse-trigger) {
  opacity: 1;
}
/* SIDEBAR_SESSION_CARD_HEIGHT = 51 = py 7×2 + 标题行 18 + gap 4 + 副行 15，
   行间距 SIDEBAR_SESSION_ROW_GAP = 1 */
.chat-sidebar :deep(.antd-conversations-item) {
  min-height: 51px;
  align-items: flex-start;
  margin-bottom: 1px;
  padding-block: 7px;
  padding-inline: 8px;
  border: 0;
  border-radius: 7px;
  color: var(--brand-muted);
  font-size: 13.5px;
  transition:
    background 160ms ease,
    color 160ms ease;
}

/* Waku 两行条目：第一行标题，第二行工作区名 + 时间 */
.chat-sidebar :deep(.conversation-entry) {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 4px;
}
.chat-sidebar :deep(.conversation-entry-head) {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 6px;
}
.chat-sidebar :deep(.conversation-entry-title) {
  overflow: hidden;
  min-width: 0;
  flex: 1 1 auto;
  /* 标题恒用主文字色（Waku 的 text），与灰阶副行形成两级层次 */
  color: var(--brand-foreground);
  font-size: 13.5px;
  line-height: 18px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.chat-sidebar :deep(.conversation-entry-meta) {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 5px;
  color: var(--brand-muted-strong);
  font-size: 11.5px;
  font-weight: 400;
  line-height: 15px;
}
.chat-sidebar :deep(.conversation-entry-project) {
  overflow: hidden;
  min-width: 0;
  flex: 1 1 auto;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 闲置条目的时间比项目名更暗（text_ghost），进行中时提到 text_tertiary */
.chat-sidebar :deep(.conversation-entry-time) {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: none;
  color: var(--brand-ghost);
  white-space: nowrap;
}
.chat-sidebar :deep(.conversation-entry-time.is-busy) {
  color: var(--brand-muted-strong);
}
.chat-sidebar :deep(.conversation-entry-spinner) {
  width: 12px;
  height: 12px;
  flex: none;
  color: var(--brand-accent);
  animation: conversation-spin 900ms linear infinite;
}
@keyframes conversation-spin {
  to {
    transform: rotate(360deg);
  }
}
.chat-sidebar :deep(.antd-conversations-item:hover) {
  background: var(--brand-surface-subtle);
  color: var(--brand-foreground);
}
/* Waku 里选中 / hover / 按下都是同一层 6% 中性色，不加粗 */
.chat-sidebar :deep(.antd-conversations-item-active) {
  background: var(--brand-surface-subtle);
  color: var(--brand-foreground);
}
.chat-sidebar :deep(.antd-conversations-item:focus-visible) {
  outline: 2px solid var(--brand-ring);
  outline-offset: 1px;
}
.chat-sidebar :deep(.conversation-menu-trigger) {
  display: inline-grid;
  width: 28px;
  height: 28px;
  place-items: center;
  padding: 5px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--brand-muted-strong);
  cursor: pointer;
  opacity: 0;
  transition:
    background 160ms ease,
    color 160ms ease,
    opacity 160ms ease;
}
.chat-sidebar :deep(.conversation-menu-trigger svg) {
  width: 16px;
  height: 16px;
}
.chat-sidebar :deep(.antd-conversations-item:hover .conversation-menu-trigger),
.chat-sidebar :deep(.antd-conversations-item-active .conversation-menu-trigger),
.chat-sidebar :deep(.conversation-menu-trigger:focus-visible) {
  opacity: 1;
}
.chat-sidebar :deep(.conversation-menu-trigger:hover) {
  background: var(--brand-surface-subtle);
  color: var(--brand-foreground);
}
.chat-sidebar .conversation-scroll {
  scrollbar-width: thin;
  scrollbar-color: var(--brand-border-strong) transparent;
}
</style>

<script setup lang="ts">
import {
  Download,
  MessageSquare,
  Moon,
  PanelLeft,
  PanelRight,
  Search,
  Settings2,
  SquarePen,
  Sun,
  Trash2,
} from "@lucide/vue";
import { Input } from "antdv-next";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { OpenChatConversation } from "../../composables/useChatPersistence";

interface Props {
  open: boolean;
  conversationList: OpenChatConversation[];
  dark: boolean;
}

interface Emits {
  (e: "update:open", value: boolean): void;
  (e: "newConversation"): void;
  (e: "openSettings"): void;
  (e: "toggleTheme"): void;
  (e: "toggleSidebar"): void;
  (e: "toggleRightPanel"): void;
  (e: "exportHistory"): void;
  (e: "clearHistory"): void;
  (e: "selectConversation", key: string): void;
}

type PaletteCommand =
  | { kind: "new"; label: string }
  | { kind: "settings"; label: string }
  | { kind: "theme"; label: string }
  | { kind: "sidebar"; label: string }
  | { kind: "rightPanel"; label: string }
  | { kind: "export"; label: string }
  | { kind: "clear"; label: string };

type PaletteRow =
  | { index: number; kind: "command"; command: PaletteCommand }
  | { index: number; kind: "conversation"; conversation: OpenChatConversation };

type PaletteSection = { title: string; rows: PaletteRow[] };

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

const query = ref("");
const inputRef = ref<InstanceType<typeof Input>>();
const activeIndex = ref(0);

const commandGroups: { title: string; items: PaletteCommand[] }[] = [
  {
    title: "命令",
    items: [
      { kind: "new", label: "新建任务" },
      { kind: "settings", label: "打开设置" },
      { kind: "sidebar", label: "切换侧边栏" },
      { kind: "rightPanel", label: "切换右侧面板" },
      { kind: "theme", label: "切换主题" },
      { kind: "export", label: "导出聊天记录" },
      { kind: "clear", label: "清空本地历史" },
    ],
  },
];

const matchedConversations = computed(() => {
  const q = query.value.trim().toLocaleLowerCase();
  if (!q) return [];
  return props.conversationList.filter((item) =>
    String(item.label ?? "")
      .toLocaleLowerCase()
      .includes(q),
  );
});

/** 分区（命令 / 对话）+ 全局行号，键盘导航基于全局 index */
const sections = computed<PaletteSection[]>(() => {
  const q = query.value.trim().toLocaleLowerCase();
  const commands = q
    ? commandGroups[0].items.filter((item) => item.label.toLocaleLowerCase().includes(q))
    : commandGroups[0].items;
  const conversations = matchedConversations.value;

  let index = 0;
  const result: PaletteSection[] = [];
  if (commands.length > 0) {
    result.push({
      title: "命令",
      rows: commands.map((command) => ({ index: index++, kind: "command", command })),
    });
  }
  if (conversations.length > 0) {
    result.push({
      title: "对话",
      rows: conversations.map((conversation) => ({
        index: index++,
        kind: "conversation",
        conversation,
      })),
    });
  }
  return result;
});

/** 展平后的可聚焦行 */
const rows = computed<PaletteRow[]>(() => sections.value.flatMap((section) => section.rows));
const hasRows = computed(() => rows.value.length > 0);

const reset = () => {
  query.value = "";
  activeIndex.value = 0;
};

const close = () => {
  emit("update:open", false);
  reset();
};

const run = (row: PaletteRow) => {
  if (row.kind === "conversation") {
    emit("selectConversation", String(row.conversation.key));
    close();
    return;
  }
  switch (row.command.kind) {
    case "new":
      emit("newConversation");
      break;
    case "settings":
      emit("openSettings");
      break;
    case "theme":
      emit("toggleTheme");
      break;
    case "sidebar":
      emit("toggleSidebar");
      break;
    case "rightPanel":
      emit("toggleRightPanel");
      break;
    case "export":
      emit("exportHistory");
      break;
    case "clear":
      emit("clearHistory");
      break;
  }
  close();
};

const commandIcon = (command: PaletteCommand) => {
  switch (command.kind) {
    case "new":
      return SquarePen;
    case "settings":
      return Settings2;
    case "theme":
      return props.dark ? Sun : Moon;
    case "sidebar":
      return PanelLeft;
    case "rightPanel":
      return PanelRight;
    case "export":
      return Download;
    case "clear":
      return Trash2;
  }
};

const rowIcon = (row: PaletteRow) =>
  row.kind === "conversation" ? MessageSquare : commandIcon(row.command);

const rowLabel = (row: PaletteRow) =>
  row.kind === "conversation" ? row.conversation.label : row.command.label;

const handleKeydown = (event: KeyboardEvent) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "k") {
    event.preventDefault();
    if (props.open) close();
    else emit("update:open", true);
    return;
  }
  if (!props.open) return;
  if (event.key === "Escape") {
    event.preventDefault();
    close();
  } else if (event.key === "ArrowDown") {
    event.preventDefault();
    activeIndex.value = Math.min(activeIndex.value + 1, rows.value.length - 1);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    activeIndex.value = Math.max(activeIndex.value - 1, 0);
  } else if (event.key === "Enter") {
    event.preventDefault();
    run(rows.value[activeIndex.value]);
  }
};

watch(
  () => props.open,
  (open) => {
    if (open) {
      reset();
      void nextTick(() => inputRef.value?.focus());
    }
  },
);

watch(query, () => {
  activeIndex.value = 0;
});

onMounted(() => window.addEventListener("keydown", handleKeydown));
onBeforeUnmount(() => window.removeEventListener("keydown", handleKeydown));
</script>

<template>
  <Teleport to="body">
    <Transition name="palette">
      <div
        v-if="open"
        class="fixed inset-0 z-[300] flex items-start justify-center bg-[rgba(9,9,11,0.5)] px-4 pt-[11vh] backdrop-blur-[2px]"
        role="dialog"
        aria-modal="true"
        aria-label="命令面板"
        @mousedown.self="close"
      >
        <div
          class="w-full max-w-[580px] overflow-hidden rounded-[14px] border border-solid border-brand-border-strong bg-brand-surface shadow-[0_28px_70px_rgba(0,0,0,0.45)]"
          role="listbox"
        >
          <!-- 顶部 3px 品牌色光带 -->
          <div
            class="h-[3px] w-full bg-gradient-to-r from-brand-accent via-brand-resize to-brand-success opacity-80"
          />

          <!-- 输入行 -->
          <div
            class="flex items-center gap-3 border-b border-b-solid border-brand-border px-4 py-3.5"
          >
            <span
              class="grid h-6 w-6 flex-none place-items-center rounded-[7px] bg-brand-surface-subtle"
            >
              <Search class="!h-[14px] !w-[14px] text-brand-accent" />
            </span>
            <Input
              ref="inputRef"
              v-model:value="query"
              class="command-palette-input"
              :bordered="false"
              placeholder="输入命令或搜索对话…"
              aria-label="搜索命令或对话"
            />
            <span class="flex flex-none items-center gap-1">
              <kbd
                class="rounded-[5px] border border-solid border-brand-border px-1.5 py-0.5 text-[10px] leading-[1.4] text-brand-muted-strong [font-family:inherit]"
                >esc</kbd
              >
            </span>
          </div>

          <!-- 结果区 -->
          <div class="max-h-[min(46vh,420px)] overflow-y-auto py-2">
            <template v-if="hasRows">
              <template v-for="section in sections" :key="section.title">
                <p
                  class="mb-1 mt-2 flex items-center gap-2 px-4 text-[10px] font-semibold uppercase tracking-[0.1em] text-brand-muted-strong"
                >
                  {{ section.title }}
                  <span class="h-px flex-1 bg-brand-border" />
                </p>
                <button
                  v-for="row in section.rows"
                  :key="
                    row.kind === 'conversation' ? String(row.conversation.key) : row.command.kind
                  "
                  type="button"
                  class="relative flex min-h-[42px] w-full items-center gap-3 border-0 bg-transparent px-4 py-2 text-left text-[13.5px] text-brand-foreground"
                  :class="
                    row.index === activeIndex
                      ? 'bg-brand-surface-subtle text-brand-foreground'
                      : 'hover:bg-brand-surface-subtle'
                  "
                  role="option"
                  :aria-selected="row.index === activeIndex"
                  @mouseenter="activeIndex = row.index"
                  @click="run(row)"
                >
                  <!-- 激活态左侧指示条 -->
                  <span
                    v-if="row.index === activeIndex"
                    class="absolute top-1/2 left-0 h-[18px] w-[3px] -translate-y-1/2 rounded-r-full bg-brand-accent"
                  />
                  <span
                    class="grid h-[26px] w-[26px] flex-none place-items-center rounded-[7px] border border-solid border-brand-border bg-brand-surface-muted"
                    :class="
                      row.index === activeIndex ? 'text-brand-accent' : 'text-brand-muted-strong'
                    "
                  >
                    <component :is="rowIcon(row)" class="!h-[14px] !w-[14px]" />
                  </span>
                  <span class="min-w-0 flex-1 truncate">{{ rowLabel(row) }}</span>
                  <kbd
                    v-if="row.kind !== 'conversation'"
                    class="flex-none rounded-[5px] border border-solid border-brand-border bg-transparent px-1.5 py-0.5 text-[10px] leading-[1.4] text-brand-muted-strong [font-family:inherit]"
                    >↵</kbd
                  >
                </button>
              </template>
            </template>
            <div v-else class="flex flex-col items-center gap-2 px-4 py-10 text-center">
              <Search class="!h-5 !w-5 text-brand-ghost" />
              <p class="m-0 text-[12.5px] text-brand-muted-strong">没有匹配的结果</p>
              <p class="m-0 text-[11px] text-brand-ghost">换个关键词试试，或按 esc 关闭</p>
            </div>
          </div>

          <!-- 底部快捷键提示 -->
          <div
            class="flex h-[36px] flex-none items-center justify-end gap-4 border-t border-t-solid border-brand-border px-4"
          >
            <span class="flex items-center gap-1.5 text-[10.5px] text-brand-muted-strong">
              <kbd
                class="rounded-[4px] border border-solid border-brand-border bg-transparent px-1 py-px text-[10px] leading-[1.4] [font-family:inherit]"
                >↑↓</kbd
              >导航
            </span>
            <span class="flex items-center gap-1.5 text-[10.5px] text-brand-muted-strong">
              <kbd
                class="rounded-[4px] border border-solid border-brand-border bg-transparent px-1 py-px text-[10px] leading-[1.4] [font-family:inherit]"
                >↵</kbd
              >选择
            </span>
            <span class="flex items-center gap-1.5 text-[10.5px] text-brand-muted-strong">
              <kbd
                class="rounded-[4px] border border-solid border-brand-border bg-transparent px-1 py-px text-[10px] leading-[1.4] [font-family:inherit]"
                >esc</kbd
              >关闭
            </span>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.command-palette-input :deep(.ant-input) {
  color: var(--brand-foreground);
  font-size: 15px;
  caret-color: var(--brand-accent);
}
.command-palette-input :deep(.ant-input::placeholder) {
  color: var(--brand-muted-strong);
}
.palette-enter-active,
.palette-leave-active {
  transition:
    opacity 140ms ease,
    transform 140ms cubic-bezier(0.16, 1, 0.3, 1);
}
.palette-enter-from,
.palette-leave-to {
  opacity: 0;
  transform: translateY(-8px) scale(0.985);
}
</style>

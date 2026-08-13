<script setup lang="ts">
import {
  Command,
  Moon,
  PanelLeft,
  PanelRight,
  Settings2,
  Search,
  SquarePen,
  Sun,
  Trash2,
  Download,
  MessageSquare,
} from "@lucide/vue";
import { Input, Tooltip } from "antdv-next";
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

/** 展平的可聚焦行：命令 + 会话结果 */
const rows = computed(() => {
  const commands = query.value.trim()
    ? commandGroups[0].items.filter((item) =>
        item.label.toLocaleLowerCase().includes(query.value.trim().toLocaleLowerCase()),
      )
    : commandGroups[0].items;
  return [
    ...commands,
    ...matchedConversations.value.map((c) => ({ kind: "conversation" as const, conversation: c })),
  ];
});

const reset = () => {
  query.value = "";
  activeIndex.value = 0;
};

const close = () => {
  emit("update:open", false);
  reset();
};

const run = (index: number) => {
  const row = rows.value[index];
  if (!row) return;
  if (row.kind === "conversation") {
    emit("selectConversation", String(row.conversation.key));
    close();
    return;
  }
  switch (row.kind) {
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
    run(activeIndex.value);
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
        class="fixed inset-0 z-[300] flex items-start justify-center bg-[rgba(9,9,11,0.45)] px-4 pt-[12vh]"
        role="dialog"
        aria-modal="true"
        aria-label="命令面板"
        @mousedown.self="close"
      >
        <div
          class="w-full max-w-[560px] overflow-hidden rounded-[13px] border border-solid border-brand-border-strong bg-brand-surface shadow-[0_24px_60px_rgba(0,0,0,0.4)]"
          role="listbox"
        >
          <div class="flex items-center gap-3 border-b border-b-solid border-brand-border px-4">
            <Search class="!h-4 !w-4 text-brand-muted" />
            <Input
              ref="inputRef"
              v-model:value="query"
              class="command-palette-input"
              :bordered="false"
              placeholder="输入命令或搜索对话…"
              aria-label="搜索命令或对话"
            />
            <kbd
              class="rounded-[4px] border border-solid border-brand-border px-1.5 py-0.5 text-[10px] text-brand-muted-strong [font-family:inherit]"
              >Esc</kbd
            >
          </div>

          <div class="max-h-[min(46vh,420px)] overflow-y-auto py-2">
            <template v-if="rows.length > 0">
              <p
                v-if="matchedConversations.length > 0"
                class="mb-1 mt-2 px-4 text-[10px] font-semibold uppercase tracking-wide text-brand-muted-strong"
              >
                对话
              </p>
              <Tooltip
                v-for="(row, index) in rows"
                :key="row.kind === 'conversation' ? String(row.conversation.key) : row.label"
                placement="right"
              >
                <template #title>
                  <span v-if="row.kind === 'conversation'">{{ row.conversation.group }}</span>
                </template>
                <button
                  type="button"
                  class="flex min-h-[38px] w-full items-center gap-3 border-0 bg-transparent px-4 py-2 text-left text-[13px] text-brand-foreground"
                  :class="
                    index === activeIndex
                      ? 'bg-brand-surface-subtle'
                      : 'hover:bg-brand-surface-subtle'
                  "
                  role="option"
                  :aria-selected="index === activeIndex"
                  @mouseenter="activeIndex = index"
                  @click="run(index)"
                >
                  <component
                    :is="row.kind === 'conversation' ? MessageSquare : commandIcon(row)"
                    class="!h-[15px] !w-[15px] flex-none text-brand-muted-strong"
                  />
                  <span class="min-w-0 flex-1 truncate">
                    {{ row.kind === "conversation" ? row.conversation.label : row.label }}
                  </span>
                  <kbd
                    v-if="row.kind !== 'conversation'"
                    class="border-0 bg-transparent text-[10px] text-brand-muted-strong [font-family:inherit]"
                    >↵</kbd
                  >
                </button>
              </Tooltip>
            </template>
            <p v-else class="px-4 py-8 text-center text-[12px] text-brand-muted-strong">
              没有匹配的结果
            </p>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.command-palette-input :deep(.ant-input) {
  color: var(--brand-foreground);
  font-size: 14px;
}
.palette-enter-active,
.palette-leave-active {
  transition: opacity 120ms ease;
}
.palette-enter-from,
.palette-leave-to {
  opacity: 0;
}
</style>

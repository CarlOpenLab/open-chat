<script setup lang="ts">
import {
  Bot,
  ChevronDown,
  Circle,
  Moon,
  PanelLeftClose,
  Settings,
  SquarePen,
  Sun,
} from "@lucide/vue";
import { Modal, Tooltip } from "antdv-next";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import type { AgentView } from "../../services/acp";

interface Props {
  open: boolean;
  /** 当前是否深色主题，底栏的主题切换按钮据此换图标 */
  dark?: boolean;
  agents?: AgentView[];
  activeAgentId?: string;
}

interface Emits {
  (e: "toggleSidebar"): void;
  (e: "toggleTheme"): void;
  (e: "newConversation"): void;
  (e: "openSearch"): void;
  (e: "openSettings"): void;
  (e: "agentChange", agentId: string): void;
}

const props = withDefaults(defineProps<Props>(), {
  dark: true,
  agents: () => [],
  activeAgentId: "api",
});
const emit = defineEmits<Emits>();

const agentDialogOpen = ref(false);

const activeAgent = computed(
  () => props.agents.find((agent) => agent.id === props.activeAgentId) ?? props.agents[0],
);
const selectableAgents = computed(() => props.agents.filter((agent) => agent.id !== "api"));
const activeAgentLabel = computed(() =>
  activeAgent.value?.id === "api" ? "模型" : activeAgent.value?.name || "选择供应商",
);

const agentStatus = (agent: Partial<AgentView>): string => {
  if (!agent.enabled) return "已禁用";
  if (agent.available) return `${agent.protocol || "CLI"} 已就绪`;
  if (agent.installed && agent.protocol === "ACP") return "ACP 适配器未找到";
  return "CLI 未安装";
};

const selectAgent = (agentId: string) => {
  agentDialogOpen.value = false;
  emit("agentChange", agentId);
};

const iconButtonClass =
  "grid h-[26px] w-[26px] flex-none place-items-center rounded-[6px] border-0 bg-transparent p-0 text-brand-muted-strong cursor-pointer hover:bg-brand-surface-subtle hover:text-brand-foreground active:opacity-80";

/* 新任务是侧栏唯一的「主操作」：带边框的软按钮 */
const newTaskRowClass =
  "flex h-[32px] w-full flex-none items-center gap-[8px] rounded-[8px] border border-solid border-brand-border bg-transparent px-[9px] text-left text-[13px] font-medium text-brand-foreground cursor-pointer transition-colors duration-150 hover:border-brand-border-strong hover:bg-brand-surface-subtle active:opacity-80";

const handleShortcut = (event: KeyboardEvent) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "k") {
    event.preventDefault();
    emit("openSearch");
  }
};

onMounted(() => window.addEventListener("keydown", handleShortcut));
onBeforeUnmount(() => window.removeEventListener("keydown", handleShortcut));
</script>

<template>
  <aside
    class="chat-sidebar relative z-sidebar flex h-full min-h-0 w-full flex-col overflow-hidden bg-brand-sidebar"
    :class="open ? 'border-r border-r-solid border-r-brand-border' : ''"
    aria-label="会话导航"
  >
    <!-- 侧栏标题栏：品牌标志与历史导航 -->
    <div class="flex h-[48px] flex-none items-center gap-[2px] px-[10px]">
      <button
        type="button"
        class="grid h-[26px] w-[26px] place-items-center rounded-[6px] border-0 bg-transparent p-0 text-brand-muted-strong hover:bg-brand-surface-subtle hover:text-brand-foreground"
        :aria-label="open ? '收起侧边栏' : '展开侧边栏'"
        @click="emit('toggleSidebar')"
      >
        <PanelLeftClose :class="open ? '' : 'rotate-180'" />
      </button>
    </div>

    <!-- CLI / API 供应商切换 -->
    <div class="px-[10px] pb-[8px]">
      <button
        type="button"
        class="agent-provider-trigger"
        aria-label="选择供应商"
        :title="activeAgent?.description"
        @click="agentDialogOpen = true"
      >
        <span class="agent-provider-mark"><Bot class="!h-[14px] !w-[14px]" /></span>
        <span class="min-w-0 flex-1 text-left">
          <span class="block truncate text-[12px] font-medium text-brand-foreground">{{
            activeAgentLabel
          }}</span>
          <span class="flex items-center gap-[5px] text-[10px] text-brand-muted-strong">
            <Circle
              class="!h-[6px] !w-[6px]"
              :class="
                activeAgent?.available
                  ? 'fill-brand-success text-brand-success'
                  : 'fill-brand-ghost text-brand-ghost'
              "
            />
            {{ agentStatus(activeAgent) }}
          </span>
        </span>
        <ChevronDown class="!h-[13px] !w-[13px] text-brand-muted-strong" />
      </button>
    </div>

    <!-- 新任务（主操作） -->
    <div class="flex flex-none flex-col gap-[4px] px-[10px] pb-[10px]">
      <button type="button" :class="newTaskRowClass" @click="emit('newConversation')">
        <SquarePen class="!h-[14px] !w-[14px] flex-none text-brand-accent" />
        <span class="min-w-0 flex-1 truncate">新任务</span>
      </button>
    </div>

    <!-- 会话列表已迁移至看板主页；此处留白让底栏贴底 -->
    <div class="min-h-0 flex-1"></div>

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

    <Modal v-model:open="agentDialogOpen" title="选择供应商" :footer="null" :width="520">
      <div class="agent-picker-grid">
        <button
          v-for="agent in selectableAgents"
          :key="agent.id"
          type="button"
          class="agent-picker-card"
          :class="{ 'is-selected': agent.id === activeAgentId }"
          @click="selectAgent(agent.id)"
        >
          <span class="agent-picker-icon"><Bot class="!h-[17px] !w-[17px]" /></span>
          <span class="agent-picker-copy">
            <span class="agent-picker-name">{{ agent.name }}</span>
            <span class="agent-picker-description">{{ agent.description }}</span>
            <span class="agent-picker-status">
              <Circle
                class="!h-[6px] !w-[6px]"
                :class="
                  agent.available
                    ? 'fill-brand-success text-brand-success'
                    : 'fill-brand-ghost text-brand-ghost'
                "
              />
              {{ agentStatus(agent) }}
            </span>
          </span>
          <span v-if="agent.id === activeAgentId" class="agent-picker-current">当前</span>
        </button>
      </div>
    </Modal>
  </aside>
</template>

<style scoped>
.agent-provider-trigger {
  display: flex;
  width: 100%;
  min-height: 44px;
  align-items: center;
  gap: 9px;
  padding: 5px 8px;
  border: 1px solid var(--brand-border);
  border-radius: 7px;
  background: var(--brand-surface-subtle);
  color: var(--brand-foreground);
  cursor: pointer;
}
.agent-provider-trigger:hover {
  border-color: var(--brand-border-strong);
}
.agent-provider-mark {
  display: grid;
  width: 28px;
  height: 28px;
  flex: none;
  place-items: center;
  border-radius: 6px;
  background: color-mix(in srgb, var(--brand-accent) 12%, transparent);
  color: var(--brand-accent);
}
.agent-picker-grid {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.agent-picker-card {
  display: flex;
  min-width: 0;
  width: 100%;
  align-items: center;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--brand-border);
  border-radius: 9px;
  background: var(--brand-surface-subtle);
  color: var(--brand-foreground);
  text-align: left;
  cursor: pointer;
  transition:
    border-color 150ms ease,
    background 150ms ease,
    transform 150ms ease;
}
.agent-picker-card:hover {
  border-color: var(--brand-border-strong);
  background: var(--brand-surface);
  transform: translateY(-1px);
}
.agent-picker-card.is-selected {
  border-color: var(--brand-accent);
  background: color-mix(in srgb, var(--brand-accent) 8%, var(--brand-surface-subtle));
}
.agent-picker-icon {
  display: grid;
  width: 34px;
  height: 34px;
  flex: none;
  place-items: center;
  border-radius: 8px;
  background: color-mix(in srgb, var(--brand-accent) 12%, transparent);
  color: var(--brand-accent);
}
.agent-picker-copy {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 2px;
}
.agent-picker-name {
  color: var(--brand-foreground);
  font-size: 12px;
  font-weight: 500;
}
.agent-picker-description,
.agent-picker-status {
  overflow: hidden;
  color: var(--brand-muted-strong);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.agent-picker-status {
  display: flex;
  align-items: center;
  gap: 5px;
}
.agent-picker-current {
  flex: none;
  color: var(--brand-accent);
  font-size: 10px;
  font-weight: 600;
}
</style>

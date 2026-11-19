<script setup lang="ts">
import { Popover } from "antdv-next";
import { computed, nextTick, ref } from "vue";
import { store } from "../store";
import type { AgentInfo, ConfigOption } from "../types";
import ProviderIcon from "./ProviderIcon.vue";

interface ModelRow {
  key: string;
  agentId: string;
  agentName: string;
  configId: string | null;
  modelValue: string | null;
  modelLabel: string;
  available: boolean;
  probe?: string;
}

const props = defineProps<{
  modelValue: string;
  modelOption?: ConfigOption | null;
  selectedModelValue?: string;
  liveStatus?: string;
  disabled?: boolean;
  locked?: boolean;
}>();

const emit = defineEmits<{
  "update:modelValue": [agentId: string];
  "pick-model": [configId: string, value: string];
  manage: [];
}>();

const open = ref(false);
const query = ref("");
const activeRail = ref<string>("all"); // "fav" | agent.id
const searchEl = ref<HTMLInputElement | null>(null);

const favKeys = ref<string[]>(
  (() => {
    try {
      return JSON.parse(localStorage.getItem("oc.favModels") || "[]") as string[];
    } catch {
      return [];
    }
  })(),
);

function toggleFav(key: string) {
  const set = new Set(favKeys.value);
  if (set.has(key)) set.delete(key);
  else set.add(key);
  favKeys.value = [...set];
  localStorage.setItem("oc.favModels", JSON.stringify(favKeys.value));
}

const agents = computed(() => store.agents.filter((a) => !a.disabled));
const currentAgent = computed(() => agents.value.find((a) => a.id === props.modelValue) ?? agents.value[0] ?? null);

function flattenModels(o: ConfigOption | null | undefined): { value: string; label: string }[] {
  if (!o?.options) return [];
  const list = o.options;
  if (Array.isArray(list) && list.length && "group" in (list[0] as object)) {
    return (list as { group: string; name: string; options: { value: string; name: string }[] }[]).flatMap((g) =>
      g.options.map((x) => ({ value: x.value, label: `${x.name} · ${g.name}` })),
    );
  }
  return (list as { value: string; name: string }[]).map((x) => ({ value: x.value, label: x.name }));
}

function optionForAgent(agentId: string): ConfigOption | null {
  if (agentId === props.modelValue && props.modelOption) return props.modelOption;
  if (!props.locked) return store.cachedModels[agentId] ?? null;
  return null;
}

const activeModelOpt = computed(() => optionForAgent(props.modelValue));

const activeModelValue = computed(() => {
  if (props.selectedModelValue) return props.selectedModelValue;
  return activeModelOpt.value?.currentValue != null ? String(activeModelOpt.value.currentValue) : "";
});

const currentModelLabel = computed(() => {
  const opt = activeModelOpt.value;
  if (!opt) return currentAgent.value?.name ?? "选择 Agent";
  const cur = activeModelValue.value;
  const found = flattenModels(opt).find((m) => m.value === cur);
  return found?.label ?? (currentAgent.value?.name || "选择 Agent");
});

const allRows = computed<ModelRow[]>(() => {
  const rows: ModelRow[] = [];
  const list = props.locked ? agents.value.filter((a) => a.id === props.modelValue) : agents.value;

  for (const a of list) {
    const opt = optionForAgent(a.id);
    if (opt) {
      const models = flattenModels(opt);
      if (models.length) {
        for (const m of models) {
          rows.push({
            key: `${a.id}::${m.value}`,
            agentId: a.id,
            agentName: a.name,
            configId: opt.id,
            modelValue: m.value,
            modelLabel: m.label,
            available: a.available,
            probe: a.probe,
          });
        }
        continue;
      }
    }
    if (props.locked) continue;
    rows.push({
      key: `${a.id}::default`,
      agentId: a.id,
      agentName: a.name,
      configId: null,
      modelValue: null,
      modelLabel: a.available ? (a.demo ? `${a.name} · 内置演示` : `${a.name} · 默认模型（连接一次后同步列表）`) : `${a.name} · 未安装`,
      available: a.available,
      probe: a.probe,
    });
  }
  return rows;
});

const visibleRows = computed(() => {
  const q = query.value.trim().toLowerCase();
  let list = allRows.value;
  if (activeRail.value === "fav") {
    list = list.filter((r) => favKeys.value.includes(r.key));
  } else if (activeRail.value && activeRail.value !== "all") {
    list = list.filter((r) => r.agentId === activeRail.value);
  }
  if (q) {
    list = list.filter(
      (r) =>
        r.modelLabel.toLowerCase().includes(q) ||
        r.agentName.toLowerCase().includes(q) ||
        r.agentId.toLowerCase().includes(q),
    );
  }
  return list;
});

const emptyText = computed(() => {
  if (activeRail.value === "fav") return "还没有收藏的模型，点击行右侧星标收藏";
  if (query.value.trim()) return "没有匹配的模型";
  if (props.locked && !props.modelOption) {
    if (props.liveStatus === "error") return "会话连接失败，点击上方重试后即可加载模型列表";
    if (props.liveStatus === "connecting") return "正在连接 Agent 并获取可用模型…";
    return `${currentAgent.value?.name ?? "当前 Agent"} 暂未返回可切换的模型列表`;
  }
  return "没有匹配的模型或供应商";
});

function isRowActive(r: ModelRow) {
  if (r.agentId !== props.modelValue) return false;
  if (r.modelValue !== null) {
    return activeModelValue.value === r.modelValue;
  }
  return true;
}

function onOpenChange(v: boolean) {
  if (props.disabled) {
    open.value = false;
    return;
  }
  open.value = v;
  if (v) {
    query.value = "";
    activeRail.value = props.locked ? props.modelValue : currentAgent.value?.id ?? "all";
    void nextTick(() => searchEl.value?.focus());
  }
}

function pickRow(r: ModelRow) {
  if (!props.locked && r.agentId !== props.modelValue) {
    emit("update:modelValue", r.agentId);
  }
  if (r.modelValue !== null && r.configId) {
    emit("pick-model", r.configId, r.modelValue);
  }
  open.value = false;
}

function selectRailAgent(a: AgentInfo) {
  if (props.locked && a.id !== props.modelValue) return;
  activeRail.value = a.id;
  if (!props.locked) {
    emit("update:modelValue", a.id);
  }
}

function onSearchKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") {
    e.stopPropagation();
    open.value = false;
    return;
  }
  if ((e.metaKey || e.ctrlKey) && e.key >= "1" && e.key <= "9") {
    const idx = Number(e.key) - 1;
    const row = visibleRows.value[idx];
    if (row) {
      e.preventDefault();
      pickRow(row);
    }
  }
}

function openSettings() {
  open.value = false;
  emit("manage");
}
</script>

<template>
  <Popover
    :open="open"
    trigger="click"
    placement="topRight"
    :arrow="false"
    root-class="oc-provider-popover"
    :styles="{ container: { padding: '0px', background: 'transparent', boxShadow: 'none', border: 'none' } }"
    @open-change="onOpenChange"
  >
    <template #content>
      <div class="t3-picker">
        <!-- Left vertical rail: Favorites + Agent Provider Icons -->
        <div class="rail">
          <button
            class="rail-btn"
            :class="{ active: activeRail === 'fav' }"
            title="收藏的模型"
            @click="activeRail = 'fav'"
          >
            <!-- Lucide Star -->
            <svg viewBox="0 0 24 24" fill="currentColor" class="rail-star">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
          </button>

          <span class="rail-divider" />

          <button
            v-for="a in agents"
            :key="a.id"
            class="rail-btn"
            :class="{
              active: activeRail === a.id,
              dim: !a.available || (locked && a.id !== modelValue),
              'rail-locked': locked && a.id !== modelValue,
            }"
            :disabled="locked && a.id !== modelValue"
            :title="
              locked && a.id !== modelValue
                ? `当前对话已锁定为 ${currentAgent?.name ?? ''}，切换其他 Agent 请新建对话`
                : a.available
                  ? a.name
                  : `${a.name}（未安装）`
            "
            @click="selectRailAgent(a)"
          >
            <ProviderIcon :id="a.id" :name="a.name" :size="17" />
          </button>
        </div>

        <!-- Right main pane: Search + Model list + Manage footer -->
        <div class="pane">
          <div class="search-bar">
            <!-- Lucide Search -->
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="search-ic">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              ref="searchEl"
              v-model="query"
              type="text"
              class="search-input"
              :placeholder="locked ? `搜索 ${currentAgent?.name ?? '当前 Agent'} 的模型...` : 'Search models...'"
              @keydown="onSearchKeydown"
            />
          </div>

          <div class="model-list">
            <button
              v-for="(r, idx) in visibleRows"
              :key="r.key"
              class="model-row"
              :class="{ active: isRowActive(r), dim: !r.available }"
              @click="pickRow(r)"
            >
              <ProviderIcon :id="r.agentId" :name="r.agentName" :size="15" />
              <span class="model-name">{{ r.modelLabel }}</span>

              <!-- Lucide Check -->
              <svg
                v-if="isRowActive(r)"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                class="row-check"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>

              <span
                class="fav-btn"
                :class="{ starred: favKeys.includes(r.key) }"
                role="button"
                title="收藏"
                @click.stop="toggleFav(r.key)"
              >
                <svg
                  viewBox="0 0 24 24"
                  :fill="favKeys.includes(r.key) ? 'currentColor' : 'none'"
                  stroke="currentColor"
                  stroke-width="1.8"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
              </span>

              <span v-if="idx < 9" class="kbd-badge">⌘{{ idx + 1 }}</span>
            </button>

            <div v-if="!visibleRows.length" class="empty">
              {{ emptyText }}
            </div>
          </div>

          <div class="pane-foot">
            <button class="manage-btn" @click="openSettings">
              <!-- Lucide Plus -->
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="foot-ic">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              <span>管理 ACP 供应商</span>
              <!-- Lucide Settings -->
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" class="foot-gear">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.6.85 1 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </template>

    <button
      class="trigger"
      :class="{ open, off: currentAgent && !currentAgent.available }"
      :disabled="disabled"
      :title="locked ? `切换 ${currentAgent?.name ?? '当前 Agent'} 的模型` : '选择 Agent 与模型'"
    >
      <ProviderIcon v-if="currentAgent" :id="currentAgent.id" :name="currentAgent.name" :size="15" />
      <span class="trigger-name">{{ currentModelLabel }}</span>
      <!-- Lucide ChevronDown -->
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        class="chev"
      >
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </button>
  </Popover>
</template>

<style scoped>
.trigger {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 9px;
  border-radius: 8px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--text);
  font-size: 12.5px;
  font-weight: 520;
  cursor: pointer;
  transition: background 0.14s, border-color 0.14s, color 0.14s;
}
.trigger:hover:not(:disabled),
.trigger.open {
  background: var(--hover);
  border-color: var(--border);
}
.trigger:disabled {
  cursor: default;
  opacity: 0.6;
}
.trigger.off {
  color: var(--text-3);
}
.trigger-name {
  max-width: 158px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.chev {
  width: 12px;
  height: 12px;
  color: var(--text-3);
  flex: none;
}

/* T3 Code dual-pane picker (solid opaque surface to avoid background text bleed) */
.t3-picker {
  display: flex;
  width: 376px;
  height: 312px;
  overflow: hidden;
  border-radius: 13px;
  background: var(--modal-bg);
}

.rail {
  width: 46px;
  flex: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 10px 0;
  border-right: 1px solid var(--border);
  background: color-mix(in srgb, var(--ink) 3.5%, var(--modal-bg));
}

.rail-divider {
  width: 20px;
  height: 1px;
  background: var(--border);
  margin: 2px 0;
}

.rail-btn {
  position: relative;
  width: 34px;
  height: 32px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text-2);
  display: grid;
  place-items: center;
  cursor: pointer;
  transition: background 0.14s, color 0.14s, opacity 0.14s;
}
.rail-btn:hover:not(:disabled) {
  background: var(--hover);
  color: var(--text);
}
.rail-btn.active {
  background: var(--active);
  color: var(--text);
}
.rail-btn.dim {
  opacity: 0.35;
}
.rail-btn.rail-locked {
  cursor: not-allowed;
}
.rail-star {
  width: 15px;
  height: 15px;
}

.pane {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.search-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px 9px;
  border-bottom: 1px solid var(--border);
  transition: background 0.14s var(--ease), border-color 0.14s var(--ease);
}
.search-bar:hover {
  background: var(--hover);
}
.search-bar:focus-within {
  background: color-mix(in srgb, var(--hover) 70%, transparent);
  border-bottom-color: var(--border-strong);
}
.search-ic {
  width: 14px;
  height: 14px;
  color: var(--text-3);
  flex: none;
  transition: color 0.14s;
}
.search-bar:focus-within .search-ic {
  color: var(--text-2);
}
.search-input {
  width: 100%;
  border: none;
  outline: none;
  background: transparent;
  color: var(--text);
  font-size: 12.5px;
}
.search-input:focus-visible {
  outline: none;
  box-shadow: none;
}
.search-input::placeholder {
  color: var(--text-3);
}

.model-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.model-row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 8px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text);
  font-size: 12.5px;
  text-align: left;
  cursor: pointer;
  transition: background 0.12s;
}
.model-row:hover {
  background: var(--hover);
}
.model-row.active {
  background: var(--active);
}
.model-row.dim {
  opacity: 0.55;
}

.model-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 470;
}

.row-check {
  width: 13px;
  height: 13px;
  color: var(--text);
  flex: none;
}

.fav-btn {
  display: inline-grid;
  place-items: center;
  width: 18px;
  height: 18px;
  color: var(--text-3);
  opacity: 0;
  transition: opacity 0.12s, color 0.12s;
  flex: none;
}
.fav-btn svg {
  width: 13px;
  height: 13px;
}
.model-row:hover .fav-btn,
.fav-btn.starred {
  opacity: 1;
}
.fav-btn.starred {
  color: #f59e0b;
}

.kbd-badge {
  flex: none;
  font-size: 10.5px;
  line-height: 16px;
  padding: 0 5px;
  border-radius: 5px;
  background: var(--hover);
  border: 1px solid var(--border);
  color: var(--text-3);
  font-family: var(--mono);
}

.empty {
  padding: 28px 14px;
  text-align: center;
  font-size: 12px;
  line-height: 1.55;
  color: var(--text-3);
}

.pane-foot {
  border-top: 1px solid var(--border);
  padding: 5px 6px;
}
.manage-btn {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 6px 8px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--text-2);
  font-size: 12px;
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
}
.manage-btn:hover {
  background: var(--hover);
  color: var(--text);
}
.foot-ic,
.foot-gear {
  width: 13px;
  height: 13px;
  flex: none;
}
.foot-gear {
  margin-left: auto;
  color: var(--text-3);
}
</style>

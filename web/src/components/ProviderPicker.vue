<script setup lang="ts">
import { Popover, message } from "antdv-next";
import { computed, nextTick, ref } from "vue";
import { isMac, probeModels, refreshModels, store } from "../store";
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
  probing?: boolean;
  probeError?: string;
  probe?: string;
}

const props = defineProps<{
  modelValue: string;
  modelOption?: ConfigOption | null;
  selectedModelValue?: string;
  liveStatus?: string;
  disabled?: boolean;
  locked?: boolean;
  cwd?: string;
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
    const probing = Boolean(store.probingModels[a.id]);
    const probeError = store.probeErrors[a.id];
    rows.push({
      key: `${a.id}::default`,
      agentId: a.id,
      agentName: a.name,
      configId: null,
      modelValue: null,
      modelLabel: !a.available
        ? `${a.name} · 未安装`
        : probing
          ? `正在获取 ${a.name} 的可用模型…`
          : probeError
            ? `${a.name} · 默认模型（同步失败，点此重试）`
            : `${a.name} · 默认模型`,
      available: a.available,
      probing,
      probeError,
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

function ensureModelsFor(agentId: string) {
  if (props.locked || !agentId || agentId === "all" || agentId === "fav") return;
  if (!optionForAgent(agentId)) {
    void probeModels(agentId, props.cwd ?? "");
  }
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
    ensureModelsFor(activeRail.value);
    void nextTick(() => searchEl.value?.focus());
  }
}

function pickRow(r: ModelRow) {
  if (r.probing) return;
  if (r.probeError && r.modelValue === null) {
    void probeModels(r.agentId, props.cwd ?? "", true);
    return;
  }
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
    ensureModelsFor(a.id);
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

const refreshTarget = computed(() =>
  activeRail.value !== "fav" && activeRail.value !== "all" ? activeRail.value : currentAgent.value?.id ?? "",
);
const refreshing = computed(() => Boolean(refreshTarget.value && store.probingModels[refreshTarget.value]));

/** Re-read models from a fresh agent process; only meaningful for new conversations, a live session keeps its own list. */
async function refreshCurrent() {
  const id = refreshTarget.value;
  if (!id || refreshing.value) return;
  try {
    await refreshModels(id, props.cwd ?? "");
    message.success("模型列表已刷新，对新建会话生效");
  } catch (e) {
    message.error(e instanceof Error ? e.message : String(e));
  }
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
      <div class="flex w-[376px] h-[312px] overflow-hidden rounded-[13px] bg-modal">
        <!-- Left vertical rail: Favorites + Agent Provider Icons -->
        <div class="w-[46px] flex-none flex flex-col items-center gap-1 py-[10px] border-0 border-r border-solid border-line bg-[color-mix(in_srgb,var(--ink)_3.5%,var(--modal-bg))]">
          <button
            class="relative w-[34px] h-8 border-0 rounded-[8px] grid place-items-center cursor-pointer transition-all duration-140"
            :class="activeRail === 'fav' ? 'bg-active text-ink' : 'bg-transparent text-ink-2 hover:bg-hover hover:text-ink'"
            title="收藏的模型"
            @click="activeRail = 'fav'"
          >
            <!-- Lucide Star -->
            <svg viewBox="0 0 24 24" fill="currentColor" class="w-[15px] h-[15px]">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
          </button>

          <span class="w-5 h-[1px] bg-line my-[2px]" />

          <button
            v-for="a in agents"
            :key="a.id"
            class="relative w-[34px] h-8 border-0 rounded-[8px] grid place-items-center transition-all duration-140"
            :class="[
              activeRail === a.id ? 'bg-active text-ink' : 'bg-transparent text-ink-2 hover:not-disabled:bg-hover hover:not-disabled:text-ink',
              !a.available || (locked && a.id !== modelValue) ? 'opacity-35' : '',
              locked && a.id !== modelValue ? 'cursor-not-allowed' : 'cursor-pointer',
            ]"
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
        <div class="flex-1 min-w-0 flex flex-col">
          <div class="group flex items-center gap-2 px-3 pt-[10px] pb-[9px] border-0 border-b border-solid border-line transition-colors duration-140 ease-oc hover:bg-hover focus-within:bg-[color-mix(in_srgb,var(--hover)_70%,transparent)] focus-within:border-b-line-strong">
            <!-- Lucide Search -->
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="w-[14px] h-[14px] text-ink-3 flex-none transition-colors duration-140 group-focus-within:text-ink-2">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              ref="searchEl"
              v-model="query"
              type="text"
              class="w-full border-0 outline-none bg-transparent text-ink text-[12.5px] placeholder:text-ink-3 focus-visible:outline-none focus-visible:shadow-none"
              :placeholder="locked ? `搜索 ${currentAgent?.name ?? '当前 Agent'} 的模型...` : 'Search models...'"
              @keydown="onSearchKeydown"
            />
          </div>

          <div class="flex-1 min-h-0 overflow-y-auto p-[6px] flex flex-col gap-[2px]">
            <template v-for="(r, idx) in visibleRows" :key="r.key">
              <button
                class="group w-full flex items-center gap-2 px-2 py-[7px] border-0 rounded-[8px] text-ink text-[12.5px] text-left cursor-pointer transition-colors duration-120"
                :class="[
                  isRowActive(r) ? 'bg-active' : 'bg-transparent hover:bg-hover',
                  !r.available ? 'opacity-55' : '',
                ]"
                @click="pickRow(r)"
              >
                <ProviderIcon :id="r.agentId" :name="r.agentName" :size="15" />
                <span class="flex-1 min-w-0 truncate fw-470" :title="r.probeError || r.modelLabel">{{ r.modelLabel }}</span>

                <span
                  v-if="r.probing"
                  class="w-3 h-3 rounded-full border-[1.5px] border-solid border-line-strong border-t-ink-solid flex-none animate-oc-spin"
                  aria-hidden="true"
                />

                <!-- Lucide Check -->
                <svg
                  v-else-if="isRowActive(r)"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  class="w-[13px] h-[13px] text-ink flex-none"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>

                <span
                  v-if="!r.probing"
                  class="inline-grid place-items-center w-[18px] h-[18px] transition-all duration-120 flex-none [&>svg]:w-[13px] [&>svg]:h-[13px]"
                  :class="favKeys.includes(r.key) ? 'opacity-100 text-[#f59e0b]' : 'opacity-0 text-ink-3 group-hover:opacity-100'"
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

                <span
                  v-if="!r.probing && idx < 9"
                  class="flex-none text-[10.5px] leading-4 px-[5px] rounded-[5px] bg-hover border border-solid border-line text-ink-3 font-mono"
                >
                  {{ isMac ? '⌘' : 'Ctrl+' }}{{ idx + 1 }}
                </span>
              </button>
              <div v-if="r.probeError" class="mx-[6px] mt-[2px] mb-1 px-2 py-[6px] rounded-[7px] bg-err-soft text-err text-[11px] leading-[1.45] break-words selectable">
                {{ r.probeError }}
              </div>
            </template>

            <div v-if="!visibleRows.length" class="py-7 px-[14px] text-center text-[12px] leading-[1.55] text-ink-3">
              {{ emptyText }}
            </div>
          </div>

          <div class="flex gap-[6px] border-0 border-t border-solid border-line px-[6px] py-[5px]">
            <button
              v-if="!locked"
              class="flex-none flex items-center gap-[7px] px-2 py-[6px] border-0 rounded-[7px] bg-transparent text-ink-2 text-[12px] cursor-pointer transition-colors duration-120 hover:not-disabled:bg-hover hover:not-disabled:text-ink disabled:cursor-default disabled:opacity-55"
              :disabled="refreshing"
              @click="refreshCurrent"
            >
              <!-- Lucide RefreshCw -->
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
                class="w-[13px] h-[13px] flex-none"
                :class="{ 'animate-oc-spin': refreshing }"
              >
                <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
                <path d="M21 3v5h-5" />
                <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
                <path d="M3 21v-5h5" />
              </svg>
              <span>刷新模型</span>
            </button>
            <button
              class="flex-1 min-w-0 flex items-center gap-[7px] px-2 py-[6px] border-0 rounded-[7px] bg-transparent text-ink-2 text-[12px] cursor-pointer transition-colors duration-120 hover:bg-hover hover:text-ink"
              @click="openSettings"
            >
              <!-- Lucide Plus -->
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="w-[13px] h-[13px] flex-none">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              <span>管理 ACP 供应商</span>
              <!-- Lucide Settings -->
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" class="w-[13px] h-[13px] flex-none ml-auto text-ink-3">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.6.85 1 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </template>

    <button
      class="inline-flex items-center gap-[6px] h-7 px-[9px] rounded-[8px] border border-solid text-[12.5px] fw-520 cursor-pointer transition-colors duration-140 disabled:cursor-default disabled:opacity-60"
      :class="[
        open ? 'bg-hover border-line' : 'border-transparent bg-transparent hover:not-disabled:bg-hover hover:not-disabled:border-line',
        currentAgent && !currentAgent.available ? 'text-ink-3' : 'text-ink',
      ]"
      :disabled="disabled"
      :title="locked ? `切换 ${currentAgent?.name ?? '当前 Agent'} 的模型` : '选择 Agent 与模型'"
    >
      <ProviderIcon v-if="currentAgent" :id="currentAgent.id" :name="currentAgent.name" :size="15" />
      <span class="max-w-[158px] truncate">{{ currentModelLabel }}</span>
      <!-- Lucide ChevronDown -->
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        class="w-3 h-3 text-ink-3 flex-none"
      >
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </button>
  </Popover>
</template>

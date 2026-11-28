<script setup lang="ts">
import { Conversations } from "@antdv-next/x";
import type { ConversationItemType } from "@antdv-next/x";
import {
  ArrowLeftOutlined,
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  InboxOutlined,
  InfoCircleOutlined,
  MenuFoldOutlined,
  MessageOutlined,
  PushpinFilled,
  PushpinOutlined,
} from "@antdv-next/icons";
import { Checkbox, Dropdown, Input, Modal, Tooltip, message } from "antdv-next";
import { Icon, addCollection, type IconifyJSON } from "@iconify/vue";
import rawLucide from "@iconify-json/lucide/icons.json";
import { computed, h, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { botById, isArchived, isDark, isMac, newConversation, newConversationInDir, openBotChat, openBots, pin, remove, removeWorktree, rename, saveSettings, select, setArchived, setUserAvatar, sortedMetas, store } from "../store";
import type { Meta } from "../types";
import BotAvatar from "./BotAvatar.vue";
import ProviderIcon from "./ProviderIcon.vue";

addCollection(rawLucide as unknown as IconifyJSON);

const lucideIcon = (name: string, size = 14, className?: string) =>
  h(Icon, { icon: `lucide:${name}`, width: size, height: size, class: className });

const renaming = ref<Meta | null>(null);
const newTitle = ref("");
const renameInput = ref<{ focus: () => void } | null>(null);
const toDelete = ref<Meta | null>(null);
const deleteWithWorktree = ref(true);
const deleteWithBranch = ref(false);
const deleteBusy = ref(false);
const showArchived = ref(false);

// Multi-select state for batch archive / delete
const selecting = ref(false);
const selectedIds = ref<Set<string>>(new Set());
const lastSelectedId = ref<string | null>(null);
const batchArchiveOpen = ref(false);
const batchDeleteOpen = ref(false);
const batchDeleteWithWorktree = ref(true);
const batchDeleteWithBranch = ref(false);
const batchBusy = ref(false);

const convCtx = ref<{ open: boolean; x: number; y: number; meta: Meta | null }>({
  open: false,
  x: 0,
  y: 0,
  meta: null,
});

function closeConvCtx() {
  if (convCtx.value.open) convCtx.value.open = false;
}

function onListContextMenu(e: MouseEvent) {
  if (e.shiftKey) return;
  const target = e.target as HTMLElement | null;
  const itemEl = target?.closest(".antd-conversations-item");
  const id = itemEl?.querySelector<HTMLElement>("[data-conv-id]")?.dataset.convId;
  if (!id) return;
  const m = filtered.value.find((x) => x.id === id) ?? expandedBotMetas.value.find((x) => x.id === id);
  if (!m) return;
  e.preventDefault();
  e.stopPropagation();
  const menuW = 152;
  const menuH = isArchived(m.id) ? 128 : 160;
  convCtx.value = {
    open: true,
    x: Math.min(e.clientX, window.innerWidth - menuW - 8),
    y: Math.min(e.clientY, window.innerHeight - menuH - 8),
    meta: m,
  };
}

function enterSelectMode(initialId?: string) {
  selecting.value = true;
  if (initialId) {
    const next = new Set(selectedIds.value);
    next.add(initialId);
    selectedIds.value = next;
    lastSelectedId.value = initialId;
  }
}

function exitSelectMode() {
  selecting.value = false;
  selectedIds.value = new Set();
  lastSelectedId.value = null;
  batchArchiveOpen.value = false;
  batchDeleteOpen.value = false;
}

function toggleSelectMode() {
  if (selecting.value) exitSelectMode();
  else enterSelectMode();
}

function toggleItemSelected(id: string, range = false) {
  const list = visibleMetas.value;
  const next = new Set(selectedIds.value);
  if (range && lastSelectedId.value) {
    const a = list.findIndex((m) => m.id === lastSelectedId.value);
    const b = list.findIndex((m) => m.id === id);
    if (a !== -1 && b !== -1) {
      const [start, end] = a < b ? [a, b] : [b, a];
      for (let i = start; i <= end; i++) next.add(list[i].id);
      selectedIds.value = next;
      lastSelectedId.value = id;
      return;
    }
  }
  if (next.has(id)) next.delete(id);
  else next.add(id);
  selectedIds.value = next;
  lastSelectedId.value = id;
}

function onListClickCapture(e: MouseEvent) {
  if (e.button !== 0) return;
  const target = e.target as HTMLElement | null;
  if (!selecting.value && target?.closest(".antd-conversations-menu-icon")) return;
  const itemEl = target?.closest(".antd-conversations-item");
  const id = itemEl?.querySelector<HTMLElement>("[data-conv-id]")?.dataset.convId;
  if (!id) return;
  const modKey = isMac.value ? e.metaKey : e.ctrlKey;
  if (selecting.value) {
    e.preventDefault();
    e.stopPropagation();
    toggleItemSelected(id, e.shiftKey);
    return;
  }
  if (modKey || e.shiftKey) {
    e.preventDefault();
    e.stopPropagation();
    selecting.value = true;
    if (e.shiftKey && store.activeId && visibleMetas.value.some((m) => m.id === store.activeId)) {
      lastSelectedId.value = store.activeId;
      toggleItemSelected(id, true);
    } else {
      toggleItemSelected(id, false);
    }
  }
}

function onConvCtxAction(action: "pin" | "rename" | "archive" | "delete" | "select") {
  const m = convCtx.value.meta;
  closeConvCtx();
  if (!m) return;
  if (action === "select") {
    enterSelectMode(m.id);
    return;
  }
  if (action === "pin") void pin(m.id, !m.pinned);
  if (action === "rename") void startRename(m);
  if (action === "archive") void toggleArchive(m);
  if (action === "delete") toDelete.value = m;
}

function onCtxKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") {
    if (convCtx.value.open) {
      closeConvCtx();
    } else if (selecting.value && !renaming.value && !toDelete.value && !batchArchiveOpen.value && !batchDeleteOpen.value) {
      exitSelectMode();
    }
    return;
  }
  if (selecting.value && (isMac.value ? e.metaKey : e.ctrlKey) && e.key.toLowerCase() === "a") {
    const tag = (document.activeElement as HTMLElement | null)?.tagName;
    if (tag !== "INPUT" && tag !== "TEXTAREA" && !(document.activeElement as HTMLElement | null)?.isContentEditable) {
      e.preventDefault();
      toggleSelectAll();
    }
  }
}

onMounted(() => {
  window.addEventListener("pointerdown", closeConvCtx);
  window.addEventListener("blur", closeConvCtx);
  window.addEventListener("keydown", onCtxKeydown);
});
onBeforeUnmount(() => {
  window.removeEventListener("pointerdown", closeConvCtx);
  window.removeEventListener("blur", closeConvCtx);
  window.removeEventListener("keydown", onCtxKeydown);
});

const PINNED_GROUP_KEY = "__pinned__";
const NO_PROJECT_KEY = "__no_project__";
const BOT_GROUP_PREFIX = "__bot__:";
const COLLAPSED_PROJECTS_KEY = "oc.collapsedProjects";

const groupMode = computed<"time" | "project">(() =>
  store.settings?.conversationGroupBy === "project" ? "project" : "time",
);
const isProjectMode = computed(() => !showArchived.value && groupMode.value === "project");

const collapsedProjects = ref<Set<string>>((() => {
  try {
    const raw = JSON.parse(localStorage.getItem(COLLAPSED_PROJECTS_KEY) || "[]") as unknown;
    return new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set<string>();
  }
})());

function persistCollapsedProjects(next: Set<string>) {
  collapsedProjects.value = next;
  try {
    localStorage.setItem(COLLAPSED_PROJECTS_KEY, JSON.stringify([...next]));
  } catch {
    /* ignore storage errors */
  }
}

function normalizeProjectPath(p: string): string {
  const trimmed = p.trim().replace(/\\/g, "/");
  if (!trimmed) return "";
  if (trimmed === "/" || /^[a-zA-Z]:\/?$/.test(trimmed)) {
    return trimmed.replace(/\/?$/, "/");
  }
  return trimmed.replace(/\/+$/, "");
}

function projectPathOf(m: Meta): string {
  return normalizeProjectPath(m.worktreeRepo || m.cwd || "");
}

function projectKeyOf(m: Meta): string {
  if (m.botId) return `${BOT_GROUP_PREFIX}${m.botId}`;
  return projectPathOf(m) || NO_PROJECT_KEY;
}

function formatDisplayPath(p: string): string {
  const norm = normalizeProjectPath(p);
  const home = normalizeProjectPath(store.boot?.home ?? "");
  if (home && norm === home) return "~";
  if (home && norm.startsWith(`${home}/`)) return `~${norm.slice(home.length)}`;
  return norm;
}

const groupRank = (m: Meta) => {
  if (m.pinned) return 0;
  const d = new Date(m.updatedAt);
  const today = new Date();
  const day = 86_400_000;
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  if (d.getTime() >= startOfToday) return 1;
  if (d.getTime() >= startOfToday - day) return 2;
  if (d.getTime() >= startOfToday - 7 * day) return 3;
  return 4;
};
const groupName = (m: Meta) => ["置顶", "今天", "昨天", "近 7 天", "更早"][groupRank(m)];

const archivedCount = computed(() => sortedMetas.value.filter((m) => isArchived(m.id)).length);

const filtered = computed(() => {
  const q = store.search.trim().toLowerCase();
  const list = sortedMetas.value
    .filter((m) => (showArchived.value ? isArchived(m.id) : !isArchived(m.id)))
    // Keep active Bots' conversations categorized inside the Bots section unless searching or viewing archive
    .filter((m) => showArchived.value || Boolean(q) || !m.botId || !botById(m.botId))
    .filter(
      (m) =>
        !q ||
        m.title.toLowerCase().includes(q) ||
        m.cwd.toLowerCase().includes(q) ||
        (m.worktreeRepo ?? "").toLowerCase().includes(q) ||
        (m.botName ?? "").toLowerCase().includes(q) ||
        m.agentName.toLowerCase().includes(q),
    );

  if (showArchived.value) {
    return list.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  if (groupMode.value === "project") {
    const latestByProject = new Map<string, number>();
    for (const m of list) {
      if (m.pinned) continue;
      const key = projectKeyOf(m);
      const prev = latestByProject.get(key) ?? -1;
      if (m.updatedAt > prev) latestByProject.set(key, m.updatedAt);
    }
    return list.sort((a, b) => {
      if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
      if (a.pinned && b.pinned) return b.updatedAt - a.updatedAt;
      const pa = projectKeyOf(a);
      const pb = projectKeyOf(b);
      if (pa !== pb) {
        const diff = (latestByProject.get(pb) ?? 0) - (latestByProject.get(pa) ?? 0);
        if (diff !== 0) return diff;
        return pa.localeCompare(pb);
      }
      return b.updatedAt - a.updatedAt;
    });
  }

  return list.sort((a, b) => groupRank(a) - groupRank(b) || b.updatedAt - a.updatedAt);
});

const projectMetaInfo = computed(() => {
  const rawPathByKey = new Map<string, string>();
  for (const m of filtered.value) {
    if (m.botId) continue;
    const raw = (m.worktreeRepo || m.cwd || "").trim();
    const key = normalizeProjectPath(raw);
    if (key && !rawPathByKey.has(key)) {
      rawPathByKey.set(key, raw);
    }
  }
  const keys = [...rawPathByKey.keys()];
  const baseCount = new Map<string, number>();
  for (const k of keys) {
    const base = shortDir(k);
    baseCount.set(base, (baseCount.get(base) ?? 0) + 1);
  }
  const labelByKey = new Map<string, string>();
  const twoSegCount = new Map<string, number>();
  for (const k of keys) {
    const base = shortDir(k);
    if ((baseCount.get(base) ?? 0) <= 1) {
      labelByKey.set(k, base);
    } else {
      const segs = formatDisplayPath(k).split("/").filter(Boolean);
      const two = segs.length >= 2 ? `${segs[segs.length - 2]}/${segs[segs.length - 1]}` : formatDisplayPath(k);
      twoSegCount.set(two, (twoSegCount.get(two) ?? 0) + 1);
      labelByKey.set(k, two);
    }
  }
  for (const k of keys) {
    const lbl = labelByKey.get(k);
    if (lbl && (twoSegCount.get(lbl) ?? 0) > 1) {
      labelByKey.set(k, formatDisplayPath(k));
    }
  }
  return { rawPathByKey, labelByKey };
});

const projectGroupKeys = computed(() => {
  if (!isProjectMode.value) return [];
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const m of filtered.value) {
    if (m.pinned) continue;
    const key = projectKeyOf(m);
    if (!seen.has(key)) {
      seen.add(key);
      keys.push(key);
    }
  }
  return keys;
});

const expandedProjectKeys = computed(() => {
  if (!isProjectMode.value) return [];
  if (store.search.trim()) return projectGroupKeys.value;
  return projectGroupKeys.value.filter((k) => !collapsedProjects.value.has(k));
});

function onProjectExpand(nextExpandedKeys: string[]) {
  if (store.search.trim()) return;
  const expandedSet = new Set(nextExpandedKeys);
  const next = new Set(collapsedProjects.value);
  for (const k of projectGroupKeys.value) {
    if (expandedSet.has(k)) next.delete(k);
    else next.add(k);
  }
  persistCollapsedProjects(next);
}

function startNewInProject(groupKey: string) {
  if (collapsedProjects.value.has(groupKey)) {
    const next = new Set(collapsedProjects.value);
    next.delete(groupKey);
    persistCollapsedProjects(next);
  }
  if (groupKey.startsWith(BOT_GROUP_PREFIX)) {
    const botId = groupKey.slice(BOT_GROUP_PREFIX.length);
    void openBotChat(botId).catch((e) => {
      message.error(e instanceof Error ? e.message : String(e));
    });
    return;
  }
  const dir = projectMetaInfo.value.rawPathByKey.get(groupKey) ?? groupKey;
  newConversationInDir(dir);
}

function renderProjectGroupLabel(group: string, info: { groupInfo: { data: unknown[] } }) {
  if (group === PINNED_GROUP_KEY) return "置顶";
  const count = info.groupInfo.data.length;

  if (group.startsWith(BOT_GROUP_PREFIX)) {
    const botId = group.slice(BOT_GROUP_PREFIX.length);
    const bot = botById(botId);
    const firstItem = info.groupInfo.data[0] as { "data-meta"?: Meta } | undefined;
    const displayName = bot?.name || firstItem?.["data-meta"]?.botName || "Bot";
    const canAdd = Boolean(bot) && !selecting.value;

    return h("div", { class: ["proj-group-head", { "has-add": canAdd }], title: `Bot：${displayName}` }, [
      h(BotAvatar, { avatar: bot?.avatar, name: displayName, size: 15, class: "rounded-full flex-none" }),
      h("span", { class: "proj-group-name" }, displayName),
      h("span", { class: "proj-group-tail" }, [
        h("span", { class: "proj-group-count font-mono" }, String(count)),
        canAdd
          ? h(
              Tooltip,
              { title: `与「${displayName}」新开对话`, mouseEnterDelay: 0.35 },
              {
                default: () =>
                  h(
                    "button",
                    {
                      type: "button",
                      class: "proj-group-add",
                      "aria-label": `与「${displayName}」新开对话`,
                      onClick: (e: MouseEvent) => {
                        e.stopPropagation();
                        e.preventDefault();
                        startNewInProject(group);
                      },
                    },
                    [lucideIcon("plus", 12)],
                  ),
              },
            )
          : null,
      ]),
    ]);
  }

  const isNoProject = group === NO_PROJECT_KEY;
  const displayName = isNoProject ? "未关联目录" : (projectMetaInfo.value.labelByKey.get(group) ?? shortDir(group));
  const fullPath = isNoProject ? "未关联工作目录的对话" : formatDisplayPath(group);
  const canAdd = !isNoProject && !selecting.value;

  return h("div", { class: ["proj-group-head", { "has-add": canAdd }], title: fullPath }, [
    lucideIcon(isNoProject ? "message-square" : "folder", 12, "proj-group-ic"),
    h("span", { class: "proj-group-name" }, displayName),
    h("span", { class: "proj-group-tail" }, [
      h("span", { class: "proj-group-count font-mono" }, String(count)),
      canAdd
        ? h(
            Tooltip,
            { title: `在 ${displayName} 中新建对话`, mouseEnterDelay: 0.35 },
            {
              default: () =>
                h(
                  "button",
                  {
                    type: "button",
                    class: "proj-group-add",
                    "aria-label": `在 ${displayName} 中新建对话`,
                    onClick: (e: MouseEvent) => {
                      e.stopPropagation();
                      e.preventDefault();
                      startNewInProject(group);
                    },
                  },
                  [lucideIcon("plus", 12)],
                ),
            },
          )
        : null,
    ]),
  ]);
}

const groupableConfig = computed(() => {
  if (!isProjectMode.value) {
    return {
      label: (g: string) => g,
      collapsible: false as const,
    };
  }
  return {
    label: renderProjectGroupLabel,
    collapsible: (g: string) => g !== PINNED_GROUP_KEY,
    expandedKeys: expandedProjectKeys.value,
    onExpand: onProjectExpand,
  };
});

const items = computed<ConversationItemType[]>(() =>
  filtered.value.map((m) => ({
    key: m.id,
    label: m.title,
    group: showArchived.value
      ? "已归档"
      : groupMode.value === "project"
        ? m.pinned
          ? PINNED_GROUP_KEY
          : projectKeyOf(m)
        : groupName(m),
    "data-meta": m,
  })),
);

const visibleMetas = computed(() => {
  const main =
    !isProjectMode.value || store.search.trim()
      ? filtered.value
      : filtered.value.filter((m) => m.pinned || !collapsedProjects.value.has(projectKeyOf(m)));
  if (botsExpanded.value && !showArchived.value && !store.search.trim()) {
    return [...expandedBotMetas.value, ...main];
  }
  return main;
});

const visibleSelectedIds = computed(() =>
  visibleMetas.value.filter((m) => selectedIds.value.has(m.id)).map((m) => m.id),
);
const selectedCount = computed(() => visibleSelectedIds.value.length);
const allVisibleSelected = computed(
  () => visibleMetas.value.length > 0 && selectedCount.value === visibleMetas.value.length,
);
const someVisibleSelected = computed(
  () => selectedCount.value > 0 && selectedCount.value < visibleMetas.value.length,
);
const selectedMetasPreview = computed(() =>
  visibleMetas.value.filter((m) => selectedIds.value.has(m.id)).slice(0, 3),
);
const selectedWorktreeCount = computed(() =>
  visibleMetas.value.filter((m) => selectedIds.value.has(m.id) && m.worktree).length,
);

function toggleSelectAll() {
  if (allVisibleSelected.value) {
    const next = new Set(selectedIds.value);
    for (const m of visibleMetas.value) next.delete(m.id);
    selectedIds.value = next;
  } else {
    const next = new Set(selectedIds.value);
    for (const m of visibleMetas.value) next.add(m.id);
    selectedIds.value = next;
  }
}

watch(showArchived, () => {
  if (selecting.value) exitSelectMode();
});

watch(
  () => store.activeId,
  (id) => {
    if (!id || !isProjectMode.value) return;
    const m = store.metas[id];
    if (!m || m.pinned) return;
    const key = projectKeyOf(m);
    if (collapsedProjects.value.has(key)) {
      const next = new Set(collapsedProjects.value);
      next.delete(key);
      persistCollapsedProjects(next);
    }
  },
);

watch(
  () => filtered.value.length,
  (len) => {
    if (len === 0 && selecting.value) exitSelectMode();
  },
);

function ago(t: number) {
  const s = Math.max(1, Math.round((Date.now() - t) / 1000));
  if (s < 60) return "刚刚";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d`;
  return new Date(t).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

function shortDir(cwd: string) {
  const norm = normalizeProjectPath(cwd);
  const home = normalizeProjectPath(store.boot?.home ?? "");
  if (home && norm === home) return "~";
  return norm.split("/").filter(Boolean).pop() || norm;
}

async function copyPath(path: string) {
  if (!path) return;
  try {
    await navigator.clipboard.writeText(path);
    message.success("已复制目录路径");
  } catch {
    message.error("复制失败");
  }
}

function statusNodeFor(m: Meta) {
  const status = store.lives[m.id]?.status ?? m.status;
  const outcome = store.turnOutcome[m.id];

  // 1. Need you: waiting for user confirmation (highest priority)
  if ((m.pending ?? 0) > 0) {
    return h("span", { class: "st-pill need", title: "需要你的确认" }, [
      h("i", { class: "st-dot" }),
      "待确认",
    ]);
  }
  // 2. Running / connecting
  if (status === "running" || status === "connecting") {
    return h("span", { class: "st-pill run", title: status === "connecting" ? "连接中" : "运行中" }, [
      h("i", { class: "st-spin" }),
      status === "connecting" ? "连接中" : "运行中",
    ]);
  }
  // 3. Error
  if (status === "error" || outcome === "error") {
    return h("span", { class: "st-pill err", title: "执行出错" }, "失败");
  }
  // 4. Newly completed in background (unseen success)
  if (outcome === "unseen") {
    return h("span", { class: "st-pill ok", title: "任务已完成" }, [
      h("svg", { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "2.4", "stroke-linecap": "round", "stroke-linejoin": "round", class: "st-check" }, [
        h("polyline", { points: "20 6 9 17 4 12" }),
      ]),
      "已完成",
    ]);
  }
  // 5. Completed / ready conversation with replies (subtle quiet check)
  if (outcome === "done" || Boolean(m.preview)) {
    return h("span", { class: "st-done-ic", title: "已完成" }, [
      h("svg", { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "2.2", "stroke-linecap": "round", "stroke-linejoin": "round", class: "st-check" }, [
        h("polyline", { points: "20 6 9 17 4 12" }),
      ]),
    ]);
  }
  return null;
}

function renderConvLabel(item: ConversationItemType, inBotGroup = false) {
  const m = (item as unknown as { "data-meta": Meta })["data-meta"];
  const checked = selecting.value && selectedIds.value.has(m.id);
  const bot = !inBotGroup && m.botId ? botById(m.botId) : undefined;
  const leading = selecting.value
    ? h(
        "span",
        {
          class: ["conv-check", { "is-checked": checked }],
          role: "checkbox",
          "aria-checked": checked,
        },
        checked ? [lucideIcon("check", 11, "conv-check-ic")] : [],
      )
    : !inBotGroup && m.botId
      ? h(BotAvatar, { avatar: bot?.avatar, name: bot?.name || m.botName || "Bot", size: 15, class: "rounded-full conv-logo" })
      : h(ProviderIcon, { id: m.agentId, name: m.agentName, size: 13, class: "conv-logo" });

  const showDirTag = !m.botId && Boolean(m.cwd) && (!isProjectMode.value || Boolean(m.pinned) || Boolean(m.worktree));

  return h("div", { class: "conv", "data-conv-id": m.id, "data-selected": checked ? "true" : void 0 }, [
    h("div", { class: "conv-row" }, [
      leading,
      h("span", { class: "conv-title" }, m.title || "新对话"),
      statusNodeFor(m),
    ]),
    h("div", { class: "conv-meta" }, [
      h("span", { class: "conv-sub" }, [
        !inBotGroup && m.botId
          ? h(
              "span",
              {
                class: "inline-flex items-center px-[4px] h-[14px] rounded-[4px] bg-active text-ink-2 text-[9.5px] fw-560 leading-none flex-none",
                title: `Bot：${m.botName || m.botId}`,
              },
              "BOT",
            )
          : null,
        inBotGroup && m.pinned ? h(PushpinFilled, { class: "text-[10px] text-ink-3 flex-none" }) : null,
        h("span", { class: "conv-agent" }, m.agentName),
        showDirTag ? h("span", { class: "conv-sep" }, "·") : null,
        showDirTag
          ? h(
              "span",
              { class: "conv-dir mono" },
              m.worktree ? `wt:${m.worktreeBranch || shortDir(m.cwd)}` : shortDir(m.cwd),
            )
          : null,
      ]),
      h("span", { class: "conv-time mono" }, ago(m.updatedAt)),
    ]),
  ]);
}

function labelRender(item: ConversationItemType) {
  return renderConvLabel(item, false);
}

function botLabelRender(item: ConversationItemType) {
  return renderConvLabel(item, true);
}

async function toggleArchive(m: Meta) {
  const next = !isArchived(m.id);
  try {
    await setArchived(m.id, next);
  } catch (e) {
    message.error(e instanceof Error ? e.message : String(e));
    return;
  }
  if (next && store.activeId === m.id && !showArchived.value) {
    void select(null);
  }
  if (!next && showArchived.value && archivedCount.value === 0) {
    showArchived.value = false;
  }
  message.success(next ? "已归档" : "已恢复到对话列表");
}

const checkSquareIcon = () => lucideIcon("square-check", 13);

function menuFor(value: ConversationItemType) {
  const m = (value as unknown as { "data-meta": Meta })["data-meta"];
  const archived = isArchived(m.id);
  const item = (key: string, icon: () => unknown, label: string, danger = false) => ({
    key,
    danger,
    label: h("span", { class: "menu-item" }, [
      h("span" as never, { class: ["menu-icon", { "menu-icon-danger": danger }] }, [icon() as never]),
      label,
    ]),
  });
  return {
    items: [
      ...(archived ? [] : [item("pin", () => (m.pinned ? h(PushpinFilled) : h(PushpinOutlined)), m.pinned ? "取消置顶" : "置顶")]),
      item("rename", () => h(EditOutlined), "重命名"),
      item("archive", () => lucideIcon(archived ? "archive-arrow-up" : "archive-arrow-down", 13), archived ? "取消归档" : "归档"),
      item("select", checkSquareIcon, "多选"),
      { type: "divider" as const },
      item("delete", () => h(DeleteOutlined), "删除对话", true),
    ],
    onClick: ({ key }: { key: string }) => {
      if (key === "select") {
        enterSelectMode(m.id);
        return;
      }
      if (key === "pin") void pin(m.id, !m.pinned);
      if (key === "rename") void startRename(m);
      if (key === "archive") void toggleArchive(m);
      if (key === "delete") toDelete.value = m;
    },
  };
}

async function startRename(m: Meta) {
  renaming.value = m;
  newTitle.value = m.title;
  await nextTick();
  renameInput.value?.focus();
}

async function confirmRename() {
  const m = renaming.value;
  renaming.value = null;
  if (m && newTitle.value.trim() && newTitle.value.trim() !== m.title) {
    await rename(m.id, newTitle.value.trim());
  }
}

watch(toDelete, (m) => {
  if (m) {
    deleteWithWorktree.value = Boolean(m.worktree);
    deleteWithBranch.value = false;
  }
});

watch(batchDeleteOpen, (open) => {
  if (open) {
    batchDeleteWithWorktree.value = selectedWorktreeCount.value > 0;
    batchDeleteWithBranch.value = false;
  }
});

async function confirmDelete() {
  const m = toDelete.value;
  if (!m || deleteBusy.value) return;
  deleteBusy.value = true;
  try {
    if (m.worktree && deleteWithWorktree.value) {
      await removeWorktree(m.id, true, deleteWithBranch.value);
    }
    toDelete.value = null;
    await remove(m.id);
    message.success("已删除");
  } catch (e) {
    message.error(e instanceof Error ? e.message : String(e));
  } finally {
    deleteBusy.value = false;
  }
}

async function confirmBatchArchive() {
  const ids = [...visibleSelectedIds.value];
  batchArchiveOpen.value = false;
  if (!ids.length || batchBusy.value) return;
  const targetArchived = !showArchived.value;
  batchBusy.value = true;
  try {
    const results = await Promise.allSettled(ids.map((id) => setArchived(id, targetArchived)));
    const okCount = results.filter((r) => r.status === "fulfilled").length;
    const failCount = results.length - okCount;
    if (targetArchived && store.activeId && ids.includes(store.activeId)) {
      void select(null);
    }
    exitSelectMode();
    if (!targetArchived && showArchived.value && archivedCount.value === 0) {
      showArchived.value = false;
    }
    if (failCount === 0) {
      message.success(targetArchived ? `已归档 ${okCount} 个对话` : `已恢复 ${okCount} 个对话`);
    } else {
      message.warning(`已完成 ${okCount} 个，${failCount} 个失败`);
    }
  } finally {
    batchBusy.value = false;
  }
}

async function confirmBatchDelete() {
  const ids = [...visibleSelectedIds.value];
  const removeWts = batchDeleteWithWorktree.value;
  const removeBranches = removeWts && batchDeleteWithBranch.value;
  batchDeleteOpen.value = false;
  if (!ids.length || batchBusy.value) return;
  batchBusy.value = true;
  try {
    const results = await Promise.allSettled(
      ids.map(async (id) => {
        if (removeWts && store.metas[id]?.worktree) {
          await removeWorktree(id, true, removeBranches);
        }
        await remove(id);
      }),
    );
    const okCount = results.filter((r) => r.status === "fulfilled").length;
    const failCount = results.length - okCount;
    exitSelectMode();
    if (showArchived.value && archivedCount.value === 0) {
      showArchived.value = false;
    }
    if (failCount === 0) {
      message.success(`已删除 ${okCount} 个对话`);
    } else {
      message.warning(`已删除 ${okCount} 个，${failCount} 个失败`);
    }
  } finally {
    batchBusy.value = false;
  }
}

function toggleTheme() {
  void saveSettings({ theme: isDark.value ? "light" : "dark" });
}

async function onAvatarPick(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    message.error("请选择图片文件");
    return;
  }
  try {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new window.Image();
        img.onload = () => {
          const size = 160;
          const canvas = document.createElement("canvas");
          canvas.width = size;
          canvas.height = size;
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            resolve(String(reader.result));
            return;
          }
          const side = Math.min(img.width, img.height);
          const sx = (img.width - side) / 2;
          const sy = (img.height - side) / 2;
          ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
          resolve(canvas.toDataURL("image/webp", 0.9));
        };
        img.onerror = reject;
        img.src = String(reader.result);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    setUserAvatar(dataUrl);
    message.success("头像已保存到本地");
  } catch {
    message.error("读取头像图片失败");
  }
}

const avatarMenu = computed(() => ({
  items: [
    {
      key: "upload",
      label: h("label", {
        for: "avatar-file-input",
        class: "block cursor-pointer",
        onClick: (event: MouseEvent) => event.stopPropagation(),
      }, store.userAvatar ? "更换本地头像" : "上传本地头像"),
      extra: h(Tooltip, {
        title: "头像仅保存在本机",
        placement: "top",
        align: { offset: [0, -22] },
        motion: { name: "" },
        trigger: ["hover", "focus"],
        mouseEnterDelay: 0.35,
      }, {
        default: () => h("span", {
          class: "inline-grid place-items-center text-ink-2 cursor-help",
          tabindex: 0,
          role: "img",
          "aria-label": "头像仅保存在本机",
          onClick: (event: MouseEvent) => event.stopPropagation(),
        }, [h(InfoCircleOutlined, { "aria-hidden": "true" })]),
      }),
    },
    ...(store.userAvatar ? [{ key: "reset", label: "恢复默认头像", danger: true }] : []),
  ],
  onClick: ({ key }: { key: string }) => {
    if (key === "reset") {
      setUserAvatar("");
      message.success("已恢复默认头像");
    }
  },
}));

const needsNode = computed(() => Boolean(store.boot?.nodeError));
const bots = computed(() => store.settings?.bots ?? []);
const botsExpanded = ref(false);
const expandedBotIds = ref<Set<string>>(new Set());

const stackedBots = computed(() => bots.value.slice(0, 5));
const overflowBotCount = computed(() => Math.max(0, bots.value.length - 5));

function botMetasOf(botId: string): Meta[] {
  return sortedMetas.value
    .filter((m) => !isArchived(m.id) && m.botId === botId)
    .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.updatedAt - a.updatedAt);
}

function botItemsOf(botId: string): ConversationItemType[] {
  return botMetasOf(botId).map((m) => ({
    key: m.id,
    label: m.title,
    "data-meta": m,
  }));
}

const expandedBotMetas = computed<Meta[]>(() => {
  if (!botsExpanded.value) return [];
  const res: Meta[] = [];
  for (const b of bots.value) {
    if (expandedBotIds.value.has(b.id)) {
      res.push(...botMetasOf(b.id));
    }
  }
  return res;
});

function botLiveBadge(botId: string): "need" | "run" | "unseen" | null {
  let hasRun = false;
  let hasUnseen = false;
  for (const m of botMetasOf(botId)) {
    if ((m.pending ?? 0) > 0) return "need";
    const st = store.lives[m.id]?.status ?? m.status;
    if (st === "running" || st === "connecting") hasRun = true;
    if (store.turnOutcome[m.id] === "unseen") hasUnseen = true;
  }
  if (hasRun) return "run";
  if (hasUnseen) return "unseen";
  return null;
}

function toggleBotsExpanded() {
  if (showArchived.value) showArchived.value = false;
  botsExpanded.value = !botsExpanded.value;
}

function isBotExpanded(botId: string): boolean {
  return expandedBotIds.value.has(botId);
}

function toggleBotRow(botId: string) {
  const next = new Set(expandedBotIds.value);
  if (next.has(botId)) next.delete(botId);
  else next.add(botId);
  expandedBotIds.value = next;
}

watch(
  () => store.activeId,
  (id, prev) => {
    if (!id || id === prev) return;
    const m = store.metas[id];
    if (m?.botId && botById(m.botId)) {
      botsExpanded.value = true;
      if (!expandedBotIds.value.has(m.botId)) {
        const next = new Set(expandedBotIds.value);
        next.add(m.botId);
        expandedBotIds.value = next;
      }
    }
  },
);

watch(bots, (list) => {
  const valid = new Set(list.map((b) => b.id));
  if (list.length === 0) {
    botsExpanded.value = false;
    expandedBotIds.value = new Set();
    return;
  }
  let changed = false;
  const next = new Set<string>();
  for (const id of expandedBotIds.value) {
    if (valid.has(id)) next.add(id);
    else changed = true;
  }
  if (changed) expandedBotIds.value = next;
});

async function startBotConversation(botId: string) {
  try {
    botsExpanded.value = true;
    if (!expandedBotIds.value.has(botId)) {
      const next = new Set(expandedBotIds.value);
      next.add(botId);
      expandedBotIds.value = next;
    }
    await openBotChat(botId);
  } catch (e) {
    message.error(e instanceof Error ? e.message : String(e));
  }
}
</script>

<template>
  <aside class="oc-sidebar group w-[262px] h-full flex-none flex flex-col relative min-h-0">
    <div
      class="h-titlebar flex-none flex items-center gap-2 pr-[10px] drag"
      :class="isMac ? 'pl-[78px]' : 'pl-[14px]'"
    >
      <div class="flex-1" />
      <div
        class="flex items-center gap-[2px] transition-opacity duration-150 ease-oc no-drag"
        :class="selecting ? 'opacity-100' : 'opacity-55 group-hover:opacity-100'"
      >
        <Tooltip
          v-if="filtered.length > 0 || expandedBotMetas.length > 0 || selecting"
          :title="selecting ? '退出多选 (Esc)' : `多选 (${isMac ? '⌘' : 'Ctrl'}+点击)`"
          :mouse-enter-delay="0.4"
        >
          <button
            class="inline-grid place-items-center w-[26px] h-[26px] border-0 rounded-[7px] cursor-pointer transition-colors duration-140"
            :class="selecting ? 'bg-hover text-ink' : 'bg-transparent text-ink-3 hover:bg-hover hover:text-ink'"
            aria-label="多选"
            @click="toggleSelectMode"
          >
            <Icon icon="lucide:square-check" :width="14" :height="14" />
          </button>
        </Tooltip>
        <Tooltip :title="`收起侧栏 (${isMac ? '⌘' : 'Ctrl'} B)`" :mouse-enter-delay="0.4">
          <button class="inline-grid place-items-center w-[26px] h-[26px] border-0 rounded-[7px] bg-transparent text-ink-3 cursor-pointer text-[14px] transition-colors duration-140 hover:bg-hover hover:text-ink" @click="store.sidebarCollapsed = true">
            <MenuFoldOutlined />
          </button>
        </Tooltip>
      </div>
    </div>

    <div class="px-[10px] pt-[2px] pb-2 flex flex-col gap-[6px]">
      <button
        class="group/new w-full h-[34px] flex items-center gap-2 px-[10px] rounded-[9px] border border-solid border-transparent bg-[color-mix(in_srgb,var(--ink)_4.5%,transparent)] text-ink text-[13px] fw-530 whitespace-nowrap cursor-pointer transition-all duration-140 ease-oc hover:bg-surface hover:border-line active:scale-[0.99]"
        @click="newConversation()"
      >
        <!-- Lucide SquarePen -->
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round" class="w-[14px] h-[14px] text-ink-2 flex-none">
          <path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
          <path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z" />
        </svg>
        <span>新对话</span>
        <span class="kbd ml-auto !bg-transparent !border-transparent opacity-65 group-hover/new:!bg-hover group-hover/new:!border-line group-hover/new:opacity-100">{{ isMac ? "⌘" : "Ctrl" }} N</span>
      </button>

      <label
        class="group/search h-8 flex items-center gap-[7px] px-[9px] rounded-[9px] border border-solid border-transparent bg-[color-mix(in_srgb,var(--ink)_3.8%,transparent)] cursor-text transition-all duration-160 ease-oc hover:bg-surface-2 hover:border-line focus-within:bg-surface focus-within:border-line-strong focus-within:shadow-card"
        for="conv-search"
      >
        <!-- Lucide Search -->
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round" class="w-[13.5px] h-[13.5px] text-ink-3 flex-none transition-colors duration-140 group-focus-within/search:text-ink-2">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          id="conv-search"
          v-model="store.search"
          type="text"
          class="flex-1 min-w-0 border-0 outline-none bg-transparent text-ink text-[12.5px] leading-[18px] p-0 placeholder:text-ink-3 focus-visible:shadow-none"
          placeholder="搜索对话…"
          @keydown.esc="store.search = ''"
        />
        <button
          v-if="store.search"
          type="button"
          class="inline-grid place-items-center w-4 h-4 border-0 rounded-full bg-hover text-ink-3 cursor-pointer flex-none p-0 transition-colors duration-120 hover:bg-active hover:text-ink"
          aria-label="清空搜索"
          @click.prevent="store.search = ''"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-[10px] h-[10px]">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
        <span v-else class="kbd !bg-transparent !border-transparent opacity-55 flex-none">{{ isMac ? "⌘" : "Ctrl" }} K</span>
      </label>

      <!-- Overlapping Bots Avatar Stack Trigger (hover unfolds smoothly, click expands all Bots below) -->
      <div
        v-if="bots.length > 0"
        class="h-[32px] px-[4px] flex items-center justify-between gap-2"
      >
        <button
          type="button"
          class="oc-bot-stack h-full px-0 border-0 bg-transparent cursor-pointer"
          :class="{ 'is-open': botsExpanded }"
          :aria-expanded="botsExpanded"
          aria-label="展开或收起 Bots"
          @click="toggleBotsExpanded"
        >
          <span
            v-for="b in stackedBots"
            :key="b.id"
            class="oc-bot-stack-item relative w-[24px] h-[24px] rounded-full border-[1.5px] border-solid border-[var(--bg)] bg-modal inline-flex items-center justify-center flex-none"
          >
            <BotAvatar :avatar="b.avatar" :name="b.name" :size="21" class="rounded-full" />
            <span
              v-if="botLiveBadge(b.id)"
              class="absolute -right-[1px] -bottom-[1px] w-[7px] h-[7px] rounded-full border-[1.5px] border-solid border-[var(--bg)]"
              :class="botLiveBadge(b.id) === 'need' ? 'bg-warn' : 'bg-ok'"
            />
          </span>
          <span
            v-if="overflowBotCount > 0"
            class="oc-bot-stack-item relative w-[24px] h-[24px] rounded-full border-[1.5px] border-solid border-[var(--bg)] bg-active text-ink-2 text-[9.5px] font-mono fw-580 inline-grid place-items-center flex-none"
          >
            +{{ overflowBotCount }}
          </span>
        </button>

        <div class="flex items-center gap-[1px] flex-none">
          <Tooltip title="新建 Bot" :mouse-enter-delay="0.3">
            <button
              type="button"
              class="inline-grid place-items-center w-6 h-6 border-0 rounded-[7px] bg-transparent text-ink-3 cursor-pointer transition-colors duration-140 hover:bg-hover hover:text-ink"
              aria-label="新建 Bot"
              @click="openBots('create')"
            >
              <Icon icon="lucide:plus" :width="13.5" :height="13.5" />
            </button>
          </Tooltip>
          <Tooltip title="管理 Bots" :mouse-enter-delay="0.3">
            <button
              type="button"
              class="inline-grid place-items-center w-6 h-6 border-0 rounded-[7px] bg-transparent text-ink-3 cursor-pointer transition-colors duration-140 hover:bg-hover hover:text-ink"
              aria-label="管理 Bots"
              @click="openBots('list')"
            >
              <Icon icon="lucide:ellipsis" :width="13.5" :height="13.5" />
            </button>
          </Tooltip>
        </div>
      </div>

      <button
        v-else
        type="button"
        class="group/bots w-full h-[30px] flex items-center gap-2 px-[9px] rounded-[8px] border border-solid border-transparent bg-transparent text-ink-3 text-[12px] fw-500 whitespace-nowrap cursor-pointer transition-all duration-140 ease-oc hover:bg-surface-2 hover:border-line hover:text-ink"
        @click="openBots('create')"
      >
        <Icon icon="lucide:bot" :width="13.5" :height="13.5" class="flex-none opacity-80" />
        <span>Bots</span>
        <span class="ml-auto text-[11px] opacity-70 group-hover/bots:opacity-100">+ 新建</span>
      </button>
    </div>

    <div v-if="showArchived" class="flex-none flex items-center justify-between px-[10px] pt-1 pb-[6px]">
      <button
        class="inline-flex items-center gap-[6px] border-0 bg-transparent text-ink-2 text-[12px] fw-520 px-[6px] py-[3px] rounded-[7px] cursor-pointer transition-colors duration-130 hover:bg-hover hover:text-ink"
        @click="showArchived = false"
      >
        <ArrowLeftOutlined />
        <span>返回对话</span>
      </button>
      <span class="ml-auto text-[11px] text-ink-3 px-[6px] leading-[17px] rounded-full bg-hover font-mono">{{ archivedCount }}</span>
    </div>

    <div v-if="selecting" class="flex-none flex items-center gap-[6px] pl-[18px] pr-[10px] pt-[2px] pb-[6px]">
      <button
        type="button"
        class="inline-flex items-center gap-[7px] border-0 bg-transparent py-[3px] px-[4px] -ml-[4px] rounded-[7px] text-[12px] text-ink-2 cursor-pointer transition-colors duration-130 hover:bg-hover hover:text-ink"
        @click="toggleSelectAll"
      >
        <span
          class="conv-check"
          :class="{ 'is-checked': allVisibleSelected || someVisibleSelected }"
        >
          <Icon v-if="allVisibleSelected" icon="lucide:check" :width="11" :height="11" class="conv-check-ic" />
          <Icon v-else-if="someVisibleSelected" icon="lucide:minus" :width="11" :height="11" class="conv-check-ic" />
        </span>
        <span>{{ allVisibleSelected ? '取消全选' : '全选' }}</span>
      </button>
      <span class="text-[11px] text-ink-3 font-mono">{{ selectedCount }} / {{ visibleMetas.length }}</span>
      <div class="ml-auto inline-flex items-center gap-[2px]">
        <Tooltip :title="showArchived ? `取消归档 (${selectedCount})` : `归档 (${selectedCount})`" :mouse-enter-delay="0.3">
          <button
            type="button"
            class="inline-grid place-items-center w-[26px] h-[26px] border-0 rounded-[7px] bg-transparent text-ink-2 text-[13.5px] cursor-pointer transition-colors duration-140 hover:not-disabled:bg-hover hover:not-disabled:text-ink disabled:opacity-35 disabled:cursor-not-allowed"
            :disabled="selectedCount === 0 || batchBusy"
            :aria-label="showArchived ? '取消归档' : '归档'"
            @click="batchArchiveOpen = true"
          >
            <Icon v-if="showArchived" icon="lucide:archive-arrow-up" :width="14" :height="14" />
            <Icon v-else icon="lucide:archive-arrow-down" :width="14" :height="14" />
          </button>
        </Tooltip>
        <Tooltip :title="`删除 (${selectedCount})`" :mouse-enter-delay="0.3">
          <button
            type="button"
            class="inline-grid place-items-center w-[26px] h-[26px] border-0 rounded-[7px] bg-transparent text-err text-[13.5px] cursor-pointer transition-colors duration-140 hover:not-disabled:bg-err-soft disabled:opacity-35 disabled:cursor-not-allowed"
            :disabled="selectedCount === 0 || batchBusy"
            aria-label="删除"
            @click="batchDeleteOpen = true"
          >
            <DeleteOutlined />
          </button>
        </Tooltip>
      </div>
    </div>

    <div
      class="flex-1 min-h-0 overflow-y-auto px-2 pb-[10px]"
      @click.capture="onListClickCapture"
      @contextmenu="onListContextMenu"
      @scroll="closeConvCtx"
    >
      <!-- Smoothly Expandable Bots Tree (native conversation list UI) -->
      <div
        v-if="bots.length > 0 && !showArchived && !store.search.trim()"
        class="oc-collapse"
        :class="{ 'is-open': botsExpanded }"
      >
        <div class="oc-collapse-inner">
          <div class="flex flex-col gap-[2px] pb-[4px]">
            <div v-for="b in bots" :key="b.id">
              <div
                role="button"
                tabindex="0"
                class="group/bothead h-[28px] px-[6px] mt-[2px] rounded-[8px] flex items-center gap-[4px] text-[12px] fw-540 text-ink-2 cursor-pointer select-none transition-colors duration-140 hover:bg-hover hover:text-ink"
                :aria-expanded="isBotExpanded(b.id)"
                @click="toggleBotRow(b.id)"
                @keydown.enter.prevent="toggleBotRow(b.id)"
              >
                <span class="w-[14px] h-[14px] inline-grid place-items-center text-ink-3 flex-none">
                  <Icon
                    icon="lucide:chevron-down"
                    :width="11"
                    :height="11"
                    class="oc-chevron"
                    :class="{ 'is-open': isBotExpanded(b.id) }"
                  />
                </span>
                <div class="relative flex-none ml-[2px]">
                  <BotAvatar :avatar="b.avatar" :name="b.name" :size="16" class="rounded-full" />
                  <span
                    v-if="!isBotExpanded(b.id) && botLiveBadge(b.id)"
                    class="absolute -right-[2px] -bottom-[2px] w-[6px] h-[6px] rounded-full border border-solid border-[var(--bg)]"
                    :class="botLiveBadge(b.id) === 'need' ? 'bg-warn' : 'bg-ok'"
                  />
                </div>
                <span class="flex-1 min-w-0 truncate ml-[2px]" :class="isBotExpanded(b.id) ? 'text-ink' : ''">
                  {{ b.name }}
                </span>
                <div class="relative flex-none h-[20px] min-w-[20px] inline-flex items-center justify-end">
                  <span
                    v-if="botMetasOf(b.id).length > 0"
                    class="w-[20px] text-center text-[10.5px] font-mono text-ink-3 opacity-75 group-hover/bothead:opacity-0 group-focus-within/bothead:opacity-0 transition-opacity duration-140"
                  >
                    {{ botMetasOf(b.id).length }}
                  </span>
                  <div class="absolute right-0 inset-y-0 flex items-center gap-[1px] opacity-0 pointer-events-none group-hover/bothead:opacity-100 group-hover/bothead:pointer-events-auto group-focus-within/bothead:opacity-100 group-focus-within/bothead:pointer-events-auto transition-opacity duration-140">
                    <Tooltip :title="`与「${b.name}」新对话`" :mouse-enter-delay="0.3">
                      <button
                        type="button"
                        class="w-[20px] h-[20px] border-0 p-0 rounded-[6px] bg-transparent text-ink-2 inline-grid place-items-center cursor-pointer transition-colors hover:bg-active hover:text-ink"
                        :aria-label="`与 ${b.name} 新对话`"
                        @click.stop="startBotConversation(b.id)"
                      >
                        <Icon icon="lucide:plus" :width="12" :height="12" />
                      </button>
                    </Tooltip>
                    <Tooltip :title="`配置「${b.name}」`" :mouse-enter-delay="0.3">
                      <button
                        type="button"
                        class="w-[20px] h-[20px] border-0 p-0 rounded-[6px] bg-transparent text-ink-3 inline-grid place-items-center cursor-pointer transition-colors hover:bg-active hover:text-ink"
                        :aria-label="`配置 ${b.name}`"
                        @click.stop="openBots('list', b.id)"
                      >
                        <Icon icon="lucide:sliders-horizontal" :width="11.5" :height="11.5" />
                      </button>
                    </Tooltip>
                  </div>
                </div>
              </div>

              <!-- Smoothly Expandable Conversations of This Bot -->
              <div class="oc-collapse" :class="{ 'is-open': isBotExpanded(b.id) }">
                <div class="oc-collapse-inner pt-[1px]">
                  <Conversations
                    v-if="botItemsOf(b.id).length"
                    :items="botItemsOf(b.id)"
                    :active-key="selecting ? undefined : (store.activeId ?? undefined)"
                    :label-render="botLabelRender"
                    :menu="selecting ? undefined : menuFor"
                    class="oc-convs oc-bot-convs"
                    :class="{ 'is-selecting': selecting }"
                    @active-change="(key: string) => { if (!selecting) void select(key); }"
                  />
                  <button
                    v-else
                    type="button"
                    class="w-full border-0 bg-transparent pl-[24px] pr-[10px] py-[7px] rounded-[10px] flex items-center gap-2 text-[12px] text-ink-3 text-left cursor-pointer transition-colors duration-140 hover:bg-hover hover:text-ink"
                    @click="startBotConversation(b.id)"
                  >
                    <Icon icon="lucide:message-square-plus" :width="13" :height="13" class="flex-none opacity-75" />
                    <span class="truncate">开始新对话…</span>
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div v-if="items.length" class="h-[1px] bg-line mx-[6px] my-[4px]" />
        </div>
      </div>

      <Conversations
        v-if="items.length"
        :items="items"
        :active-key="selecting ? undefined : (store.activeId ?? undefined)"
        :label-render="labelRender"
        :menu="selecting ? undefined : menuFor"
        :groupable="groupableConfig"
        class="oc-convs"
        :class="{ 'is-selecting': selecting, 'is-project-mode': isProjectMode }"
        @active-change="(key: string) => { if (!selecting) void select(key); }"
      />
      <div
        v-else-if="!botsExpanded || showArchived || Boolean(store.search.trim())"
        class="flex flex-col items-center justify-center gap-2 py-10 px-[14px] text-center"
      >
        <InboxOutlined v-if="showArchived" class="text-[18px] text-ink-3 opacity-50" />
        <MessageOutlined v-else class="text-[18px] text-ink-3 opacity-50" />
        <div class="text-[12.5px] text-ink-3">
          {{ store.search ? "没有匹配的对话" : showArchived ? "还没有归档的对话" : "还没有对话记录" }}
        </div>
        <button
          v-if="store.search"
          class="border border-solid border-line bg-surface text-ink-2 text-[11.5px] rounded-[7px] px-[10px] py-[3px] cursor-pointer hover:text-ink hover:border-line-strong"
          @click="store.search = ''"
        >
          清空搜索
        </button>
      </div>
    </div>

    <div v-if="!showArchived && archivedCount > 0" class="flex-none px-[10px] pt-1 pb-[6px]">
      <button
        class="w-full h-[30px] flex items-center gap-[7px] px-[9px] border border-solid border-transparent rounded-[8px] bg-transparent text-ink-3 text-[12px] cursor-pointer transition-colors duration-140 hover:bg-hover hover:border-line hover:text-ink"
        @click="showArchived = true"
      >
        <InboxOutlined class="text-[13px]" />
        <span>已归档</span>
        <span class="ml-auto text-[11px] text-ink-3 px-[6px] leading-[17px] rounded-full bg-hover font-mono">{{ archivedCount }}</span>
      </button>
    </div>

    <div class="flex-none px-[10px] pt-2 pb-[10px] border-0 border-t border-solid border-line flex flex-col gap-[5px]">
      <button
        v-if="needsNode"
        class="flex items-center gap-2 border border-solid border-[color-mix(in_srgb,var(--err)_30%,transparent)] bg-err-soft text-err rounded-[9px] px-[9px] py-[6px] text-[12px] cursor-pointer text-left"
        @click="store.settingsOpen = true"
      >
        <span class="w-[6px] h-[6px] rounded-full flex-none bg-err" />
        <span>未检测到 Node.js</span>
      </button>
      <div class="flex items-center gap-[5px]">
        <Dropdown :menu="avatarMenu" :trigger="['click']" placement="topLeft" root-class="oc-avatar-dropdown">
          <button
            class="group/avatar relative w-7 h-7 p-0 rounded-full border border-solid border-line-strong bg-surface text-ink-2 grid place-items-center overflow-hidden cursor-pointer flex-none shadow-card transition-colors duration-140 ease-oc hover:border-ink-solid"
            aria-label="用户头像"
          >
            <img v-if="store.userAvatar" :src="store.userAvatar" alt="用户头像" class="w-full h-full object-cover block" />
            <!-- Lucide User -->
            <svg
              v-else
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
              class="w-[14px] h-[14px]"
            >
              <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
            <span
              class="absolute inset-0 grid place-items-center bg-[rgba(15,23,42,0.56)] text-white opacity-0 transition-opacity duration-140 group-hover/avatar:opacity-100"
              aria-hidden="true"
            >
              <!-- Lucide Camera -->
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-3 h-3">
                <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
                <circle cx="12" cy="13" r="3" />
              </svg>
            </span>
          </button>
        </Dropdown>
        <input id="avatar-file-input" type="file" accept="image/*" hidden @change="onAvatarPick" />

        <span class="flex-1" />

        <Tooltip :title="`设置 (${isMac ? '⌘' : 'Ctrl'} ,)`" :mouse-enter-delay="0.35">
          <button
            class="inline-grid place-items-center w-7 h-7 rounded-[8px] border border-solid border-transparent bg-transparent text-ink-3 cursor-pointer transition-all duration-140 ease-oc hover:bg-hover hover:border-line hover:text-ink active:scale-[0.94]"
            aria-label="设置"
            @click="store.settingsOpen = true"
          >
            <!-- Lucide Settings -->
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.85"
              stroke-linecap="round"
              stroke-linejoin="round"
              class="w-[15px] h-[15px] block"
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.6.85 1 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        </Tooltip>

        <Tooltip :title="isDark ? '切换到浅色模式' : '切换到深色模式'" :mouse-enter-delay="0.35">
          <button
            class="inline-grid place-items-center w-7 h-7 rounded-[8px] border border-solid border-transparent bg-transparent text-ink-3 cursor-pointer transition-all duration-140 ease-oc hover:bg-hover hover:border-line hover:text-ink active:scale-[0.94]"
            aria-label="切换主题"
            @click="toggleTheme"
          >
            <!-- Lucide Sun (shown in dark mode) -->
            <svg
              v-if="isDark"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.85"
              stroke-linecap="round"
              stroke-linejoin="round"
              class="w-[15px] h-[15px] block"
            >
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2" />
              <path d="M12 20v2" />
              <path d="m4.93 4.93 1.41 1.41" />
              <path d="m17.66 17.66 1.41 1.41" />
              <path d="M2 12h2" />
              <path d="M20 12h2" />
              <path d="m6.34 17.66-1.41 1.41" />
              <path d="m19.07 4.93-1.41 1.41" />
            </svg>
            <!-- Lucide Moon (shown in light mode) -->
            <svg
              v-else
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.85"
              stroke-linecap="round"
              stroke-linejoin="round"
              class="w-[15px] h-[15px] block"
            >
              <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
            </svg>
          </button>
        </Tooltip>
      </div>
    </div>

    <Modal
      :open="Boolean(renaming)"
      title="重命名对话"
      :width="380"
      centered
      ok-text="保存"
      cancel-text="取消"
      @ok="confirmRename"
      @cancel="renaming = null"
    >
      <Input ref="renameInput" v-model:value="newTitle" :maxlength="60" @press-enter="confirmRename" />
    </Modal>
    <Modal
      :open="Boolean(toDelete)"
      title="删除这个对话？"
      :width="400"
      centered
      ok-text="删除"
      ok-type="primary"
      :ok-button-props="{ danger: true }"
      cancel-text="取消"
      :confirm-loading="deleteBusy"
      @ok="confirmDelete"
      @cancel="toDelete = null"
    >
      <div class="flex flex-col gap-3 pt-1">
        <p class="text-[12.5px] text-ink-2 leading-[1.55] m-0">
          「{{ toDelete?.title }}」的记录会从本机删除，无法恢复。agent 那边的会话不受影响。
        </p>
        <div
          v-if="toDelete?.worktree"
          class="rounded-[10px] bg-surface-2 border border-solid border-line px-3 py-2.5 flex flex-col gap-2"
        >
          <Checkbox v-model:checked="deleteWithWorktree">
            <span class="text-[12.5px] text-ink">同时删除关联的 Worktree 目录</span>
          </Checkbox>
          <div v-if="deleteWithWorktree" class="pl-6 flex flex-col gap-1.5">
            <Checkbox v-if="toDelete.worktreeBranch" v-model:checked="deleteWithBranch">
              <span class="text-[12px] text-ink-2">
                同时删除分支 <code class="font-mono text-ink">{{ toDelete.worktreeBranch }}</code>
              </span>
            </Checkbox>
            <div class="flex items-start gap-1.5">
              <span class="font-mono text-[11px] text-ink-3 break-all leading-[1.45] flex-1">
                {{ toDelete.cwd }}
              </span>
              <Tooltip title="复制目录路径" :mouse-enter-delay="0.3">
                <button
                  type="button"
                  class="inline-grid place-items-center w-5 h-5 border-0 rounded-[5px] bg-transparent text-ink-3 cursor-pointer flex-none transition-colors duration-120 hover:bg-hover hover:text-ink"
                  aria-label="复制目录路径"
                  @click="copyPath(toDelete.cwd)"
                >
                  <CopyOutlined class="text-[11px]" />
                </button>
              </Tooltip>
            </div>
            <div class="text-[11px] text-ink-3 leading-[1.4]">
              若该目录存在未提交的代码改动，删除后将无法恢复。
            </div>
          </div>
        </div>
      </div>
    </Modal>
    <Modal
      :open="batchArchiveOpen"
      :title="showArchived ? `取消归档选中的 ${selectedCount} 个对话？` : `归档选中的 ${selectedCount} 个对话？`"
      :width="380"
      centered
      :ok-text="showArchived ? '取消归档' : '归档'"
      cancel-text="取消"
      :confirm-loading="batchBusy"
      @ok="confirmBatchArchive"
      @cancel="batchArchiveOpen = false"
    >
      <div class="flex flex-col gap-2">
        <p class="text-ink-2 m-0">
          {{ showArchived ? '这些对话会恢复到主对话列表。' : '归档后会从主对话列表隐藏，可随时在「已归档」中恢复。' }}
        </p>
        <ul v-if="selectedMetasPreview.length" class="m-0 pl-4 text-[12px] text-ink-3 flex flex-col gap-[3px]">
          <li v-for="m in selectedMetasPreview" :key="m.id" class="truncate">{{ m.title || '新对话' }}</li>
          <li v-if="selectedCount > selectedMetasPreview.length" class="list-none -ml-4 text-ink-3">等共 {{ selectedCount }} 个对话</li>
        </ul>
      </div>
    </Modal>
    <Modal
      :open="batchDeleteOpen"
      :title="`删除选中的 ${selectedCount} 个对话？`"
      :width="400"
      centered
      ok-text="删除"
      ok-type="primary"
      :ok-button-props="{ danger: true }"
      cancel-text="取消"
      :confirm-loading="batchBusy"
      @ok="confirmBatchDelete"
      @cancel="batchDeleteOpen = false"
    >
      <div class="flex flex-col gap-3 pt-1">
        <p class="text-[12.5px] text-ink-2 leading-[1.55] m-0">
          这些对话的记录会从本机永久删除，无法恢复。agent 那边的会话不受影响。
        </p>
        <ul v-if="selectedMetasPreview.length" class="m-0 pl-4 text-[12px] text-ink-3 flex flex-col gap-[3px]">
          <li v-for="m in selectedMetasPreview" :key="m.id" class="truncate">{{ m.title || '新对话' }}</li>
          <li v-if="selectedCount > selectedMetasPreview.length" class="list-none -ml-4 text-ink-3">等共 {{ selectedCount }} 个对话</li>
        </ul>
        <div
          v-if="selectedWorktreeCount > 0"
          class="rounded-[10px] bg-surface-2 border border-solid border-line px-3 py-2.5 flex flex-col gap-1.5"
        >
          <Checkbox v-model:checked="batchDeleteWithWorktree">
            <span class="text-[12.5px] text-ink">同时删除关联的 {{ selectedWorktreeCount }} 个 Worktree 目录</span>
          </Checkbox>
          <Checkbox v-if="batchDeleteWithWorktree" v-model:checked="batchDeleteWithBranch" class="pl-6">
            <span class="text-[12px] text-ink-2">同时删除关联分支</span>
          </Checkbox>
        </div>
      </div>
    </Modal>

    <Teleport to="body">
      <div
        v-if="convCtx.open && convCtx.meta"
        class="fixed z-[2100] min-w-[146px] p-[5px] rounded-[11px] bg-surface-strong glass border border-solid border-line-strong shadow-pop flex flex-col gap-[2px] select-none"
        :style="{ left: `${convCtx.x}px`, top: `${convCtx.y}px` }"
        @pointerdown.stop
        @contextmenu.prevent
      >
        <button
          v-if="!isArchived(convCtx.meta.id)"
          class="w-full border-0 bg-transparent text-ink text-[12.5px] text-left px-[10px] py-[6px] rounded-[7px] cursor-pointer inline-flex items-center gap-2 transition-colors duration-120 hover:bg-hover"
          @click="onConvCtxAction('pin')"
        >
          <PushpinFilled v-if="convCtx.meta.pinned" class="text-[13px] text-ink-3" />
          <PushpinOutlined v-else class="text-[13px] text-ink-3" />
          <span>{{ convCtx.meta.pinned ? '取消置顶' : '置顶' }}</span>
        </button>
        <button
          class="w-full border-0 bg-transparent text-ink text-[12.5px] text-left px-[10px] py-[6px] rounded-[7px] cursor-pointer inline-flex items-center gap-2 transition-colors duration-120 hover:bg-hover"
          @click="onConvCtxAction('rename')"
        >
          <EditOutlined class="text-[13px] text-ink-3" />
          <span>重命名</span>
        </button>
        <button
          class="w-full border-0 bg-transparent text-ink text-[12.5px] text-left px-[10px] py-[6px] rounded-[7px] cursor-pointer inline-flex items-center gap-2 transition-colors duration-120 hover:bg-hover"
          @click="onConvCtxAction('archive')"
        >
          <Icon v-if="isArchived(convCtx.meta.id)" icon="lucide:archive-arrow-up" :width="13" :height="13" class="text-ink-3" />
          <Icon v-else icon="lucide:archive-arrow-down" :width="13" :height="13" class="text-ink-3" />
          <span>{{ isArchived(convCtx.meta.id) ? '取消归档' : '归档' }}</span>
        </button>
        <button
          class="w-full border-0 bg-transparent text-ink text-[12.5px] text-left px-[10px] py-[6px] rounded-[7px] cursor-pointer inline-flex items-center gap-2 transition-colors duration-120 hover:bg-hover"
          @click="onConvCtxAction('select')"
        >
          <Icon icon="lucide:square-check" :width="13" :height="13" class="text-ink-3" />
          <span>多选</span>
        </button>
        <div class="h-[1px] bg-line my-[3px] mx-[6px]" />
        <button
          class="w-full border-0 bg-transparent text-err text-[12.5px] text-left px-[10px] py-[6px] rounded-[7px] cursor-pointer inline-flex items-center gap-2 transition-colors duration-120 hover:bg-err-soft"
          @click="onConvCtxAction('delete')"
        >
          <DeleteOutlined class="text-[13px] text-err" />
          <span>删除对话</span>
        </button>
      </div>
    </Teleport>
  </aside>
</template>

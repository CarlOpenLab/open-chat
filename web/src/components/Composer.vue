<script setup lang="ts">
import { Sender } from "@antdv-next/x";
import type { SenderPasteInfo, SenderProps, SenderRef } from "@antdv-next/x";
type SkillType = NonNullable<SenderProps["skill"]>;
type SlotConfigType = NonNullable<SenderProps["slotConfig"]>[number];
import { Dropdown, Tooltip, message } from "antdv-next";
import { computed, h, nextTick, ref, watch } from "vue";
import { api } from "../api";
import { resolvePermissionTarget, saveSettings, store, type PermissionMode, type QueuedMessage } from "../store";
import { userText } from "../transcript";
import type { Block, ConfigOption, GitInfo, LiveState, PermissionOption, SkillInfo } from "../types";
import ProviderPicker from "./ProviderPicker.vue";
type DeckKind = "permission" | "queue" | "files" | "skills";

export interface PendingPermission {
  turnId: string;
  requestId: string;
  title: string;
  detail?: string;
  options: PermissionOption[];
}
type EffortKey = "low" | "medium" | "high" | "xhigh" | "max";

interface SkillEntry {
  name: string;
  description?: string;
  kind: "skill" | "command";
  source?: "project" | "user";
}

const gitCache = new Map<string, { info: GitInfo | null; fallback: boolean }>();
const skillsCache = new Map<string, SkillInfo[]>();

const props = defineProps<{
  value: string;
  conversationId?: string;
  live: LiveState;
  agentId: string;
  agentName: string;
  cwd: string;
  sending: boolean;
  disabled?: boolean;
  /** Disallow changing the working directory once a conversation has turns. */
  cwdLocked?: boolean;
  placeholder?: string;
  /** Optional pre-selected model value before a conversation starts. */
  selectedModelValue?: string;
  /** Lock provider switching inside an active conversation. */
  lockProvider?: boolean;
  /** Recent directories shown as quiet quick-switch chips under the composer. */
  recentDirs?: string[];
  /** Pending permission requests for the active conversation. */
  pendingPerms?: PendingPermission[];
  /** Queued follow-up messages waiting to be sent. */
  queuedMessages?: QueuedMessage[];
}>();

const emit = defineEmits<{
  "update:value": [value: string];
  "update:agentId": [id: string];
  "update:cwd": [path: string];
  send: [blocks: Block[]];
  enqueue: [blocks: Block[]];
  stop: [];
  "pick-model": [configId: string, value: string];
  "pick-mode": [modeId: string];
  "respond-permission": [requestId: string, optionId: string];
  "steer-queued": [queueId: string];
  "edit-queued": [queueId: string];
  "remove-queued": [queueId: string];
  "jump-turn": [turnId: string];
  cwd: [];
  manage: [];
}>();

const localAttached = ref<Block[]>([]);
const attached = computed<Block[]>({
  get: () => (props.conversationId ? (store.draftAttachments[props.conversationId] ?? []) : localAttached.value),
  set: (next: Block[]) => {
    if (props.conversationId) {
      store.draftAttachments[props.conversationId] = next;
    } else {
      localAttached.value = next;
    }
  },
});
const inputFiles = ref<HTMLInputElement | null>(null);
const dragging = ref(false);
const gitInfo = ref<GitInfo | null>(null);
const gitFallbackRepo = ref(false);
const switchingBranch = ref(false);
const composing = ref(false);
let lastCompositionEndAt = 0;
let dragDepth = 0;

function onCompositionStart() {
  composing.value = true;
}

function onCompositionEnd() {
  composing.value = false;
  lastCompositionEndAt = performance.now();
}

function isImeComposing(e: KeyboardEvent) {
  return (
    composing.value ||
    e.isComposing ||
    e.keyCode === 229 ||
    performance.now() - lastCompositionEndAt < 100
  );
}

const draft = computed({
  get: () => props.value,
  set: (v: string) => emit("update:value", v),
});

const running = computed(() => props.live.status === "running");
const sendKey = computed(() => (store.settings?.sendKey === "enter" ? "enter" : "shiftEnter"));

// Pi / Oh My Pi only supports full access mode.
const isPi = computed(() => {
  const id = (props.agentId ?? "").toLowerCase();
  const name = (props.agentName ?? "").toLowerCase();
  return id === "pi" || id === "omp" || id.includes("oh-my-pi") || name === "pi" || name.includes("oh my pi");
});

const storedPerm = ref<PermissionMode>(
  (localStorage.getItem("oc.permMode") as PermissionMode | null) ??
    (store.settings?.autoAllow ? "auto" : "supervised"),
);

watch(
  () => store.settings?.autoAllow,
  (autoAllow) => {
    if (autoAllow === undefined) return;
    if (!autoAllow) {
      storedPerm.value = "supervised";
    } else if (storedPerm.value === "supervised") {
      storedPerm.value = "auto";
    }
  },
);

const effectivePerm = computed<PermissionMode>(() => (isPi.value ? "full" : storedPerm.value));

const PERM_OPTIONS: { key: PermissionMode; label: string; desc: string }[] = [
  { key: "supervised", label: "每次确认", desc: "改文件或执行命令前先询问" },
  { key: "auto", label: "自动批准", desc: "常规工具调用自动放行" },
  { key: "full", label: "完全访问", desc: "无需确认，直接读写与执行" },
];

const availablePermOptions = computed(() =>
  isPi.value ? PERM_OPTIONS.filter((o) => o.key === "full") : PERM_OPTIONS,
);

const currentPermLabel = computed(
  () => PERM_OPTIONS.find((o) => o.key === effectivePerm.value)?.label ?? "每次确认",
);

function selectPermissionMode(mode: PermissionMode) {
  if (isPi.value && mode !== "full") return;
  storedPerm.value = mode;
  localStorage.setItem("oc.permMode", mode);
  void saveSettings({ autoAllow: mode !== "supervised" });
  syncPermissionModeToAgent(mode);
}

function syncPermissionModeToAgent(mode: PermissionMode) {
  if (isPi.value || !props.conversationId) return;
  if (props.live.status !== "ready" && props.live.status !== "running") return;
  const target = resolvePermissionTarget(mode, props.live);
  if (!target) return;
  if (target.kind === "mode") {
    emit("pick-mode", target.modeId);
  } else {
    emit("pick-model", target.configId, target.value);
  }
}

watch(
  () => [
    props.conversationId,
    props.live.status,
    props.live.modes?.availableModes?.length ?? 0,
    props.live.configOptions?.length ?? 0,
  ],
  ([convId, status]) => {
    if (convId && status === "ready") {
      syncPermissionModeToAgent(effectivePerm.value);
    }
  },
  { immediate: true },
);

const checkSvg = () =>
  h(
    "svg",
    {
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      "stroke-width": "2",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      class: "perm-opt-check",
    },
    [h("polyline", { points: "20 6 9 17 4 12" })],
  );

const permissionMenu = computed(() => ({
  items: availablePermOptions.value.map((opt) => ({
    key: opt.key,
    label: h("div", { class: "perm-opt" }, [
      h("div", { class: "perm-opt-main" }, [
        h("span", { class: "perm-opt-label" }, opt.label),
        h("span", { class: "perm-opt-desc" }, opt.desc),
      ]),
      opt.key === effectivePerm.value ? checkSvg() : null,
    ]),
  })),
  onClick: ({ key }: { key: string }) => {
    selectPermissionMode(key as PermissionMode);
  },
}));

// Standalone Reasoning / Thinking Effort selector (Codex-style Brain icon outside picker)
const DEFAULT_EFFORTS: { value: EffortKey; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "Extra High" },
  { value: "max", label: "Max" },
];

const localEffort = ref<string>(localStorage.getItem("oc.effort") || "medium");

const effortOption = computed<ConfigOption | null>(() => {
  const opts = props.live.configOptions ?? [];
  return opts.find((o) => o.category === "thought_level") ?? null;
});

const effortChoices = computed<{ value: string; label: string }[]>(() => {
  if (effortOption.value) {
    return selectOptions(effortOption.value);
  }
  return DEFAULT_EFFORTS;
});

const currentEffortValue = computed(() =>
  effortOption.value ? String(effortOption.value.currentValue ?? "") : localEffort.value,
);

const currentEffortLabel = computed(
  () => effortChoices.value.find((e) => e.value === currentEffortValue.value)?.label ?? currentEffortValue.value,
);

function effortTierOf(val: string): EffortKey {
  const s = val.toLowerCase();
  if (s.includes("max")) return "max";
  if (s.includes("xhigh") || s.includes("extra")) return "xhigh";
  if (s.includes("high")) return "high";
  if (s.includes("med")) return "medium";
  return "low";
}

const currentEffortTier = computed<EffortKey>(() => effortTierOf(currentEffortValue.value));

const THINK_TIER_CLASSES: Record<EffortKey, string> = {
  low: "text-[#38bdf8] bg-[rgba(56,189,248,0.14)] border-[rgba(56,189,248,0.26)]",
  medium: "text-[#10b981] bg-[rgba(16,185,129,0.14)] border-[rgba(16,185,129,0.26)]",
  high: "text-[#a78bfa] bg-[rgba(167,139,250,0.16)] border-[rgba(167,139,250,0.28)]",
  xhigh: "text-[#f59e0b] bg-[rgba(245,158,11,0.16)] border-[rgba(245,158,11,0.28)]",
  max: "text-[#f43f5e] bg-[rgba(244,63,94,0.17)] border-[rgba(244,63,94,0.3)]",
};

function pickEffort(val: string) {
  localEffort.value = val;
  localStorage.setItem("oc.effort", val);
  if (effortOption.value) {
    emit("pick-model", effortOption.value.id, val);
  }
}

const effortMenu = computed(() => ({
  items: effortChoices.value.map((opt) => ({
    key: opt.value,
    label: h("div", { class: "effort-opt" }, [
      h("span", { class: ["effort-dot", `tier-${effortTierOf(opt.value)}`] }),
      h("span", { class: "effort-opt-label" }, opt.label),
      opt.value === currentEffortValue.value ? checkSvg() : null,
    ]),
  })),
  onClick: ({ key }: { key: string }) => {
    pickEffort(key);
  },
}));

const isGitRepo = computed(() => Boolean(gitInfo.value?.isRepo || gitFallbackRepo.value));
const currentBranch = computed(() => gitInfo.value?.branch || "git");
const branches = computed(() => gitInfo.value?.branches ?? []);

async function refreshGit(dir: string) {
  if (!dir) {
    gitInfo.value = null;
    gitFallbackRepo.value = false;
    return;
  }
  const cached = gitCache.get(dir);
  if (cached) {
    gitInfo.value = cached.info;
    gitFallbackRepo.value = cached.fallback;
  }
  try {
    const info = await api.gitInfo(dir);
    gitInfo.value = info;
    gitFallbackRepo.value = false;
    gitCache.set(dir, { info, fallback: false });
  } catch {
    gitInfo.value = null;
    try {
      const listing = await api.listDir(dir);
      const fallback = Boolean(listing?.isRepo);
      gitFallbackRepo.value = fallback;
      gitCache.set(dir, { info: null, fallback });
    } catch {
      gitFallbackRepo.value = false;
    }
  }
}

async function switchBranch(branch: string) {
  if (!props.cwd || !branch || branch === currentBranch.value || switchingBranch.value) return;
  switchingBranch.value = true;
  try {
    const res = await api.gitCheckout(props.cwd, branch);
    gitInfo.value = res;
    message.success(`已切换到分支 ${res.branch || branch}`);
  } catch (e) {
    message.error(e instanceof Error ? e.message : "切换分支失败");
  } finally {
    switchingBranch.value = false;
  }
}

const branchMenu = computed(() => {
  const list = branches.value;
  if (!list.length) {
    return {
      items: [
        {
          key: "__empty__",
          disabled: true,
          label: h("span", { class: "branch-empty" }, gitFallbackRepo.value ? "重启服务后可切换分支" : "暂无本地分支"),
        },
      ],
    };
  }
  return {
    items: list.map((b) => ({
      key: b,
      label: h("div", { class: ["branch-opt", { active: b === currentBranch.value }] }, [
        h("span", { class: "branch-opt-name mono" }, b),
        b === currentBranch.value ? checkSvg() : null,
      ]),
    })),
    onClick: ({ key }: { key: string }) => {
      if (key && key !== "__empty__") void switchBranch(key);
    },
  };
});

const senderRef = ref<SenderRef | null>(null);
const localSkills = ref<SkillInfo[]>([]);
const selectedSkill = ref<SkillEntry | null>(null);
const skillFilter = ref<"all" | "project" | "user" | "command">("all");

async function refreshSkills(dir: string) {
  const key = dir || "__global__";
  const cached = skillsCache.get(key);
  if (cached) localSkills.value = cached;
  try {
    const list = (await api.listSkills(dir)) ?? [];
    localSkills.value = list;
    skillsCache.set(key, list);
  } catch {
    if (!cached) localSkills.value = [];
  }
}

watch(
  () => props.conversationId,
  () => {
    slashDismissed.value = false;
    selectedSkill.value = null;
    skillFilter.value = "all";
    dragging.value = false;
    dragDepth = 0;
  },
);

watch(
  () => props.cwd,
  (dir) => {
    void refreshGit(dir);
    void refreshSkills(dir);
  },
  { immediate: true },
);

const allSkills = computed<SkillEntry[]>(() => {
  const out: SkillEntry[] = [];
  const byName = new Map<string, SkillEntry>();
  for (const s of localSkills.value) {
    const entry: SkillEntry = {
      name: s.name,
      description: s.description,
      kind: "skill",
      source: s.source,
    };
    byName.set(s.name.toLowerCase(), entry);
    out.push(entry);
  }
  for (const c of props.live.commands ?? []) {
    const k = c.name.toLowerCase();
    const existing = byName.get(k);
    if (existing) {
      if (!existing.description && c.description) existing.description = c.description;
      continue;
    }
    const entry: SkillEntry = {
      name: c.name,
      description: c.description,
      kind: "command",
    };
    byName.set(k, entry);
    out.push(entry);
  }
  return out;
});

const skillFilterTabs = computed(() => {
  const projectCount = allSkills.value.filter((s) => s.kind === "skill" && s.source === "project").length;
  const userCount = allSkills.value.filter((s) => s.kind === "skill" && s.source === "user").length;
  const cmdCount = allSkills.value.filter((s) => s.kind === "command").length;
  const tabs: { key: "all" | "project" | "user" | "command"; label: string; count: number }[] = [
    { key: "all", label: "全部", count: allSkills.value.length },
  ];
  if (projectCount) tabs.push({ key: "project", label: "项目", count: projectCount });
  if (userCount) tabs.push({ key: "user", label: "全局", count: userCount });
  if (cmdCount) tabs.push({ key: "command", label: "命令", count: cmdCount });
  return tabs;
});

const slashQuery = computed(() => {
  if (selectedSkill.value) return null;
  const m = /^\/([^\s]*)$/.exec(props.value);
  return m ? m[1] : null;
});
const slashDismissed = ref(false);
watch(
  () => props.value,
  () => (slashDismissed.value = false),
);
const slashOpen = computed(() => slashQuery.value != null && !slashDismissed.value);

const slashItems = computed<SkillEntry[]>(() => {
  if (slashQuery.value == null) return [];
  const q = slashQuery.value.trim().toLowerCase();
  return allSkills.value.filter((s) => {
    if (skillFilter.value === "project" && (s.kind !== "skill" || s.source !== "project")) return false;
    if (skillFilter.value === "user" && (s.kind !== "skill" || s.source !== "user")) return false;
    if (skillFilter.value === "command" && s.kind !== "command") return false;
    if (!q) return true;
    return s.name.toLowerCase().includes(q) || (s.description?.toLowerCase().includes(q) ?? false);
  });
});
const slashIndex = ref(0);
watch(slashItems, () => (slashIndex.value = 0));
watch(slashOpen, (open) => {
  if (open) {
    skillFilter.value = "all";
    activeDeck.value = "skills";
    void refreshSkills(props.cwd);
  }
});

function clearSkill(refocus = false) {
  if (!selectedSkill.value) return;
  const currentText = senderRef.value?.getValue?.().value ?? props.value;
  selectedSkill.value = null;
  emit("update:value", currentText);
  if (refocus) {
    void nextTick(() => senderRef.value?.focus({ cursor: "end" }));
  }
}

const senderSkill = computed<SkillType | undefined>(() => {
  const s = selectedSkill.value;
  if (!s) return undefined;
  return {
    value: s.name,
    title: h("span", { class: "oc-skill-label mono" }, [
      h("span", { class: "oc-skill-slash" }, "/"),
      h("span", { class: "oc-skill-name" }, s.name),
    ]),
    toolTip: s.description ? { title: s.description } : undefined,
    closable: {
      onClose: () => {
        clearSkill(true);
      },
    },
  };
});

function pickSkill(entry: SkillEntry) {
  slashDismissed.value = true;
  selectedSkill.value = entry;
  emit("update:value", "");
  void nextTick(() => {
    senderRef.value?.focus({ cursor: "end" });
  });
}

const senderAutoSize = computed(() => ({ minRows: props.lockProvider ? 1 : 2, maxRows: 10 }));

function onSenderCancel() {
  emit("stop");
}

function onSenderChange(val: string, _event?: Event, _slotConfig?: SlotConfigType[], skill?: SkillType) {
  emit("update:value", val);
  if (selectedSkill.value && !skill) {
    selectedSkill.value = null;
    void nextTick(() => senderRef.value?.focus({ cursor: "end" }));
  }
}

function skillBadgeText(item: SkillEntry): string {
  if (item.kind === "command") return "命令";
  return item.source === "project" ? "项目" : "全局";
}

const modelOption = computed<ConfigOption | null>(() => {
  const opts = props.live.configOptions ?? [];
  return opts.find((o) => o.category === "model") ?? opts.find((o) => o.type === "select" && o.id.includes("model")) ?? null;
});
const modeConfig = computed<ConfigOption | null>(() => {
  if (props.live.modes) return null;
  return (props.live.configOptions ?? []).find((o) => o.category === "mode") ?? null;
});

function selectOptions(o: ConfigOption) {
  const list = o.options ?? [];
  return Array.isArray(list) && list.length && "group" in (list[0] as object)
    ? (list as { group: string; name: string; options: { value: string; name: string }[] }[]).flatMap((g) =>
        g.options.map((x) => ({ label: `${g.name} · ${x.name}`, value: x.value })),
      )
    : (list as { value: string; name: string }[]).map((x) => ({ label: x.name, value: x.value }));
}

const modes = computed(() => props.live.modes?.availableModes ?? []);
const canSend = computed(
  () => !props.disabled && (Boolean(selectedSkill.value) || props.value.trim().length > 0 || attached.value.length > 0),
);

function nicePath(p: string) {
  const home = store.boot?.home;
  if (home && p === home) return "~";
  if (home && p.startsWith(home + "/")) return "~" + p.slice(home.length);
  return p;
}

const cwdLabel = computed(() => (props.cwd ? nicePath(props.cwd) : "选择工作目录"));

function submit(msgFromSender?: string, _slotConfig?: SlotConfigType[], skillFromSender?: SkillType) {
  if (!canSend.value) return;
  const blocks: Block[] = [];
  const rawText =
    typeof msgFromSender === "string"
      ? msgFromSender
      : (senderRef.value?.getValue?.().value ?? props.value);
  const body = rawText.trim();
  const skillVal = skillFromSender?.value ?? selectedSkill.value?.name;
  const text = skillVal ? (body ? `/${skillVal} ${body}` : `/${skillVal}`) : body;
  if (text) blocks.push({ type: "text", text });
  for (const a of attached.value) blocks.push(a);
  if (running.value) {
    emit("enqueue", blocks);
  } else {
    emit("send", blocks);
  }
  attached.value = [];
  selectedSkill.value = null;
  emit("update:value", "");
  senderRef.value?.clear?.();
}

function onKeydown(e: KeyboardEvent): void | false {
  if (isImeComposing(e)) {
    if (e.key === "Enter") return false;
    return;
  }
  if (slashOpen.value) {
    const count = slashItems.value.length;
    if (e.key === "Escape") {
      e.preventDefault();
      slashDismissed.value = true;
      return false;
    }
    if (count > 0) {
      if (e.key === "ArrowDown" || e.key === "ArrowRight") {
        e.preventDefault();
        slashIndex.value = (slashIndex.value + 1) % count;
        return false;
      }
      if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
        e.preventDefault();
        slashIndex.value = (slashIndex.value - 1 + count) % count;
        return false;
      }
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey)) {
        e.preventDefault();
        const item = slashItems.value[slashIndex.value];
        if (item) pickSkill(item);
        return false;
      }
    }
  }
  return;
}

// Unified interactive deck above Composer: permission / skills / queue / files
const permList = computed(() => props.pendingPerms ?? []);
const queueList = computed(() => props.queuedMessages ?? []);
const submittingPermId = ref<string | null>(null);

const availableDeckCards = computed<DeckKind[]>(() => {
  const list: DeckKind[] = [];
  if (permList.value.length > 0) list.push("permission");
  if (slashOpen.value) list.push("skills");
  if (queueList.value.length > 0) list.push("queue");
  if (attached.value.length > 0) list.push("files");
  return list;
});

const activeDeck = ref<DeckKind | null>(null);

const effectiveDeck = computed<DeckKind | null>(() => {
  const avail = availableDeckCards.value;
  if (!avail.length) return null;
  if (activeDeck.value && avail.includes(activeDeck.value)) return activeDeck.value;
  return avail[0];
});

const backDeckCards = computed<DeckKind[]>(() =>
  availableDeckCards.value.filter((k) => k !== effectiveDeck.value),
);

watch(
  () => permList.value.length,
  (len, prev) => {
    if (len > (prev ?? 0)) activeDeck.value = "permission";
    if (len === 0) submittingPermId.value = null;
  },
);

watch(
  () => queueList.value.length,
  (len, prev) => {
    if (len > (prev ?? 0) && activeDeck.value !== "permission") activeDeck.value = "queue";
  },
);

watch(
  () => attached.value.length,
  (len, prev) => {
    if (len > (prev ?? 0)) activeDeck.value = "files";
  },
);

watch(
  () => props.conversationId,
  () => {
    activeDeck.value = null;
    submittingPermId.value = null;
  },
);

function selectDeck(kind: DeckKind) {
  activeDeck.value = kind;
}

const currentPerm = computed(() => permList.value[0] ?? null);
const isAllowOption = (o: PermissionOption) => o.kind.startsWith("allow");
const permRejects = computed(() => (currentPerm.value?.options ?? []).filter((o) => !isAllowOption(o)));
const permAllows = computed(() => (currentPerm.value?.options ?? []).filter(isAllowOption));

function permOptionLabel(o: PermissionOption): string {
  if (o.kind === "allow_once") return "允许一次";
  if (o.kind === "allow_always") return "本会话允许";
  if (o.kind === "reject_once") return "拒绝";
  if (o.kind === "reject_always") return "始终拒绝";
  return o.name;
}

function answerPerm(requestId: string, optionId: string) {
  if (submittingPermId.value === requestId) return;
  submittingPermId.value = requestId;
  emit("respond-permission", requestId, optionId);
  window.setTimeout(() => {
    if (submittingPermId.value === requestId) submittingPermId.value = null;
  }, 3000);
}

function queuePreview(blocks: Block[]): string {
  const text = userText(blocks).replace(/\s+/g, " ").trim();
  const imgs = blocks.filter((b) => b.type === "image").length;
  const files = blocks.filter((b) => b.type === "resource_link").length;
  const attach: string[] = [];
  if (imgs) attach.push(`${imgs} 张图片`);
  if (files) attach.push(`${files} 个文件`);
  if (text && attach.length) return `${text} · ${attach.join("、")}`;
  return text || attach.join("、") || "待发送消息";
}

const filesSummary = computed(() => {
  const first = attached.value[0];
  if (!first) return "";
  const firstName = first.type === "image" ? "图片" : (first as { name?: string }).name || "文件";
  return attached.value.length > 1 ? `${firstName} 等 ${attached.value.length} 项` : firstName;
});

async function addFiles(files: FileList | File[]) {
  const list = Array.from(files);
  const added: Block[] = [];
  for (const file of list) {
    if (file.type.startsWith("image/") && file.size < 8 * 1024 * 1024) {
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      added.push({ type: "image", data, mimeType: file.type, uri: `file://${file.name}` });
    } else {
      added.push({ type: "resource_link", uri: `file://${file.name}`, name: file.name, mimeType: file.type, size: file.size });
    }
  }
  if (added.length > 0) {
    attached.value = [...attached.value, ...added];
    activeDeck.value = "files";
  }
}

function onPasteFile(files: FileList) {
  void addFiles(files);
}

function onPaste(_e: ClipboardEvent, info: SenderPasteInfo) {
  void info;
}

function onDragEnter(e: DragEvent) {
  if (!e.dataTransfer?.types?.includes("Files")) return;
  dragDepth++;
  dragging.value = true;
}

function onDragLeave() {
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) dragging.value = false;
}

function onDrop(e: DragEvent) {
  dragDepth = 0;
  dragging.value = false;
  if (e.dataTransfer?.files?.length) {
    void addFiles(e.dataTransfer.files);
  }
}

function removeAt(i: number) {
  attached.value = attached.value.filter((_, idx) => idx !== i);
}

defineExpose({ addFiles });
</script>

<template>
  <div
    class="relative w-full"
    @dragenter.prevent="onDragEnter"
    @dragover.prevent
    @dragleave="onDragLeave"
    @drop.prevent="onDrop"
  >
    <!-- Peeking back cards (click any card to bring it to the front) -->
    <div v-if="backDeckCards.length" class="flex flex-col items-center relative z-1 -mb-[10px]">
      <button
        v-for="(kind, idx) in backDeckCards"
        :key="kind"
        type="button"
        class="group/peek flex items-center gap-2 h-[38px] px-[14px] pb-2 border border-solid border-b-0 rounded-t-[14px] glass text-ink-2 text-[12px] cursor-pointer transition-all duration-200 ease-oc hover:-translate-y-[2px] hover:text-ink"
        :class="[
          backDeckCards.length >= 2 && idx === 0 ? 'w-[90%] -mb-[10px] z-1 opacity-88' : 'w-[95%] z-2',
          kind === 'permission'
            ? 'border-[color-mix(in_srgb,var(--warn)_36%,var(--border-strong))] bg-[color-mix(in_srgb,var(--warn-soft)_45%,var(--surface-2))] hover:bg-[color-mix(in_srgb,var(--warn-soft)_65%,var(--surface))]'
            : 'border-line-strong bg-surface-2 hover:bg-surface',
        ]"
        @click="selectDeck(kind)"
      >
        <template v-if="kind === 'permission' && currentPerm">
          <span class="w-[6px] h-[6px] rounded-full flex-none bg-warn animate-oc-pulse-fast" />
          <span class="fw-560 text-ink flex-none">待确认{{ permList.length > 1 ? ` (${permList.length})` : '' }}</span>
          <span class="flex-1 min-w-0 text-left text-ink-2 truncate">{{ currentPerm.title }}</span>
          <span class="text-[11px] text-ink-3 flex-none px-[6px] py-[1px] rounded-[5px] bg-hover transition-colors duration-140 group-hover/peek:text-ink group-hover/peek:bg-active">切换</span>
        </template>
        <template v-else-if="kind === 'skills'">
          <span class="w-[6px] h-[6px] rounded-full flex-none bg-[#6366f1]" />
          <span class="fw-560 text-ink flex-none">Skills 与命令 ({{ allSkills.length }})</span>
          <span class="flex-1 min-w-0 text-left text-ink-2 truncate">{{ selectedSkill ? `当前：/${selectedSkill.name}` : '点击展开选择' }}</span>
          <span class="text-[11px] text-ink-3 flex-none px-[6px] py-[1px] rounded-[5px] bg-hover transition-colors duration-140 group-hover/peek:text-ink group-hover/peek:bg-active">切换</span>
        </template>
        <template v-else-if="kind === 'queue'">
          <span class="w-[6px] h-[6px] rounded-full flex-none bg-ink-solid opacity-70" />
          <span class="fw-560 text-ink flex-none">待发消息 ({{ queueList.length }})</span>
          <span class="flex-1 min-w-0 text-left text-ink-2 truncate">{{ queuePreview(queueList[0].blocks) }}</span>
          <span class="text-[11px] text-ink-3 flex-none px-[6px] py-[1px] rounded-[5px] bg-hover transition-colors duration-140 group-hover/peek:text-ink group-hover/peek:bg-active">切换</span>
        </template>
        <template v-else-if="kind === 'files'">
          <span class="w-[6px] h-[6px] rounded-full flex-none bg-ok" />
          <span class="fw-560 text-ink flex-none">已选附件 ({{ attached.length }})</span>
          <span class="flex-1 min-w-0 text-left text-ink-2 truncate">{{ filesSummary }}</span>
          <span class="text-[11px] text-ink-3 flex-none px-[6px] py-[1px] rounded-[5px] bg-hover transition-colors duration-140 group-hover/peek:text-ink group-hover/peek:bg-active">切换</span>
        </template>
      </button>
    </div>

    <div
      class="relative z-2 rounded-[20px]"
      :class="[
        effectiveDeck !== null ? 'border border-solid glass shadow-composer' : '',
        effectiveDeck === 'permission'
          ? 'border-[color-mix(in_srgb,var(--warn)_38%,var(--border-strong))] bg-[color-mix(in_srgb,var(--warn-soft)_32%,var(--surface-2))]'
          : effectiveDeck !== null
            ? 'border-line-strong bg-surface-2'
            : '',
      ]"
    >
      <!-- Active Front Card: Permission Confirmation -->
      <div v-if="effectiveDeck === 'permission' && currentPerm" class="px-[14px] py-[11px]">
        <div class="flex items-center gap-[10px] min-w-0">
          <span class="w-7 h-7 rounded-[8px] inline-grid place-items-center flex-none bg-[color-mix(in_srgb,var(--warn)_15%,transparent)] text-warn" aria-hidden="true">
            <svg viewBox="0 0 24 24" class="w-[15px] h-[15px]" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />
              <path d="M12 8v4" />
              <path d="M12 16h.01" />
            </svg>
          </span>
          <div class="flex-1 min-w-0 cursor-pointer" @click="emit('jump-turn', currentPerm.turnId)">
            <div class="flex items-center gap-[6px] min-w-0">
              <span class="text-[13px] fw-580 text-ink truncate">{{ currentPerm.title }}</span>
              <span v-if="permList.length > 1" class="text-[10.5px] leading-4 px-[5px] rounded-[5px] bg-[color-mix(in_srgb,var(--warn)_18%,transparent)] text-warn flex-none font-mono">1 / {{ permList.length }}</span>
            </div>
            <div v-if="currentPerm.detail" class="text-[11px] text-ink-3 mt-[1px] truncate font-mono" :title="currentPerm.detail">
              {{ nicePath(currentPerm.detail) }}
            </div>
          </div>
          <div class="inline-flex items-center gap-[6px] flex-none">
            <button
              v-for="o in permRejects"
              :key="o.optionId"
              type="button"
              class="h-[27px] px-[11px] rounded-[8px] text-[12px] fw-540 cursor-pointer border border-solid border-line-strong bg-surface-strong text-ink-2 whitespace-nowrap transition-all duration-140 hover:not-disabled:text-err hover:not-disabled:border-[color-mix(in_srgb,var(--err)_35%,var(--border-strong))] hover:not-disabled:bg-err-soft disabled:opacity-55 disabled:cursor-wait"
              :disabled="submittingPermId === currentPerm.requestId"
              @click="answerPerm(currentPerm.requestId, o.optionId)"
            >
              {{ permOptionLabel(o) }}
            </button>
            <button
              v-for="o in permAllows"
              :key="o.optionId"
              type="button"
              class="h-[27px] px-[11px] rounded-[8px] text-[12px] fw-540 cursor-pointer border border-solid whitespace-nowrap transition-all duration-140 disabled:opacity-55 disabled:cursor-wait"
              :class="
                o.kind === 'allow_always'
                  ? 'border-line-strong bg-surface-strong text-ink hover:not-disabled:bg-hover hover:not-disabled:border-[color-mix(in_srgb,var(--ink)_28%,var(--border-strong))]'
                  : 'bg-ink-solid border-ink-solid text-ink-inv hover:not-disabled:opacity-88'
              "
              :disabled="submittingPermId === currentPerm.requestId"
              @click="answerPerm(currentPerm.requestId, o.optionId)"
            >
              {{ permOptionLabel(o) }}
            </button>
          </div>
        </div>
      </div>

      <!-- Active Front Card: Queued Messages -->
      <div v-else-if="effectiveDeck === 'queue' && queueList.length" class="px-3 py-2">
        <div class="w-full flex flex-col gap-1 max-h-[116px] overflow-y-auto">
          <div v-for="(item, qi) in queueList" :key="item.id" class="flex items-center gap-2 min-h-[26px] py-[2px] pl-[6px] pr-1 rounded-[7px] transition-colors duration-140 ease-oc hover:bg-hover">
            <span class="w-[17px] h-[17px] rounded-[5px] bg-hover border border-solid border-line text-ink-3 text-[10.5px] inline-grid place-items-center flex-none font-mono">{{ qi + 1 }}</span>
            <span class="flex-1 min-w-0 text-[12px] text-ink truncate" :title="queuePreview(item.blocks)">{{ queuePreview(item.blocks) }}</span>
            <div class="inline-flex items-center gap-[2px] flex-none">
              <Tooltip title="立即打断当前输出并发送" :mouse-enter-delay="0.25">
                <button type="button" class="w-[22px] h-[22px] border-0 rounded-[6px] bg-transparent text-ink-2 inline-grid place-items-center cursor-pointer transition-colors duration-140 hover:bg-ink-solid hover:text-ink-inv [&>svg]:w-[12.5px] [&>svg]:h-[12.5px]" aria-label="立即发送" @click.stop="emit('steer-queued', item.id)">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="9 10 4 15 9 20" />
                    <path d="M20 4v7a4 4 0 0 1-4 4H4" />
                  </svg>
                </button>
              </Tooltip>
              <Tooltip title="放回输入框编辑" :mouse-enter-delay="0.25">
                <button type="button" class="w-[22px] h-[22px] border-0 rounded-[6px] bg-transparent text-ink-3 inline-grid place-items-center cursor-pointer transition-colors duration-140 hover:bg-active hover:text-ink [&>svg]:w-[12.5px] [&>svg]:h-[12.5px]" aria-label="编辑" @click.stop="emit('edit-queued', item.id)">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
                  </svg>
                </button>
              </Tooltip>
              <Tooltip title="移出队列" :mouse-enter-delay="0.25">
                <button type="button" class="w-[22px] h-[22px] border-0 rounded-[6px] bg-transparent text-ink-3 inline-grid place-items-center cursor-pointer transition-colors duration-140 hover:bg-err-soft hover:text-err [&>svg]:w-[12.5px] [&>svg]:h-[12.5px]" aria-label="删除" @click.stop="emit('remove-queued', item.id)">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M18 6 6 18" />
                    <path d="m6 6 12 12" />
                  </svg>
                </button>
              </Tooltip>
            </div>
          </div>
        </div>
      </div>

      <!-- Active Front Card: Skills & Commands Tray triggered by typing / -->
      <div v-else-if="effectiveDeck === 'skills' && slashOpen" class="px-3 pt-[10px] pb-3 flex flex-col gap-[9px]">
        <div class="flex items-center gap-2 px-[2px]">
          <span class="inline-flex items-center gap-[3px] text-[12px] fw-560 text-ink flex-none">
            <span class="oc-skill-slash font-bold font-mono">/</span>
            <span>{{ slashQuery ? slashQuery : 'Skills 与命令' }}</span>
          </span>
          <span class="text-[10.5px] text-ink-3 truncate">↑↓ 选择 · Enter 唤起 · Esc 收起</span>
          <span class="flex-1" />
          <div v-if="skillFilterTabs.length > 2" class="inline-flex items-center gap-[2px] p-[2px] rounded-[7px] bg-hover flex-none">
            <button
              v-for="tab in skillFilterTabs"
              :key="tab.key"
              type="button"
              class="border-0 text-[11px] leading-[18px] px-[7px] rounded-[5px] cursor-pointer transition-colors duration-120"
              :class="skillFilter === tab.key ? 'bg-surface-strong text-ink fw-540 shadow-[0_1px_2px_rgba(0,0,0,0.06)]' : 'bg-transparent text-ink-3 hover:text-ink-2'"
              @mousedown.prevent="skillFilter = tab.key"
            >
              {{ tab.label }}
            </button>
          </div>
          <button type="button" class="w-[22px] h-[22px] border-0 rounded-[6px] bg-transparent text-ink-3 inline-grid place-items-center cursor-pointer flex-none transition-colors duration-120 hover:bg-hover hover:text-ink" aria-label="收起" @mousedown.prevent="slashDismissed = true">
            <svg viewBox="0 0 24 24" class="w-[13px] h-[13px]" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>

        <div v-if="slashItems.length" class="grid [grid-template-columns:repeat(auto-fill,minmax(168px,1fr))] gap-2 max-h-[168px] overflow-y-auto p-[1px]">
          <button
            v-for="(c, i) in slashItems"
            :key="c.name"
            type="button"
            class="flex flex-col gap-1 px-[10px] py-2 rounded-[11px] border border-solid shadow-card text-left cursor-pointer min-w-0 transition-all duration-150 ease-oc hover:-translate-y-[1px] hover:border-[color-mix(in_srgb,#6366f1_34%,var(--border-strong))] hover:shadow-pop"
            :class="
              i === slashIndex
                ? 'border-[color-mix(in_srgb,#6366f1_52%,var(--border-strong))] bg-[color-mix(in_srgb,#6366f1_7%,var(--surface-strong))]'
                : 'border-line bg-surface-strong'
            "
            :title="c.description || c.name"
            @mouseenter="slashIndex = i"
            @mousedown.prevent="pickSkill(c)"
          >
            <div class="flex items-center gap-[6px] min-w-0">
              <span
                class="w-[5px] h-[5px] rounded-full flex-none"
                :class="c.kind === 'command' ? 'bg-ink-3' : c.source === 'project' ? 'bg-[#6366f1]' : 'bg-[#10b981]'"
              />
              <span class="flex-1 min-w-0 text-[12px] fw-580 text-ink truncate font-mono">/{{ c.name }}</span>
              <span
                class="flex-none text-[10px] leading-[15px] px-[5px] rounded-[4px]"
                :class="
                  c.kind === 'skill' && c.source === 'project'
                    ? 'oc-skill-tag-project bg-[color-mix(in_srgb,#6366f1_11%,transparent)]'
                    : 'bg-hover text-ink-3'
                "
              >
                {{ skillBadgeText(c) }}
              </span>
            </div>
            <div class="text-[11px] leading-[1.4] text-ink-3 truncate">{{ c.description || '点击或按 Enter 唤起' }}</div>
          </button>
        </div>
        <div v-else class="py-3 px-2 text-center text-[12px] text-ink-3">
          {{ allSkills.length ? '未找到匹配的 Skill 或命令' : '暂无可用 Skills（可在项目 .claude/skills 或 ~/.claude/skills 添加）' }}
        </div>
      </div>

      <!-- Active Front Card: Uploaded Files / Images -->
      <div v-else-if="effectiveDeck === 'files' && attached.length" class="flex items-center gap-[14px] px-4 py-3 bg-transparent">
        <div
          class="oc-mini-cards-group flex items-center gap-[10px]"
          :class="{ 'is-stacked': attached.length > 1 }"
          :style="attached.length > 1 ? { '--fan-count': Math.min(attached.length, 4) } : undefined"
        >
          <div
            v-for="(a, i) in attached.slice(0, 4)"
            :key="i"
            class="oc-mini-card group/card w-[68px] h-[68px] rounded-[12px] border border-solid border-line-strong bg-surface-strong shadow-card flex flex-col items-center justify-center gap-1 relative cursor-pointer select-none flex-none"
            :class="{ 'p-0': a.type === 'image' }"
          >
            <button
              class="absolute -top-[6px] -right-[6px] z-6 w-[18px] h-[18px] rounded-full bg-ink-solid text-ink-inv text-[12px] leading-none flex items-center justify-center border-0 cursor-pointer opacity-0 scale-85 transition-all duration-140 group-hover/card:opacity-100 group-hover/card:scale-100"
              @click.stop="removeAt(i)"
              aria-label="移除"
            >
              ×
            </button>
            <img
              v-if="a.type === 'image'"
              :src="`data:${a.mimeType};base64,${a.data}`"
              alt="附件图片"
              class="w-full h-full object-cover rounded-[11px] block"
            />
            <template v-else>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" class="w-[18px] h-[18px] text-ink-2 flex-none">
                <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
              <span class="text-[10px] text-ink-2 max-w-[56px] truncate">{{ (a as { name: string }).name }}</span>
            </template>
            <span v-if="i === 0 && attached.length > 4" class="absolute bottom-1 right-1 text-[10px] leading-[15px] px-[5px] rounded-full bg-ink-solid text-ink-inv font-semibold font-mono">+{{ attached.length - 4 }}</span>
          </div>
        </div>

        <Tooltip title="继续添加图片或文件" :mouse-enter-delay="0.3">
          <button
            type="button"
            class="w-[68px] h-[68px] rounded-[12px] border-[1.5px] border-dashed border-line-strong bg-transparent flex items-center justify-center text-ink-3 cursor-pointer flex-none transition-all duration-160 ease-oc hover:border-ink-solid hover:bg-surface hover:text-ink active:scale-[0.96]"
            aria-label="添加图片或文件"
            @click="inputFiles?.click()"
          >
            <!-- Lucide image-plus -->
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
              <path d="M16 5h6" />
              <path d="M19 2v6" />
              <path d="M21 11.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7.5" />
              <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
              <circle cx="9" cy="9" r="2" />
            </svg>
          </button>
        </Tooltip>
      </div>

      <!-- Layer 2: Main Sender card keeps its full 4-corner 18px rounded border intact -->
      <div
        class="relative z-2 border border-solid glass rounded-[18px] transition-all duration-180 ease-oc overflow-hidden focus-within:bg-surface-strong focus-within:border-[color-mix(in_srgb,var(--ink)_28%,var(--border-strong))] focus-within:shadow-[var(--shadow-composer),0_0_0_3px_var(--accent-soft)]"
        :class="[
          effectiveDeck !== null ? 'mx-[-1px] mb-[-1px] bg-surface-strong shadow-[0_-2px_12px_rgba(0,0,0,0.1),var(--glass-rim)]' : 'bg-surface shadow-composer',
          dragging ? 'border-ink-solid shadow-[0_0_0_3px_var(--accent-soft)]' : 'border-line-strong',
        ]"
        @compositionstart.capture="onCompositionStart"
        @compositionend.capture="onCompositionEnd"
      >
        <div v-if="dragging" class="absolute inset-0 z-20 flex items-center justify-center gap-2 bg-surface-strong glass text-ink text-[13px] fw-550 pointer-events-none">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="w-[15px] h-[15px] flex-none">
            <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
          </svg>
          <span>松手即可附加图片或文件</span>
        </div>

        <Sender
          ref="senderRef"
          :value="draft"
          :skill="senderSkill"
          :loading="false"
          :disabled="disabled"
          :submit-type="sendKey"
          :auto-size="senderAutoSize"
          :placeholder="selectedSkill ? `使用 /${selectedSkill.name}，输入补充说明或直接发送…` : (placeholder ?? '描述你想完成的任务…')"
          :on-change="onSenderChange"
          :on-key-down="onKeydown"
          :on-paste-file="onPasteFile"
          :on-paste="onPaste"
          :on-submit="submit"
          :on-cancel="onSenderCancel"
          class="oc-sender"
        >
          <template #suffix><span class="hidden" /></template>
          <template #footer>
            <div class="flex items-center gap-[6px] min-h-8 min-w-0">
              <!-- Leftmost: File / Image attachment -->
              <Tooltip title="添加图片或文件（支持拖拽 / 粘贴）" :mouse-enter-delay="0.3">
                <button
                  type="button"
                  class="inline-grid place-items-center w-7 h-7 border border-solid border-transparent rounded-[8px] bg-transparent text-ink-2 cursor-pointer transition-colors duration-140 hover:bg-hover hover:border-line hover:text-ink"
                  @click="inputFiles?.click()"
                  aria-label="添加附件"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="w-[15px] h-[15px] flex-none">
                    <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                  </svg>
                </button>
              </Tooltip>

              <span class="flex-1" />

              <!-- Rightmost: Standalone Thinking/Reasoning icon (Codex-style) + Agent/Model Picker + Send -->
              <div class="inline-flex items-center gap-[5px] min-w-0 flex-[0_1_auto]">
                <Dropdown :menu="effortMenu" :trigger="['click']" placement="topRight">
                  <Tooltip :title="`思考强度：${currentEffortLabel}`" :mouse-enter-delay="0.3">
                    <button
                      class="inline-grid place-items-center w-7 h-7 border border-solid rounded-[8px] cursor-pointer transition-colors duration-140"
                      :class="THINK_TIER_CLASSES[currentEffortTier]"
                      aria-label="思考强度"
                    >
                      <!-- Lucide Brain -->
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" class="w-[15px] h-[15px] flex-none">
                        <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" />
                        <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" />
                        <path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4" />
                        <path d="M17.599 6.5a3 3 0 0 0 .399-1.375" />
                        <path d="M6.003 5.125A3 3 0 0 0 6.401 6.5" />
                        <path d="M3.477 10.896a4 4 0 0 1 .585-.396" />
                        <path d="M19.938 10.5a4 4 0 0 1 .585.396" />
                        <path d="M6 18a4 4 0 0 1-1.967-.516" />
                        <path d="M19.967 17.484A4 4 0 0 1 18 18" />
                      </svg>
                    </button>
                  </Tooltip>
                </Dropdown>

                <ProviderPicker
                  class="min-w-0"
                  :model-value="agentId"
                  :model-option="modelOption"
                  :selected-model-value="selectedModelValue"
                  :live-status="live.status"
                  :locked="lockProvider"
                  :cwd="cwd"
                  @update:model-value="(id) => emit('update:agentId', id)"
                  @pick-model="(cid, val) => emit('pick-model', cid, val)"
                  @manage="emit('manage')"
                />

                <template v-if="running">
                  <Tooltip
                    v-if="canSend"
                    :title="`加入待发队列 (${sendKey === 'enter' ? 'Enter' : 'Shift+Enter'})`"
                    :mouse-enter-delay="0.3"
                  >
                    <button
                      class="w-[30px] h-[30px] rounded-full border border-solid border-line-strong bg-surface-2 text-ink inline-grid place-items-center cursor-pointer flex-none transition-all duration-140 ease-oc hover:bg-ink-solid hover:border-ink-solid hover:text-ink-inv hover:scale-[1.04] active:scale-[0.96]"
                      @click="() => submit()"
                      aria-label="加入队列"
                    >
                      <!-- Lucide ArrowUp -->
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" class="w-[14px] h-[14px]">
                        <line x1="12" y1="19" x2="12" y2="5" />
                        <polyline points="5 12 12 5 19 12" />
                      </svg>
                    </button>
                  </Tooltip>
                  <Tooltip title="停止生成" :mouse-enter-delay="0.3">
                    <button
                      class="w-[30px] h-[30px] rounded-full border-0 bg-ink-solid text-ink-inv inline-grid place-items-center cursor-pointer flex-none transition-all duration-140 ease-oc hover:scale-[1.04] active:scale-[0.96]"
                      @click="emit('stop')"
                      aria-label="停止"
                    >
                      <span class="w-[9px] h-[9px] rounded-[2px] bg-ink-inv" />
                    </button>
                  </Tooltip>
                </template>
                <Tooltip v-else :title="`发送 (${sendKey === 'enter' ? 'Enter' : 'Shift+Enter'})`" :mouse-enter-delay="0.3">
                  <button
                    class="w-[30px] h-[30px] rounded-full border-0 bg-ink-solid text-ink-inv inline-grid place-items-center cursor-pointer flex-none transition-all duration-140 ease-oc hover:not-disabled:scale-[1.04] active:not-disabled:scale-[0.96] disabled:bg-hover disabled:text-ink-3 disabled:cursor-not-allowed disabled:opacity-65"
                    :disabled="!canSend"
                    @click="() => submit()"
                    aria-label="发送"
                  >
                    <!-- Lucide ArrowUp -->
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" class="w-[14px] h-[14px]">
                      <line x1="12" y1="19" x2="12" y2="5" />
                      <polyline points="5 12 12 5 19 12" />
                    </svg>
                  </button>
                </Tooltip>
              </div>
            </div>
          </template>
        </Sender>
      </div>
    </div>

    <!-- Below Sender: Permission Select (downward), Directory, and Git Branch -->
    <div class="flex items-center gap-1 px-[6px] pt-2 h-8 flex-nowrap overflow-hidden">
      <Dropdown :menu="permissionMenu" :trigger="['click']" placement="bottomLeft" :disabled="isPi">
        <Tooltip :title="isPi ? 'Pi 仅支持完全访问模式' : '选择权限模式'" :mouse-enter-delay="0.35">
          <button
            class="inline-flex items-center gap-[5px] h-6 px-2 border border-solid border-transparent rounded-[7px] bg-transparent text-[11.5px] flex-none transition-colors duration-140"
            :class="[
              isPi ? 'cursor-default' : 'cursor-pointer hover:bg-surface-2 hover:border-line hover:text-ink',
              effectivePerm === 'full' ? 'text-warn' : effectivePerm === 'auto' ? 'text-ink' : 'text-ink-2',
            ]"
          >
            <!-- Lucide LockOpen / Zap / Shield -->
            <svg v-if="effectivePerm === 'full'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round" class="w-[12.5px] h-[12.5px] flex-none">
              <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 9.9-1" />
            </svg>
            <svg v-else-if="effectivePerm === 'auto'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round" class="w-[12.5px] h-[12.5px] flex-none">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
            <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round" class="w-[12.5px] h-[12.5px] flex-none">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />
            </svg>
            <span>{{ currentPermLabel }}</span>
            <svg v-if="!isPi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-[11px] h-[11px] opacity-65 flex-none">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        </Tooltip>
      </Dropdown>

      <span class="w-[1px] h-3 bg-line-strong mx-[2px]" />

      <button
        class="inline-flex items-center gap-[5px] h-6 px-2 border border-solid border-transparent rounded-[7px] bg-transparent text-ink-2 text-[11.5px] flex-[0_1_auto] min-w-0 max-w-[260px] transition-colors duration-140"
        :class="cwdLocked ? 'cursor-default opacity-65' : 'cursor-pointer hover:bg-surface-2 hover:border-line hover:text-ink'"
        :title="cwdLocked ? '对话开始后不能改工作目录' : cwd"
        :disabled="cwdLocked"
        @click="emit('cwd')"
      >
        <!-- Lucide Folder -->
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round" class="w-[12.5px] h-[12.5px] flex-none">
          <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
        </svg>
        <span class="truncate font-mono">{{ cwdLabel }}</span>
        <svg v-if="!cwdLocked" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-[11px] h-[11px] opacity-65 flex-none">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      <template v-if="isGitRepo">
        <span class="w-[1px] h-3 bg-line-strong mx-[2px]" />
        <Dropdown
          :menu="branchMenu"
          :trigger="['click']"
          placement="bottomLeft"
          root-class="branch-dropdown"
          @open-change="(open: boolean) => { if (open && cwd) void refreshGit(cwd); }"
        >
          <Tooltip :title="`切换 Git 分支（当前：${currentBranch}）`" :mouse-enter-delay="0.35">
            <button
              class="inline-flex items-center gap-[5px] h-6 px-2 border border-solid border-transparent rounded-[7px] bg-transparent text-ink-2 text-[11.5px] cursor-pointer flex-[0_1_auto] min-w-0 max-w-[190px] transition-colors duration-140 hover:bg-surface-2 hover:border-line hover:text-ink disabled:opacity-60 disabled:cursor-wait"
              :disabled="switchingBranch"
            >
              <!-- Lucide GitBranch -->
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round" class="w-[12.5px] h-[12.5px] flex-none">
                <line x1="6" x2="6" y1="3" y2="15" />
                <circle cx="18" cy="6" r="3" />
                <circle cx="6" cy="18" r="3" />
                <path d="M18 9a9 9 0 0 1-9 9" />
              </svg>
              <span class="truncate font-mono">{{ switchingBranch ? '切换中…' : currentBranch }}</span>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-[11px] h-[11px] opacity-65 flex-none">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
          </Tooltip>
        </Dropdown>
      </template>
    </div>

    <input ref="inputFiles" type="file" multiple hidden @change="(e) => addFiles((e.target as HTMLInputElement).files!)" />
  </div>
</template>

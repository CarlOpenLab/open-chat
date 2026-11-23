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
  const skillVal = skillFromSender?.value ?? selectedSkill.value?.value;
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
    class="composer-wrap"
    @dragenter.prevent="onDragEnter"
    @dragover.prevent
    @dragleave="onDragLeave"
    @drop.prevent="onDrop"
  >


    <!-- Peeking back cards (click any card to bring it to the front) -->
    <div v-if="backDeckCards.length" class="deck-peeks">
      <button
        v-for="(kind, idx) in backDeckCards"
        :key="kind"
        type="button"
        class="deck-peek"
        :class="[
          `kind-${kind}`,
          backDeckCards.length >= 2 && idx === 0 ? 'tier-far' : 'tier-near',
        ]"
        @click="selectDeck(kind)"
      >
        <template v-if="kind === 'permission' && currentPerm">
          <span class="peek-dot warn" />
          <span class="peek-label">待确认{{ permList.length > 1 ? ` (${permList.length})` : '' }}</span>
          <span class="peek-text">{{ currentPerm.title }}</span>
          <span class="peek-switch">切换</span>
        </template>
        <template v-else-if="kind === 'skills'">
          <span class="peek-dot skills" />
          <span class="peek-label">Skills 与命令 ({{ allSkills.length }})</span>
          <span class="peek-text">{{ selectedSkill ? `当前：/${selectedSkill.name}` : '点击展开选择' }}</span>
          <span class="peek-switch">切换</span>
        </template>
        <template v-else-if="kind === 'queue'">
          <span class="peek-dot queue" />
          <span class="peek-label">待发消息 ({{ queueList.length }})</span>
          <span class="peek-text">{{ queuePreview(queueList[0].blocks) }}</span>
          <span class="peek-switch">切换</span>
        </template>
        <template v-else-if="kind === 'files'">
          <span class="peek-dot files" />
          <span class="peek-label">已选附件 ({{ attached.length }})</span>
          <span class="peek-text">{{ filesSummary }}</span>
          <span class="peek-switch">切换</span>
        </template>
      </button>
    </div>

    <div class="composer-shell" :class="{ 'has-tray': effectiveDeck !== null, 'is-perm': effectiveDeck === 'permission' }">
      <!-- Active Front Card: Permission Confirmation -->
      <div v-if="effectiveDeck === 'permission' && currentPerm" class="tray-panel perm-panel">
        <div class="perm-head">
          <span class="perm-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />
              <path d="M12 8v4" />
              <path d="M12 16h.01" />
            </svg>
          </span>
          <div class="perm-meta" @click="emit('jump-turn', currentPerm.turnId)">
            <div class="perm-title-row">
              <span class="perm-title">{{ currentPerm.title }}</span>
              <span v-if="permList.length > 1" class="perm-count mono">1 / {{ permList.length }}</span>
            </div>
            <div v-if="currentPerm.detail" class="perm-detail mono" :title="currentPerm.detail">
              {{ nicePath(currentPerm.detail) }}
            </div>
          </div>
          <div class="perm-actions">
            <button
              v-for="o in permRejects"
              :key="o.optionId"
              type="button"
              class="perm-btn reject"
              :disabled="submittingPermId === currentPerm.requestId"
              @click="answerPerm(currentPerm.requestId, o.optionId)"
            >
              {{ permOptionLabel(o) }}
            </button>
            <button
              v-for="o in permAllows"
              :key="o.optionId"
              type="button"
              class="perm-btn"
              :class="o.kind === 'allow_always' ? 'allow-always' : 'allow-once'"
              :disabled="submittingPermId === currentPerm.requestId"
              @click="answerPerm(currentPerm.requestId, o.optionId)"
            >
              {{ permOptionLabel(o) }}
            </button>
          </div>
        </div>
      </div>

      <!-- Active Front Card: Queued Messages -->
      <div v-else-if="effectiveDeck === 'queue' && queueList.length" class="tray-panel queue-panel">
        <div class="queue-list">
          <div v-for="(item, qi) in queueList" :key="item.id" class="queue-row">
            <span class="queue-tag mono">{{ qi + 1 }}</span>
            <span class="queue-text" :title="queuePreview(item.blocks)">{{ queuePreview(item.blocks) }}</span>
            <div class="queue-acts">
              <Tooltip title="立即打断当前输出并发送" :mouse-enter-delay="0.25">
                <button type="button" class="queue-ic steer" aria-label="立即发送" @click.stop="emit('steer-queued', item.id)">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="9 10 4 15 9 20" />
                    <path d="M20 4v7a4 4 0 0 1-4 4H4" />
                  </svg>
                </button>
              </Tooltip>
              <Tooltip title="放回输入框编辑" :mouse-enter-delay="0.25">
                <button type="button" class="queue-ic" aria-label="编辑" @click.stop="emit('edit-queued', item.id)">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
                  </svg>
                </button>
              </Tooltip>
              <Tooltip title="移出队列" :mouse-enter-delay="0.25">
                <button type="button" class="queue-ic danger" aria-label="删除" @click.stop="emit('remove-queued', item.id)">
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
      <div v-else-if="effectiveDeck === 'skills' && slashOpen" class="tray-panel skills-tray">
        <div class="skills-tray-head">
          <span class="skills-tray-title">
            <span class="skills-slash-mark mono">/</span>
            <span>{{ slashQuery ? slashQuery : 'Skills 与命令' }}</span>
          </span>
          <span class="skills-tray-hint">↑↓ 选择 · Enter 唤起 · Esc 收起</span>
          <span class="grow" />
          <div v-if="skillFilterTabs.length > 2" class="skills-tabs">
            <button
              v-for="tab in skillFilterTabs"
              :key="tab.key"
              type="button"
              class="skills-tab"
              :class="{ active: skillFilter === tab.key }"
              @mousedown.prevent="skillFilter = tab.key"
            >
              {{ tab.label }}
            </button>
          </div>
          <button type="button" class="skills-tray-close" aria-label="收起" @mousedown.prevent="slashDismissed = true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>

        <div v-if="slashItems.length" class="skills-grid">
          <button
            v-for="(c, i) in slashItems"
            :key="c.name"
            type="button"
            class="skill-tile"
            :class="{ active: i === slashIndex }"
            :title="c.description || c.name"
            @mouseenter="slashIndex = i"
            @mousedown.prevent="pickSkill(c)"
          >
            <div class="skill-tile-top">
              <span class="skill-tile-dot" :class="c.kind === 'command' ? 'is-cmd' : `is-${c.source}`" />
              <span class="skill-tile-name mono">/{{ c.name }}</span>
              <span class="skill-tile-tag" :class="c.kind === 'command' ? 'is-cmd' : `is-${c.source}`">
                {{ skillBadgeText(c) }}
              </span>
            </div>
            <div class="skill-tile-desc">{{ c.description || '点击或按 Enter 唤起' }}</div>
          </button>
        </div>
        <div v-else class="skills-tray-empty">
          {{ allSkills.length ? '未找到匹配的 Skill 或命令' : '暂无可用 Skills（可在项目 .claude/skills 或 ~/.claude/skills 添加）' }}
        </div>
      </div>

      <!-- Active Front Card: Uploaded Files / Images -->
      <div v-else-if="effectiveDeck === 'files' && attached.length" class="top-tray">
        <div
          class="mini-cards-group"
          :class="{ 'is-stacked': attached.length > 1 }"
          :style="attached.length > 1 ? { '--fan-count': Math.min(attached.length, 4) } : undefined"
        >
          <div v-for="(a, i) in attached.slice(0, 4)" :key="i" class="mini-card" :class="{ 'is-img': a.type === 'image' }">
            <button class="mini-card-remove" @click.stop="removeAt(i)" aria-label="移除">×</button>
            <img
              v-if="a.type === 'image'"
              :src="`data:${a.mimeType};base64,${a.data}`"
              alt="附件图片"
              class="mini-card-thumb"
            />
            <template v-else>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" class="mini-file-ic">
                <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
              <span class="mini-card-title">{{ (a as { name: string }).name }}</span>
            </template>
            <span v-if="i === 0 && attached.length > 4" class="mini-more mono">+{{ attached.length - 4 }}</span>
          </div>
        </div>

        <Tooltip title="继续添加图片或文件" :mouse-enter-delay="0.3">
          <button type="button" class="upload-dashed-tile" aria-label="添加图片或文件" @click="inputFiles?.click()">
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
        class="composer"
        :class="{ busy: running, dragging }"
        @compositionstart.capture="onCompositionStart"
        @compositionend.capture="onCompositionEnd"
      >
        <div v-if="dragging" class="drop-overlay">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="lucide">
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
        :auto-size="{ minRows: lockProvider ? 1 : 2, maxRows: 10 }"
        :placeholder="selectedSkill ? `使用 /${selectedSkill.name}，输入补充说明或直接发送…` : (placeholder ?? '描述你想完成的任务…')"
        :on-change="onSenderChange"
        :on-key-down="onKeydown"
        :on-paste-file="onPasteFile"
        :on-paste="onPaste"
        :on-submit="submit"
        :on-cancel="() => emit('stop')"
        class="sender"
      >
        <template #suffix><span style="display: none" /></template>
        <template #footer>
          <div class="bar">
            <!-- Leftmost: File / Image attachment + Skills Picker -->
            <Tooltip title="添加图片或文件（支持拖拽 / 粘贴）" :mouse-enter-delay="0.3">
              <button type="button" class="icon-ctrl" @click="inputFiles?.click()" aria-label="添加附件">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="lucide">
                  <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                </svg>
              </button>
            </Tooltip>



            <span class="grow" />

            <!-- Rightmost: Standalone Thinking/Reasoning icon (Codex-style) + Agent/Model Picker + Send -->
            <div class="right-controls">
              <Dropdown :menu="effortMenu" :trigger="['click']" placement="topRight">
                <Tooltip :title="`思考强度：${currentEffortLabel}`" :mouse-enter-delay="0.3">
                  <button
                    class="icon-ctrl think-btn"
                    :class="`tier-${currentEffortTier}`"
                    aria-label="思考强度"
                  >
                    <!-- Lucide Brain -->
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" class="lucide">
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
                  <button class="send-btn queue-btn" @click="() => submit()" aria-label="加入队列">
                    <!-- Lucide ArrowUp -->
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" class="send-ic">
                      <line x1="12" y1="19" x2="12" y2="5" />
                      <polyline points="5 12 12 5 19 12" />
                    </svg>
                  </button>
                </Tooltip>
                <Tooltip title="停止生成" :mouse-enter-delay="0.3">
                  <button class="send-btn stop" @click="emit('stop')" aria-label="停止">
                    <span class="stop-square" />
                  </button>
                </Tooltip>
              </template>
              <Tooltip v-else :title="`发送 (${sendKey === 'enter' ? 'Enter' : 'Shift+Enter'})`" :mouse-enter-delay="0.3">
                <button class="send-btn" :disabled="!canSend" @click="() => submit()" aria-label="发送">
                  <!-- Lucide ArrowUp -->
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" class="send-ic">
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
    <div class="subbar">
      <Dropdown :menu="permissionMenu" :trigger="['click']" placement="bottomLeft" :disabled="isPi">
        <Tooltip :title="isPi ? 'Pi 仅支持完全访问模式' : '选择权限模式'" :mouse-enter-delay="0.35">
          <button class="sub-pill" :class="{ warn: effectivePerm === 'full', auto: effectivePerm === 'auto', locked: isPi }">
            <!-- Lucide LockOpen / Zap / Shield -->
            <svg v-if="effectivePerm === 'full'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round" class="lucide xs">
              <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 9.9-1" />
            </svg>
            <svg v-else-if="effectivePerm === 'auto'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round" class="lucide xs">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
            <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round" class="lucide xs">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />
            </svg>
            <span>{{ currentPermLabel }}</span>
            <svg v-if="!isPi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="sub-chev">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        </Tooltip>
      </Dropdown>

      <span class="sub-sep" />

      <button class="sub-pill cwd-pill" :title="cwd" @click="emit('cwd')">
        <!-- Lucide Folder -->
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round" class="lucide xs">
          <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
        </svg>
        <span class="cwd-path mono">{{ cwdLabel }}</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="sub-chev">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      <template v-if="isGitRepo">
        <span class="sub-sep" />
        <Dropdown
          :menu="branchMenu"
          :trigger="['click']"
          placement="bottomLeft"
          overlay-class-name="branch-dropdown"
          @open-change="(open: boolean) => { if (open && cwd) void refreshGit(cwd); }"
        >
          <Tooltip :title="`切换 Git 分支（当前：${currentBranch}）`" :mouse-enter-delay="0.35">
            <button class="sub-pill branch-pill" :disabled="switchingBranch">
              <!-- Lucide GitBranch -->
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round" class="lucide xs">
                <line x1="6" x2="6" y1="3" y2="15" />
                <circle cx="18" cy="6" r="3" />
                <circle cx="6" cy="18" r="3" />
                <path d="M18 9a9 9 0 0 1-9 9" />
              </svg>
              <span class="branch-name mono">{{ switchingBranch ? '切换中…' : currentBranch }}</span>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="sub-chev">
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

<style scoped>
.composer-wrap {
  position: relative;
  width: 100%;
}

.lucide {
  width: 15px;
  height: 15px;
  flex: none;
}
.lucide.sm {
  width: 13px;
  height: 13px;
}
.lucide.xs {
  width: 12.5px;
  height: 12.5px;
}

/* Peeking back cards above the composer shell (click any card to switch to front) */
.deck-peeks {
  display: flex;
  flex-direction: column;
  align-items: center;
  position: relative;
  z-index: 1;
  margin-bottom: -10px;
}

.deck-peek {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 38px;
  padding: 0 14px 8px;
  border: 1px solid var(--border-strong);
  border-bottom: none;
  border-radius: 14px 14px 0 0;
  background: var(--surface-2);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  color: var(--text-2);
  font-size: 12px;
  cursor: pointer;
  transition: transform 0.2s var(--ease), background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
}
.deck-peek.tier-near {
  width: 95%;
  z-index: 2;
}
.deck-peek.tier-far {
  width: 90%;
  margin-bottom: -10px;
  z-index: 1;
  opacity: 0.88;
}
.deck-peek:hover {
  transform: translateY(-2px);
  background: var(--surface);
  color: var(--text);
}
.deck-peek.kind-permission {
  border-color: color-mix(in srgb, var(--warn) 36%, var(--border-strong));
  background: color-mix(in srgb, var(--warn-soft) 45%, var(--surface-2));
}
.deck-peek.kind-permission:hover {
  background: color-mix(in srgb, var(--warn-soft) 65%, var(--surface));
}

.peek-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex: none;
}
.peek-dot.warn {
  background: var(--warn);
  animation: oc-pulse 1.4s ease-in-out infinite;
}
.peek-dot.queue {
  background: var(--ink);
  opacity: 0.7;
}
.peek-dot.files {
  background: var(--ok);
}
.peek-label {
  font-weight: 560;
  color: var(--text);
  flex: none;
}
.peek-text {
  flex: 1;
  min-width: 0;
  text-align: left;
  color: var(--text-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.peek-switch {
  font-size: 11px;
  color: var(--text-3);
  flex: none;
  padding: 1px 6px;
  border-radius: 5px;
  background: var(--hover);
  transition: color 0.14s, background 0.14s;
}
.deck-peek:hover .peek-switch {
  color: var(--text);
  background: var(--active);
}

/* Outer shell matching sender-stacked-studio: rounded 20px tray seamlessly wrapping the 18px Sender card */
.composer-shell {
  position: relative;
  z-index: 2;
  border-radius: 20px;
}
.composer-shell.has-tray {
  border: 1px solid var(--border-strong);
  background: var(--surface-2);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  box-shadow: var(--shadow-composer);
}
.composer-shell.is-perm {
  border-color: color-mix(in srgb, var(--warn) 38%, var(--border-strong));
  background: color-mix(in srgb, var(--warn-soft) 32%, var(--surface-2));
}

.tray-panel {
  padding: 11px 14px;
}

/* Active Permission Confirmation Panel */
.perm-head {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.perm-icon {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  display: inline-grid;
  place-items: center;
  flex: none;
  background: color-mix(in srgb, var(--warn) 15%, transparent);
  color: var(--warn);
}
.perm-icon svg {
  width: 15px;
  height: 15px;
}
.perm-meta {
  flex: 1;
  min-width: 0;
  cursor: pointer;
}
.perm-title-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.perm-title {
  font-size: 13px;
  font-weight: 580;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.perm-count {
  font-size: 10.5px;
  line-height: 16px;
  padding: 0 5px;
  border-radius: 5px;
  background: color-mix(in srgb, var(--warn) 18%, transparent);
  color: var(--warn);
  flex: none;
}
.perm-detail {
  font-size: 11px;
  color: var(--text-3);
  margin-top: 1px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.perm-actions {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: none;
}
.perm-btn {
  height: 27px;
  padding: 0 11px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 540;
  cursor: pointer;
  border: 1px solid var(--border-strong);
  background: var(--surface-strong);
  color: var(--text-2);
  transition: background 0.14s, color 0.14s, border-color 0.14s, opacity 0.14s;
  white-space: nowrap;
}
.perm-btn:disabled {
  opacity: 0.55;
  cursor: wait;
}
.perm-btn.reject:hover:not(:disabled) {
  color: var(--err);
  border-color: color-mix(in srgb, var(--err) 35%, var(--border-strong));
  background: var(--err-soft);
}
.perm-btn.allow-always {
  color: var(--text);
  background: var(--surface-strong);
}
.perm-btn.allow-always:hover:not(:disabled) {
  background: var(--hover);
  border-color: color-mix(in srgb, var(--ink) 28%, var(--border-strong));
}
.perm-btn.allow-once {
  background: var(--ink);
  border-color: var(--ink);
  color: var(--ink-inv);
}
.perm-btn.allow-once:hover:not(:disabled) {
  opacity: 0.88;
}

/* Active Queued Messages Panel */
.queue-panel {
  padding: 8px 12px;
}
.queue-list {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 116px;
  overflow-y: auto;
}
.queue-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 26px;
  padding: 2px 4px 2px 6px;
  border-radius: 7px;
  transition: background 0.14s var(--ease);
}
.queue-row:hover {
  background: var(--hover);
}
.queue-tag {
  width: 17px;
  height: 17px;
  border-radius: 5px;
  background: var(--hover);
  border: 1px solid var(--border);
  color: var(--text-3);
  font-size: 10.5px;
  display: inline-grid;
  place-items: center;
  flex: none;
}
.queue-text {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.queue-acts {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  flex: none;
}
.queue-ic {
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-3);
  display: inline-grid;
  place-items: center;
  cursor: pointer;
  transition: background 0.14s, color 0.14s;
}
.queue-ic svg {
  width: 12.5px;
  height: 12.5px;
}
.queue-ic:hover {
  background: var(--active);
  color: var(--text);
}
.queue-ic.steer {
  color: var(--text-2);
}
.queue-ic.steer:hover {
  background: var(--ink);
  color: var(--ink-inv);
}
.queue-ic.danger:hover {
  background: var(--err-soft);
  color: var(--err);
}

.composer {
  position: relative;
  z-index: 2;
  border: 1px solid var(--border-strong);
  background: var(--surface);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border-radius: 18px;
  box-shadow: var(--shadow-composer);
  transition: border-color 0.18s var(--ease), box-shadow 0.18s var(--ease), background 0.18s var(--ease);
  overflow: hidden;
}
.composer-shell.has-tray .composer {
  margin: 0 -1px -1px -1px;
  background: var(--surface-strong);
  box-shadow: 0 -2px 12px rgba(0, 0, 0, 0.1), var(--glass-rim);
}
.composer:focus-within {
  background: var(--surface-strong);
  border-color: color-mix(in srgb, var(--ink) 28%, var(--border-strong));
  box-shadow: var(--shadow-composer), 0 0 0 3px var(--accent-soft);
}
.composer.dragging {
  border-color: var(--ink);
  box-shadow: 0 0 0 3px var(--accent-soft);
}

.drop-overlay {
  position: absolute;
  inset: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: var(--surface-strong);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  color: var(--text);
  font-size: 13px;
  font-weight: 550;
  pointer-events: none;
}

.sender {
  background: transparent !important;
  border: none !important;
  box-shadow: none !important;
}
.sender :deep(.antd-sender-content) {
  padding: 12px 16px 6px 16px !important;
}
.sender :deep(textarea),
.sender :deep(.ant-input) {
  font-size: 14.5px !important;
  line-height: 1.62 !important;
  padding: 0 !important;
  color: var(--text) !important;
}
.sender :deep(.antd-sender-input-slot) {
  font-size: 14.5px !important;
  line-height: 24px !important;
  padding: 0 !important;
  color: var(--text) !important;
  outline: none !important;
  overflow-x: hidden !important;
  box-sizing: border-box !important;
}
.sender :deep(.antd-sender-input-slot .ProseMirror) {
  font-size: 14.5px !important;
  line-height: 24px !important;
  padding: 0 !important;
  color: var(--text) !important;
  outline: none !important;
  min-height: 24px !important;
  overflow: visible !important;
}
.sender :deep(textarea:focus-visible),
.sender :deep(.ant-input:focus-visible) {
  box-shadow: none !important;
}
.sender :deep(.antd-sender-footer) {
  padding: 4px 12px 10px 10px !important;
  border-top: none !important;
}
.sender :deep(.antd-sender-input) {
  background: transparent !important;
  border: none !important;
  box-shadow: none !important;
}
.sender :deep(.antd-sender-skill) {
  display: inline-flex !important;
  align-items: center !important;
  height: 21px !important;
  line-height: 21px !important;
  margin: 0 !important;
  vertical-align: middle !important;
  transform: translateY(-1px);
}
.sender :deep(.antd-sender-skill-wrapper) {
  display: inline-flex !important;
  align-items: center !important;
  height: 21px !important;
}
.sender :deep(.antd-sender-skill-holder) {
  width: 6px !important;
  height: 21px !important;
}
.sender :deep(.antd-sender-skill-tag) {
  display: inline-flex !important;
  align-items: center !important;
  gap: 4px !important;
  height: 21px !important;
  padding: 0 4px 0 7px !important;
  box-sizing: border-box !important;
  border-radius: 6px !important;
  background: color-mix(in srgb, #6366f1 10%, var(--surface-2)) !important;
  border: 1px solid color-mix(in srgb, #6366f1 22%, var(--border-strong)) !important;
  color: var(--text) !important;
  font-size: 12px !important;
  font-weight: 530 !important;
  line-height: 1 !important;
  box-shadow: none !important;
  transition: background 0.15s var(--ease), border-color 0.15s var(--ease) !important;
}
.sender :deep(.antd-sender-skill-tag:hover) {
  background: color-mix(in srgb, #6366f1 15%, var(--surface-2)) !important;
  border-color: color-mix(in srgb, #6366f1 34%, var(--border-strong)) !important;
}
.sender :deep(.antd-sender-skill-tag-text) {
  display: inline-flex !important;
  align-items: center !important;
  line-height: 1 !important;
}
.sender :deep(.oc-skill-label) {
  display: inline-flex;
  align-items: center;
  gap: 1px;
  font-size: 12px;
}
.sender :deep(.oc-skill-slash) {
  color: #6366f1;
  font-weight: 600;
}
:root[data-theme="dark"] .sender :deep(.oc-skill-slash) {
  color: #818cf8;
}
.sender :deep(.oc-skill-name) {
  letter-spacing: -0.01em;
}
.sender :deep(.antd-sender-skill-close) {
  display: inline-grid !important;
  place-items: center !important;
  width: 14px !important;
  height: 14px !important;
  border-radius: 4px !important;
  color: var(--text-3) !important;
  font-size: 9px !important;
  opacity: 0.72;
  cursor: pointer;
  transition: background 0.12s, color 0.12s, opacity 0.12s !important;
}
.sender :deep(.antd-sender-skill-close:hover) {
  opacity: 1;
  background: color-mix(in srgb, var(--ink) 12%, transparent) !important;
  color: var(--text) !important;
}
.skill-btn.active {
  background: color-mix(in srgb, #6366f1 12%, transparent);
  border-color: color-mix(in srgb, #6366f1 28%, var(--border));
  color: #6366f1;
}
:root[data-theme="dark"] .skill-btn.active {
  color: #818cf8;
}

.bar {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 32px;
}

.icon-ctrl {
  display: inline-grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--text-2);
  cursor: pointer;
  transition: background 0.14s, color 0.14s, border-color 0.14s;
}
.icon-ctrl:hover {
  background: var(--hover);
  border-color: var(--border);
  color: var(--text);
}
.think-btn.tier-low {
  color: #38bdf8;
  background: rgba(56, 189, 248, 0.14);
  border-color: rgba(56, 189, 248, 0.26);
}
.think-btn.tier-medium {
  color: #10b981;
  background: rgba(16, 185, 129, 0.14);
  border-color: rgba(16, 185, 129, 0.26);
}
.think-btn.tier-high {
  color: #a78bfa;
  background: rgba(167, 139, 250, 0.16);
  border-color: rgba(167, 139, 250, 0.28);
}
.think-btn.tier-xhigh {
  color: #f59e0b;
  background: rgba(245, 158, 11, 0.16);
  border-color: rgba(245, 158, 11, 0.28);
}
.think-btn.tier-max {
  color: #f43f5e;
  background: rgba(244, 63, 94, 0.17);
  border-color: rgba(244, 63, 94, 0.3);
}

.right-controls {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.send-btn {
  width: 30px;
  height: 30px;
  border-radius: 999px;
  border: none;
  background: var(--ink);
  color: var(--ink-inv);
  display: inline-grid;
  place-items: center;
  cursor: pointer;
  flex: none;
  transition: transform 0.14s var(--ease), opacity 0.14s, background 0.14s;
}
.send-ic {
  width: 14px;
  height: 14px;
}
.send-btn:hover:not(:disabled) {
  transform: scale(1.04);
}
.send-btn:active:not(:disabled) {
  transform: scale(0.96);
}
.send-btn:disabled {
  background: var(--hover);
  color: var(--text-3);
  cursor: not-allowed;
  opacity: 0.65;
}
.send-btn.queue-btn {
  background: var(--surface-2);
  border: 1px solid var(--border-strong);
  color: var(--text);
}
.send-btn.queue-btn:hover {
  background: var(--ink);
  border-color: var(--ink);
  color: var(--ink-inv);
}
.send-btn.stop {
  background: var(--ink);
}
.stop-square {
  width: 9px;
  height: 9px;
  border-radius: 2px;
  background: var(--ink-inv);
}

.sel {
  font-size: 12px;
  max-width: 150px;
}
.sel :deep(.ant-select-selection-item) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 26px !important;
  font-size: 12px;
}
.sel :deep(.ant-select-selector) {
  padding: 0 7px !important;
  height: 26px !important;
  color: var(--text-2) !important;
  font-size: 12px;
  border-radius: 8px !important;
  transition: background 0.14s, color 0.14s;
}
.sel:hover :deep(.ant-select-selector) {
  background: var(--hover) !important;
  color: var(--text) !important;
}

.grow {
  flex: 1;
}

/* Below-sender bar: Permission Select, Directory, Git Branch */
.subbar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px 6px 0;
  height: 32px;
  flex-wrap: nowrap;
  overflow: hidden;
}

.sub-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 24px;
  padding: 0 8px;
  border: 1px solid transparent;
  border-radius: 7px;
  background: transparent;
  color: var(--text-2);
  font-size: 11.5px;
  cursor: pointer;
  flex: none;
  transition: background 0.14s, color 0.14s, border-color 0.14s;
}
.sub-pill:hover:not(.locked) {
  background: var(--surface-2);
  border-color: var(--border);
  color: var(--text);
}
.sub-pill.locked {
  cursor: default;
}
.sub-pill.auto {
  color: var(--text);
}
.sub-pill.warn {
  color: var(--warn);
}
.cwd-pill {
  flex: 0 1 auto;
  min-width: 0;
  max-width: 260px;
}
.cwd-path {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.branch-pill {
  color: var(--text-2);
  flex: 0 1 auto;
  min-width: 0;
  max-width: 190px;
}
.branch-pill:disabled {
  opacity: 0.6;
  cursor: wait;
}
.branch-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sub-chev {
  width: 11px;
  height: 11px;
  opacity: 0.65;
  flex: none;
}
.sub-sep {
  width: 1px;
  height: 12px;
  background: var(--border-strong);
  margin: 0 2px;
}


/* Top stacked mini-cards tray (matches sender-stacked-studio 1:1 curved seam) */
.top-tray {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 16px;
  background: transparent;
}

.mini-cards-group {
  display: flex;
  align-items: center;
  gap: 10px;
  transition: width 0.28s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.mini-cards-group.is-stacked {
  position: relative;
  width: 78px;
  height: 68px;
}
.mini-cards-group.is-stacked:hover {
  width: calc((var(--fan-count, 2) - 1) * 64px + 72px);
}

.mini-card {
  width: 68px;
  height: 68px;
  border-radius: 12px;
  border: 1px solid var(--border-strong);
  background: var(--surface-strong);
  box-shadow: var(--shadow-card);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  position: relative;
  cursor: pointer;
  transition: transform 0.28s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.24s ease, border-color 0.16s ease;
  user-select: none;
  flex: none;
}
.mini-card.is-img {
  padding: 0;
}
.mini-card-thumb {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 11px;
  display: block;
}
.mini-file-ic {
  width: 18px;
  height: 18px;
  color: var(--text-2);
  flex: none;
}
.mini-card-title {
  font-size: 10px;
  color: var(--text-2);
  max-width: 56px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mini-more {
  position: absolute;
  bottom: 4px;
  right: 4px;
  font-size: 10px;
  line-height: 15px;
  padding: 0 5px;
  border-radius: 999px;
  background: var(--ink);
  color: var(--ink-inv);
  font-weight: 600;
}

.mini-card-remove {
  position: absolute;
  top: -6px;
  right: -6px;
  z-index: 6;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--ink);
  color: var(--ink-inv);
  font-size: 12px;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  cursor: pointer;
  opacity: 0;
  transform: scale(0.85);
  transition: opacity 0.14s ease, transform 0.14s ease;
}
.mini-card:hover .mini-card-remove {
  opacity: 1;
  transform: scale(1);
}

/* Stacked overlap & tilt physics */
.mini-cards-group.is-stacked .mini-card {
  position: absolute;
  top: 0;
  left: 0;
  transform-origin: bottom center;
}
.mini-cards-group.is-stacked .mini-card:nth-child(1) {
  z-index: 4;
  transform: translate(0, 0) rotate(0deg);
}
.mini-cards-group.is-stacked .mini-card:nth-child(2) {
  z-index: 3;
  transform: translate(6px, -3px) rotate(5deg);
}
.mini-cards-group.is-stacked .mini-card:nth-child(3) {
  z-index: 2;
  transform: translate(-5px, -5px) rotate(-6deg);
}
.mini-cards-group.is-stacked .mini-card:nth-child(4) {
  z-index: 1;
  transform: translate(10px, -6px) rotate(8deg);
}

/* Hover spring fan-out */
.mini-cards-group.is-stacked:hover .mini-card:nth-child(1) {
  transform: translate(0, -4px) rotate(-2deg);
  box-shadow: var(--shadow-pop);
}
.mini-cards-group.is-stacked:hover .mini-card:nth-child(2) {
  transform: translate(62px, -2px) rotate(3deg);
  box-shadow: var(--shadow-pop);
}
.mini-cards-group.is-stacked:hover .mini-card:nth-child(3) {
  transform: translate(124px, 0px) rotate(6deg);
  box-shadow: var(--shadow-pop);
}
.mini-cards-group.is-stacked:hover .mini-card:nth-child(4) {
  transform: translate(186px, 2px) rotate(9deg);
  box-shadow: var(--shadow-pop);
}

.upload-dashed-tile {
  width: 68px;
  height: 68px;
  border-radius: 12px;
  border: 1.5px dashed var(--border-strong);
  background: transparent;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-3);
  cursor: pointer;
  flex: none;
  transition: border-color 0.16s ease, background 0.16s ease, color 0.16s ease, transform 0.16s var(--ease);
}
.upload-dashed-tile:hover {
  border-color: var(--ink);
  background: var(--surface);
  color: var(--text);
}
.upload-dashed-tile:active {
  transform: scale(0.96);
}

.peek-dot.skills {
  background: #6366f1;
}

/* Integrated Skills Tray inside composer-shell (triggered by typing /) */
.skills-tray {
  padding: 10px 12px 12px;
  display: flex;
  flex-direction: column;
  gap: 9px;
}
.skills-tray-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 2px;
}
.skills-tray-title {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 12px;
  font-weight: 560;
  color: var(--text);
  flex: none;
}
.skills-slash-mark {
  color: #6366f1;
  font-weight: 700;
}
:root[data-theme="dark"] .skills-slash-mark {
  color: #818cf8;
}
.skills-tray-hint {
  font-size: 10.5px;
  color: var(--text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.skills-tabs {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px;
  border-radius: 7px;
  background: var(--hover);
  flex: none;
}
.skills-tab {
  border: none;
  background: transparent;
  color: var(--text-3);
  font-size: 11px;
  line-height: 18px;
  padding: 0 7px;
  border-radius: 5px;
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
}
.skills-tab:hover {
  color: var(--text-2);
}
.skills-tab.active {
  background: var(--surface-strong);
  color: var(--text);
  font-weight: 540;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
}
.skills-tray-close {
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-3);
  display: inline-grid;
  place-items: center;
  cursor: pointer;
  flex: none;
  transition: background 0.12s, color 0.12s;
}
.skills-tray-close svg {
  width: 13px;
  height: 13px;
}
.skills-tray-close:hover {
  background: var(--hover);
  color: var(--text);
}
.skills-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(168px, 1fr));
  gap: 8px;
  max-height: 168px;
  overflow-y: auto;
  padding: 1px;
}
.skill-tile {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 10px;
  border-radius: 11px;
  border: 1px solid var(--border);
  background: var(--surface-strong);
  box-shadow: var(--shadow-card);
  text-align: left;
  cursor: pointer;
  min-width: 0;
  transition: transform 0.15s var(--ease), border-color 0.15s ease, background 0.15s ease, box-shadow 0.15s ease;
}
.skill-tile:hover {
  transform: translateY(-1px);
  border-color: color-mix(in srgb, #6366f1 34%, var(--border-strong));
  box-shadow: var(--shadow-pop);
}
.skill-tile.active {
  border-color: color-mix(in srgb, #6366f1 52%, var(--border-strong));
  background: color-mix(in srgb, #6366f1 7%, var(--surface-strong));
}
.skill-tile-top {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.skill-tile-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  flex: none;
  background: var(--text-3);
}
.skill-tile-dot.is-project {
  background: #6366f1;
}
.skill-tile-dot.is-user {
  background: #10b981;
}
.skill-tile-dot.is-cmd {
  background: var(--text-3);
}
.skill-tile-name {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  font-weight: 580;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.skill-tile-tag {
  flex: none;
  font-size: 10px;
  line-height: 15px;
  padding: 0 5px;
  border-radius: 4px;
  background: var(--hover);
  color: var(--text-3);
}
.skill-tile-tag.is-project {
  color: #6366f1;
  background: color-mix(in srgb, #6366f1 11%, transparent);
}
:root[data-theme="dark"] .skill-tile-tag.is-project {
  color: #818cf8;
}
.skill-tile-desc {
  font-size: 11px;
  line-height: 1.4;
  color: var(--text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.skills-tray-empty {
  padding: 12px 8px;
  text-align: center;
  font-size: 12px;
  color: var(--text-3);
}

.pop-enter-active,
.pop-leave-active {
  transition: opacity 0.14s var(--ease), transform 0.14s var(--ease);
}
.pop-enter-from,
.pop-leave-to {
  opacity: 0;
  transform: translateY(4px);
}
</style>

<style>
.perm-opt {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 196px;
  padding: 2px 2px;
}
.perm-opt-main {
  display: flex;
  flex-direction: column;
  gap: 1px;
  flex: 1;
}
.perm-opt-label {
  font-size: 12.5px;
  font-weight: 520;
  color: var(--text);
  line-height: 17px;
}
.perm-opt-desc {
  font-size: 11px;
  color: var(--text-3);
  line-height: 14px;
}
.perm-opt-check {
  width: 13px;
  height: 13px;
  color: var(--text);
  flex: none;
}
.effort-opt {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 132px;
  padding: 2px 2px;
}
.effort-opt-label {
  flex: 1;
  font-size: 12.5px;
  font-weight: 500;
  color: var(--text);
}
.effort-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex: none;
}
.effort-dot.tier-low {
  background: #38bdf8;
}
.effort-dot.tier-medium {
  background: #10b981;
}
.effort-dot.tier-high {
  background: #a78bfa;
}
.effort-dot.tier-xhigh {
  background: #f59e0b;
}
.effort-dot.tier-max {
  background: #f43f5e;
}
.branch-dropdown .ant-dropdown-menu {
  max-height: 280px;
  overflow-y: auto;
}
.branch-opt {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 160px;
  max-width: 260px;
  padding: 2px 2px;
}
.branch-opt-name {
  flex: 1;
  font-size: 12px;
  color: var(--text-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.branch-opt.active .branch-opt-name {
  color: var(--text);
  font-weight: 560;
}
.branch-empty {
  font-size: 12px;
  color: var(--text-3);
}
</style>

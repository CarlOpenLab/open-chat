<script setup lang="ts">
import { Sender } from "@antdv-next/x";
import type { SenderPasteInfo } from "@antdv-next/x";
import { Dropdown, Tooltip, message } from "antdv-next";
import { computed, h, ref, watch } from "vue";
import { api } from "../api";
import { saveSettings, store } from "../store";
import type { Block, ConfigOption, GitInfo, LiveState } from "../types";
import ProviderPicker from "./ProviderPicker.vue";

type PermissionMode = "supervised" | "auto" | "full";
type EffortKey = "low" | "medium" | "high" | "xhigh" | "max";

const gitCache = new Map<string, { info: GitInfo | null; fallback: boolean }>();

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
  cwd: [];
  manage: [];
}>();

const attached = ref<Block[]>([]);
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
}

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

watch(
  () => props.conversationId,
  () => {
    attached.value = [];
    slashDismissed.value = false;
    dragging.value = false;
    dragDepth = 0;
  },
);

watch(
  () => props.cwd,
  (dir) => {
    void refreshGit(dir);
  },
  { immediate: true },
);

const commands = computed(() => props.live.commands ?? []);
const slashQuery = computed(() => {
  const m = /^\/([^\s]*)$/.exec(props.value);
  return m ? m[1] : null;
});
const slashItems = computed(() =>
  slashQuery.value == null
    ? []
    : commands.value.filter((c) => c.name.toLowerCase().includes(slashQuery.value!.toLowerCase())).slice(0, 7),
);
const slashOpen = computed(() => slashQuery.value != null && slashItems.value.length > 0);
const slashIndex = ref(0);
watch(slashItems, () => (slashIndex.value = 0));
const slashDismissed = ref(false);
watch(
  () => props.value,
  () => (slashDismissed.value = false),
);

function pickCommand(name: string) {
  emit("update:value", `/${name} `);
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
const canSend = computed(() => !props.disabled && (props.value.trim().length > 0 || attached.value.length > 0));

function nicePath(p: string) {
  const home = store.boot?.home;
  if (home && p === home) return "~";
  if (home && p.startsWith(home + "/")) return "~" + p.slice(home.length);
  return p;
}

const cwdLabel = computed(() => (props.cwd ? nicePath(props.cwd) : "选择工作目录"));

function submit() {
  if (!canSend.value) return;
  const blocks: Block[] = [];
  const text = props.value.trim();
  if (text) blocks.push({ type: "text", text });
  for (const a of attached.value) blocks.push(a);
  if (running.value) {
    emit("enqueue", blocks);
  } else {
    emit("send", blocks);
  }
  attached.value = [];
}

function onKeydown(e: KeyboardEvent): void | false {
  if (isImeComposing(e)) {
    if (e.key === "Enter") return false;
    return;
  }
  if (slashOpen.value && !slashDismissed.value) {
    if (e.key === "ArrowDown") {
      slashIndex.value = (slashIndex.value + 1) % slashItems.value.length;
      return false;
    }
    if (e.key === "ArrowUp") {
      slashIndex.value = (slashIndex.value - 1 + slashItems.value.length) % slashItems.value.length;
      return false;
    }
    if (e.key === "Escape") {
      slashDismissed.value = true;
      return false;
    }
    if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey)) {
      const item = slashItems.value[slashIndex.value];
      if (item) pickCommand(item.name);
      return false;
    }
  }
  return;
}

async function addFiles(files: FileList | File[]) {
  for (const file of Array.from(files)) {
    if (file.type.startsWith("image/") && file.size < 8 * 1024 * 1024) {
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      attached.value.push({ type: "image", data, mimeType: file.type, uri: `file://${file.name}` });
    } else {
      attached.value.push({ type: "resource_link", uri: `file://${file.name}`, name: file.name, mimeType: file.type, size: file.size });
    }
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
  attached.value.splice(i, 1);
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
    <Transition name="pop">
      <div v-if="slashOpen && !slashDismissed" class="slash">
        <div class="slash-hint">斜杠命令 · ↑↓ 选择 · Enter 填入</div>
        <button
          v-for="(c, i) in slashItems"
          :key="c.name"
          class="slash-item"
          :class="{ active: i === slashIndex }"
          @mousedown.prevent="pickCommand(c.name)"
        >
          <span class="cmd mono">/{{ c.name }}</span>
          <span class="desc">{{ c.description }}</span>
        </button>
      </div>
    </Transition>

    <div class="composer-shell" :class="{ 'has-tray': attached.length > 0 }">
      <!-- Layer 1: Top attachment drawer (68x68 stacked mini-cards + adjacent dashed ImagePlus tile) -->
      <div v-if="attached.length" class="top-tray">
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
        v-model:value="draft"
        :loading="false"
        :disabled="disabled"
        :submit-type="sendKey"
        :auto-size="{ minRows: lockProvider ? 1 : 2, maxRows: 10 }"
        :placeholder="placeholder ?? '描述你想完成的任务…'"
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
            <!-- Leftmost: File / Image attachment (Lucide Paperclip) + Mode -->
            <Tooltip title="添加图片或文件（支持拖拽 / 粘贴）" :mouse-enter-delay="0.3">
              <button class="icon-ctrl" @click="inputFiles?.click()" aria-label="添加附件">
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
                  <button class="send-btn queue-btn" @click="submit" aria-label="加入队列">
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
                <button class="send-btn" :disabled="!canSend" @click="submit" aria-label="发送">
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

/* Outer shell matching sender-stacked-studio: rounded 20px tray seamlessly wrapping the 18px Sender card */
.composer-shell {
  position: relative;
  border-radius: 20px;
}
.composer-shell.has-tray {
  border: 1px solid var(--border);
  background: var(--surface-2);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  box-shadow: var(--shadow-composer);
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

.slash {
  position: absolute;
  left: 4px;
  right: 4px;
  bottom: calc(100% + 8px);
  background: var(--surface-strong);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border: 1px solid var(--border-strong);
  border-radius: 13px;
  box-shadow: var(--shadow-pop);
  padding: 6px;
  z-index: 30;
  max-height: 260px;
  overflow-y: auto;
}
.slash-hint {
  font-size: 10.5px;
  color: var(--text-3);
  padding: 4px 8px;
  letter-spacing: 0.02em;
}
.slash-item {
  display: flex;
  align-items: baseline;
  gap: 10px;
  width: 100%;
  border: none;
  background: transparent;
  border-radius: 8px;
  padding: 6px 8px;
  text-align: left;
  cursor: pointer;
  color: var(--text-2);
}
.slash-item.active,
.slash-item:hover {
  background: var(--hover);
}
.cmd {
  font-size: 12.5px;
  font-weight: 540;
  color: var(--text);
  flex: none;
}
.desc {
  font-size: 11.5px;
  color: var(--text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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

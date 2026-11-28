<script setup lang="ts">
import {
  ArrowLeftOutlined,
  CloseOutlined,
  DeleteOutlined,
  DownOutlined,
  FolderOpenOutlined,
  MessageOutlined,
  PlusOutlined,
  ReloadOutlined,
  SmileOutlined,
  SyncOutlined,
  UploadOutlined,
} from "@antdv-next/icons";
import { Button, Input, Modal, Popover, Select, Tooltip, message } from "antdv-next";
import { computed, ref, watch } from "vue";
import { api, inApp } from "../api";
import { getBotPreset, makeBotAvatar, randomBotAvatar, resolveBotAvatar } from "../botAvatar";
import { openBotChat, probeModels, refreshAgents, saveSettings, select, store } from "../store";
import type { Bot, BotFiles, ConfigSelectOption, Meta } from "../types";
import BotAvatar from "./BotAvatar.vue";
import BotAvatarPicker from "./BotAvatarPicker.vue";
import ProviderIcon from "./ProviderIcon.vue";

const props = defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  "update:open": [boolean];
}>();

const DEFAULT_MEMORY = `# 长期记忆

<!-- 在对话中持续沉淀：关注的项目目录、工作约定、已排查结论与待跟进事项 -->
`;

type PermissionPolicy = "allow" | "ask" | "inherit";
type EditDocTab = "soul" | "memory";

const creating = ref(false);
const openedAsCreate = ref(false);
const prevSelectedId = ref<string | null>(null);
const selectedId = ref<string | null>(null);
const draft = ref<Bot | null>(null);
const draftSoul = ref("");
const draftMemory = ref("");
const origSnapshot = ref("");
const avatarPickerOpen = ref(false);
const previewAvatarRef = ref<InstanceType<typeof BotAvatar> | null>(null);
const botFiles = ref<BotFiles | null>(null);
const editDocTab = ref<EditDocTab>("soul");
const loadingFiles = ref(false);
const savingBot = ref(false);
const openingChat = ref(false);
const deleteTarget = ref<Bot | null>(null);
const avatarInputRef = ref<HTMLInputElement | null>(null);

const bots = computed<Bot[]>(() => store.settings?.bots ?? []);

const enabledAgents = computed(() =>
  [...store.agents]
    .filter((a) => !a.disabled)
    .sort((a, b) => Number(b.available) - Number(a.available)),
);

function pickDefaultAgentId(): string {
  const pref = store.settings?.defaultAgent;
  if (pref && enabledAgents.value.some((a) => a.id === pref && a.available)) {
    return pref;
  }
  return (
    enabledAgents.value.find((a) => a.available)?.id ||
    (pref && enabledAgents.value.some((a) => a.id === pref) ? pref : "") ||
    enabledAgents.value[0]?.id ||
    ""
  );
}

function makeSnapshot(): string {
  return JSON.stringify({
    draft: draft.value,
    soul: draftSoul.value,
    memory: draftMemory.value,
  });
}

const isDirty = computed(() => {
  if (creating.value || !draft.value) return false;
  return makeSnapshot() !== origSnapshot.value;
});

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    void refreshAgents();
    const initial = store.botsInitialMode;
    const targetBotId = store.botsInitialBotId;
    store.botsInitialMode = "list";
    store.botsInitialBotId = null;
    if (initial === "create" || bots.value.length === 0) {
      openedAsCreate.value = true;
      startCreate();
    } else {
      openedAsCreate.value = false;
      const target =
        (targetBotId ? bots.value.find((b) => b.id === targetBotId) : undefined) ??
        bots.value.find((b) => b.id === selectedId.value) ??
        bots.value[0];
      if (target) void selectBot(target);
    }
  },
);

watch(enabledAgents, () => {
  if (draft.value && !draft.value.agentId) {
    draft.value.agentId = pickDefaultAgentId();
  }
});

watch(
  () => draft.value?.agentId,
  (agentId, prev) => {
    if (!props.open || !agentId) return;
    if (prev && prev !== agentId && draft.value) {
      draft.value.modelConfigId = "";
      draft.value.modelValue = "";
    }
    void probeModels(agentId, "");
  },
);

const draftAvatarSummary = computed(() => {
  if (!draft.value) return "";
  const resolved = resolveBotAvatar(draft.value.avatar, draft.value.name || "Bot");
  if (resolved.kind === "image") return "自定义图片";
  if (resolved.kind === "text") return `表情 ${resolved.text}`;
  const preset = getBotPreset(resolved.spec);
  return preset ? `${preset.name.zh} · ${preset.desc.zh}` : "Aora Bot 角色";
});

function rollAvatar() {
  if (!draft.value) return;
  const resolved = resolveBotAvatar(draft.value.avatar, draft.value.name || "Bot");
  const currentChar = resolved.kind === "aora" ? resolved.spec.character : undefined;
  draft.value.avatar = randomBotAvatar(currentChar);
  previewAvatarRef.value?.bounce(0.85);
}

function onSelectAoraAvatar(nextAvatar: string) {
  if (!draft.value) return;
  draft.value.avatar = nextAvatar;
  previewAvatarRef.value?.bounce(0.75);
}

async function onBotAvatarPick(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file || !draft.value) return;
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
    draft.value.avatar = dataUrl;
  } catch {
    message.error("读取头像失败");
  }
}

function flattenModelOptions(agentId: string): { configId: string; options: { value: string; label: string }[] } {
  const cfg = store.cachedModels[agentId];
  if (!cfg?.options?.length) return { configId: cfg?.id ?? "", options: [] };
  const flat: { value: string; label: string }[] = [];
  for (const item of cfg.options) {
    if ("options" in item && Array.isArray(item.options)) {
      for (const opt of item.options as ConfigSelectOption[]) {
        flat.push({ value: opt.value, label: opt.name || opt.value });
      }
    } else {
      const opt = item as ConfigSelectOption;
      flat.push({ value: opt.value, label: opt.name || opt.value });
    }
  }
  return { configId: cfg.id, options: flat };
}

const modelMeta = computed(() => (draft.value?.agentId ? flattenModelOptions(draft.value.agentId) : { configId: "", options: [] }));
const modelSelectOptions = computed(() => [
  { value: "", label: "跟随 Agent 默认模型" },
  ...modelMeta.value.options,
]);
const probingCurrentModel = computed(() => Boolean(draft.value?.agentId && store.probingModels[draft.value.agentId]));

const permissionPolicy = computed<PermissionPolicy>({
  get() {
    if (!draft.value || draft.value.autoAllow == null) return "inherit";
    return draft.value.autoAllow ? "allow" : "ask";
  },
  set(v: PermissionPolicy) {
    if (!draft.value) return;
    draft.value.autoAllow = v === "inherit" ? null : v === "allow";
  },
});

const advancedSummary = computed(() => {
  if (!draft.value) return "";
  const val = draft.value.modelValue;
  const matched = val ? modelMeta.value.options.find((o) => o.value === val) : null;
  const modelLabel = matched?.label || val || "跟随 Agent 模型";
  const permLabel =
    draft.value.autoAllow === true
      ? "完全权限"
      : draft.value.autoAllow === false
        ? "人工确认"
        : "跟随全局权限";
  return `${modelLabel} · ${permLabel}`;
});

function botAgentName(agentId: string): string {
  return store.agents.find((a) => a.id === agentId)?.name || agentId;
}

function botRunsOf(botId: string): Meta[] {
  return Object.values(store.metas)
    .filter((m) => m.botId === botId)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

function activeRunOf(botId: string): Meta | null {
  for (const m of botRunsOf(botId)) {
    const st = store.lives[m.id]?.status ?? m.status;
    if (st === "running" || st === "connecting") return m;
  }
  return null;
}

function latestRunOf(botId: string): Meta | null {
  return botRunsOf(botId)[0] ?? null;
}

async function openRun(m: Meta) {
  emit("update:open", false);
  await select(m.id);
}

function startCreate(fromList = false) {
  const agentId = pickDefaultAgentId();
  if (fromList) {
    openedAsCreate.value = false;
    prevSelectedId.value = selectedId.value;
  }
  creating.value = true;
  selectedId.value = null;
  avatarPickerOpen.value = false;
  draft.value = {
    id: "",
    name: "",
    avatar: randomBotAvatar(),
    agentId,
    modelConfigId: "",
    modelValue: "",
    schedule: "",
    prompt: "",
    enabled: true,
    autoAllow: true, // default: full permission
  };
  draftSoul.value = "";
  draftMemory.value = DEFAULT_MEMORY;
  botFiles.value = null;
  origSnapshot.value = "";
  if (agentId) void probeModels(agentId, "");
}

async function selectBot(bot: Bot, initialTab: EditDocTab = "soul") {
  creating.value = false;
  selectedId.value = bot.id;
  avatarPickerOpen.value = false;
  draft.value = JSON.parse(JSON.stringify(bot)) as Bot;
  botFiles.value = null;
  draftSoul.value = "";
  draftMemory.value = "";
  editDocTab.value = initialTab;
  origSnapshot.value = makeSnapshot();
  if (bot.agentId) void probeModels(bot.agentId, "");
  await reloadBotFiles(bot.id);
}

async function reloadBotFiles(botId: string) {
  if (!botId) return;
  loadingFiles.value = true;
  try {
    const f = await api.getBotFiles(botId);
    // Ignore stale response if user switched to another bot mid-load
    if (selectedId.value !== botId || creating.value) return;
    botFiles.value = f;
    draftSoul.value = f.soul;
    draftMemory.value = f.memory;
    origSnapshot.value = makeSnapshot();
  } catch (e) {
    message.error(e instanceof Error ? e.message : String(e));
  } finally {
    loadingFiles.value = false;
  }
}

function resetEdits() {
  if (!selectedId.value) return;
  const current = bots.value.find((b) => b.id === selectedId.value);
  if (current) void selectBot(current, editDocTab.value);
}

function cancelCreate() {
  if (!openedAsCreate.value && bots.value.length > 0) {
    const back = bots.value.find((b) => b.id === prevSelectedId.value) ?? bots.value[0];
    void selectBot(back);
  } else {
    emit("update:open", false);
  }
}

function onPickModel(value: string) {
  if (!draft.value) return;
  if (!value) {
    draft.value.modelConfigId = "";
    draft.value.modelValue = "";
  } else {
    draft.value.modelConfigId = modelMeta.value.configId || "model";
    draft.value.modelValue = value;
  }
}

async function saveDraft(openAfterCreate = false): Promise<boolean> {
  if (!draft.value || savingBot.value) return false;
  const name = draft.value.name.trim();
  if (!name) {
    message.warning("请先给 Bot 起个名字");
    return false;
  }
  if (!draft.value.agentId) {
    message.warning("请选择默认 Agent");
    return false;
  }

  savingBot.value = true;
  const isNew = creating.value;
  try {
    const entry: Bot = {
      ...draft.value,
      name,
      avatar: (draft.value.avatar ?? "").trim() || makeBotAvatar(name),
    };
    const prevIds = new Set(bots.value.map((b) => b.id));
    const nextBots = isNew
      ? [...bots.value, entry]
      : bots.value.map((b) => (b.id === entry.id ? entry : b));
    await saveSettings({ bots: nextBots });
    const savedList = store.settings?.bots ?? [];
    const savedBot = isNew
      ? savedList.find((b) => !prevIds.has(b.id)) ?? savedList[savedList.length - 1]
      : savedList.find((b) => b.id === entry.id);

    if (savedBot) {
      const soulText =
        draftSoul.value.trim() ||
        `# ${name}\n\n你是拥有独立长期记忆（MEMORY.md）的常驻 Bot。用户在对话中交代的项目、偏好与结论请及时沉淀到 MEMORY.md，高风险操作前先确认。\n`;
      const memText = isNew ? DEFAULT_MEMORY : draftMemory.value;
      const savedFiles = await api.saveBotFiles(savedBot.id, soulText, memText);

      if (isNew && openAfterCreate) {
        selectedId.value = savedBot.id;
        creating.value = false;
        emit("update:open", false);
        await openBotChat(savedBot.id);
        message.success(`已创建并打开「${name}」`);
        return true;
      }

      creating.value = false;
      selectedId.value = savedBot.id;
      draft.value = JSON.parse(JSON.stringify(savedBot)) as Bot;
      botFiles.value = savedFiles;
      draftSoul.value = savedFiles.soul;
      draftMemory.value = savedFiles.memory;
      origSnapshot.value = makeSnapshot();
    }

    message.success(isNew ? `Bot「${name}」已创建` : "已保存");
    return true;
  } catch (e) {
    message.error(e instanceof Error ? e.message : String(e));
    return false;
  } finally {
    savingBot.value = false;
  }
}

async function confirmDelete() {
  const target = deleteTarget.value;
  deleteTarget.value = null;
  if (!target) return;
  try {
    const next = bots.value.filter((b) => b.id !== target.id);
    await saveSettings({ bots: next });
    message.success(`已移除「${target.name}」（记忆文件已保留在本地）`);
    if (next.length > 0) {
      void selectBot(next[0]);
    } else {
      openedAsCreate.value = true;
      startCreate();
    }
  } catch (e) {
    message.error(e instanceof Error ? e.message : String(e));
  }
}

async function chatWithSelected() {
  if (!selectedId.value || openingChat.value) return;
  openingChat.value = true;
  try {
    if (isDirty.value) {
      const ok = await saveDraft(false);
      if (!ok) return;
    }
    emit("update:open", false);
    await openBotChat(selectedId.value);
  } catch (e) {
    message.error(e instanceof Error ? e.message : String(e));
  } finally {
    openingChat.value = false;
  }
}

async function revealBotDir() {
  if (!botFiles.value?.dir) return;
  try {
    await api.reveal(botFiles.value.dir);
  } catch (e) {
    message.error(e instanceof Error ? e.message : String(e));
  }
}
</script>

<template>
  <Modal
    :open="props.open"
    :width="creating ? 540 : 780"
    :footer="null"
    :closable="false"
    wrap-class-name="oc-settings-modal"
    centered
    @cancel="emit('update:open', false)"
  >
    <div
      class="flex w-full overflow-hidden"
      :class="creating ? 'max-h-[min(82dvh,640px)]' : 'h-[min(76dvh,600px)] min-h-[470px]'"
    >
      <!-- Left Bots Rail (only shown when viewing/managing existing Bots) -->
      <aside
        v-if="!creating"
        class="w-[204px] flex-none bg-hover border-0 border-r border-solid border-line flex flex-col p-2.5 select-none"
      >
        <nav class="flex-1 min-h-0 overflow-y-auto flex flex-col gap-1" aria-label="Bot 列表">
          <button
            v-for="b in bots"
            :key="b.id"
            type="button"
            class="w-full px-2 py-2 border-0 rounded-[9px] flex items-center gap-2.5 text-left cursor-pointer transition-all duration-140"
            :class="
              selectedId === b.id
                ? 'bg-modal text-ink shadow-card'
                : 'bg-transparent text-ink-2 hover:bg-active hover:text-ink'
            "
            :aria-current="selectedId === b.id ? 'page' : undefined"
            @click="selectBot(b)"
          >
            <div class="relative flex-none">
              <BotAvatar
                :avatar="b.avatar"
                :name="b.name"
                :size="28"
                :state="activeRunOf(b.id) ? 'working' : 'idle'"
                class="rounded-full"
              />
              <span
                v-if="activeRunOf(b.id)"
                class="absolute -right-0.5 -bottom-0.5 w-2.5 h-2.5 rounded-full bg-ok border-2 border-solid border-modal"
                title="运行中"
              />
            </div>
            <div class="min-w-0 flex-1">
              <div class="text-[12.5px] truncate" :class="selectedId === b.id ? 'fw-580 text-ink' : 'fw-520'">
                {{ b.name }}
              </div>
              <div class="text-[11px] text-ink-3 truncate mt-[1px]">{{ botAgentName(b.agentId) }}</div>
            </div>
          </button>
        </nav>

        <div class="pt-2.5 mt-2 border-0 border-t border-solid border-line">
          <button
            type="button"
            class="w-full h-[30px] px-2.5 rounded-[8px] border border-solid border-line bg-modal/70 text-ink-2 text-[12px] fw-530 flex items-center justify-center gap-1.5 cursor-pointer transition-colors hover:bg-modal hover:border-line-strong hover:text-ink"
            @click="startCreate(true)"
          >
            <PlusOutlined class="text-[11px]" />
            <span>新建 Bot</span>
          </button>
        </div>
      </aside>

      <!-- Right Detail / Standalone Create Pane -->
      <div class="flex-1 min-w-0 flex flex-col bg-modal">
        <!-- Pane Header -->
        <header class="flex-none h-[54px] px-5 border-0 border-b border-solid border-line flex items-center justify-between gap-3">
          <div class="min-w-0 flex items-center gap-2.5">
            <template v-if="creating">
              <button
                v-if="!openedAsCreate && bots.length > 0"
                type="button"
                class="inline-grid place-items-center w-7 h-7 -ml-1 border-0 rounded-[7px] bg-transparent text-ink-2 cursor-pointer flex-none transition-colors hover:bg-hover hover:text-ink"
                aria-label="返回 Bot 列表"
                @click="cancelCreate"
              >
                <ArrowLeftOutlined class="text-[12.5px]" />
              </button>
              <div class="min-w-0">
                <div class="text-[14px] font-semibold text-ink leading-tight">新建 Bot</div>
                <div class="text-[11.5px] text-ink-3 mt-[1px]">配置头像、名称、职责与默认 Agent</div>
              </div>
            </template>
            <template v-else-if="draft">
              <BotAvatar :avatar="draft.avatar" :name="draft.name" :size="26" class="rounded-full flex-none" />
              <div class="min-w-0">
                <div class="flex items-center gap-2">
                  <span class="text-[14px] font-semibold text-ink truncate">{{ draft.name || "Bot" }}</span>
                  <span
                    v-if="isDirty"
                    class="inline-flex items-center gap-1 text-[11px] text-warn flex-none"
                  >
                    <i class="w-1.5 h-1.5 rounded-full bg-warn" /> 未保存
                  </span>
                </div>
                <div class="flex items-center gap-1.5 text-[11.5px] text-ink-3 mt-[1px]">
                  <span>{{ botAgentName(draft.agentId) }}</span>
                  <template v-if="selectedId && latestRunOf(selectedId)">
                    <span>·</span>
                    <button
                      type="button"
                      class="border-0 bg-transparent p-0 text-ink-2 text-[11.5px] cursor-pointer hover:text-ink hover:underline underline-offset-2"
                      @click="openRun(latestRunOf(selectedId!)!)"
                    >
                      最近会话 ({{ botRunsOf(selectedId).length }})
                    </button>
                  </template>
                </div>
              </div>
            </template>
          </div>

          <div class="flex items-center gap-1.5 flex-none">
            <template v-if="!creating && draft">
              <Button size="small" type="primary" :loading="openingChat" @click="chatWithSelected">
                <template #icon><MessageOutlined /></template>
                对话
              </Button>
              <Tooltip title="删除 Bot">
                <button
                  type="button"
                  class="inline-grid place-items-center w-7 h-7 border-0 rounded-[7px] bg-transparent text-ink-3 cursor-pointer transition-colors hover:bg-err-soft hover:text-err"
                  aria-label="删除 Bot"
                  @click="deleteTarget = draft"
                >
                  <DeleteOutlined class="text-[13px]" />
                </button>
              </Tooltip>
            </template>
            <button
              type="button"
              class="inline-grid place-items-center w-7 h-7 border-0 rounded-[7px] bg-transparent text-ink-3 cursor-pointer flex-none transition-colors hover:bg-hover hover:text-ink"
              aria-label="关闭"
              @click="emit('update:open', false)"
            >
              <CloseOutlined class="text-[12.5px]" />
            </button>
          </div>
        </header>

        <!-- Scrollable Form Body -->
        <div v-if="draft" class="flex-1 min-h-0 overflow-y-auto px-5 py-4 flex flex-col gap-4">
          <!-- Avatar + Name -->
          <div class="flex items-center gap-4">
            <div class="relative flex-none">
              <Popover
                v-model:open="avatarPickerOpen"
                trigger="click"
                placement="bottomLeft"
                :arrow="false"
              >
                <template #content>
                  <BotAvatarPicker
                    :avatar="draft.avatar"
                    :name="draft.name || 'Bot'"
                    @select="onSelectAoraAvatar"
                    @upload="
                      avatarPickerOpen = false;
                      avatarInputRef?.click();
                    "
                  />
                </template>
                <Tooltip title="点击定制角色外观（71 角色 / 配色 / 脸型 / 画风）" :mouse-enter-delay="0.35">
                  <button
                    type="button"
                    class="relative w-[64px] h-[64px] rounded-full border-0 bg-transparent inline-flex items-center justify-center cursor-pointer overflow-visible transition-transform duration-150 p-0 hover:scale-[1.03]"
                    aria-label="定制 Bot 头像"
                  >
                    <BotAvatar
                      ref="previewAvatarRef"
                      :avatar="draft.avatar"
                      :name="draft.name || 'Bot'"
                      :size="64"
                      :state="creating ? 'happy' : 'idle'"
                      animated
                      interactive
                    />
                  </button>
                </Tooltip>
              </Popover>
            </div>

            <div class="flex-1 min-w-0 flex flex-col gap-1.5">
              <label class="text-[12px] fw-550 text-ink-2">
                名称 <span class="text-err">*</span>
              </label>
              <Input
                v-model:value="draft.name"
                placeholder="给 Bot 起个名字，如：bug排查、代码审查…"
                class="!text-[14px] fw-560"
              />
              <div class="flex items-center gap-2 text-[11px] text-ink-3 min-w-0">
                <span class="truncate flex-1 min-w-0">{{ draftAvatarSummary }}</span>
                <button
                  type="button"
                  class="inline-flex items-center gap-1 h-[22px] px-1.5 rounded-[6px] border-0 bg-transparent text-[11px] text-ink-2 cursor-pointer flex-none transition-colors hover:bg-hover hover:text-ink active:scale-95"
                  aria-label="随机换一个角色"
                  @click="rollAvatar"
                >
                  <SyncOutlined class="text-[11px]" />
                  <span>随机</span>
                </button>
                <button
                  type="button"
                  class="inline-flex items-center gap-1 h-[22px] px-1.5 rounded-[6px] border-0 bg-transparent text-[11px] text-ink-2 cursor-pointer flex-none transition-colors hover:bg-hover hover:text-ink"
                  @click="avatarPickerOpen = !avatarPickerOpen"
                >
                  <SmileOutlined class="text-[11px]" />
                  <span>定制</span>
                </button>
                <button
                  type="button"
                  class="inline-flex items-center gap-1 h-[22px] px-1.5 rounded-[6px] border-0 bg-transparent text-[11px] text-ink-2 cursor-pointer flex-none transition-colors hover:bg-hover hover:text-ink"
                  @click="avatarInputRef?.click()"
                >
                  <UploadOutlined class="text-[11px]" />
                  <span>上传</span>
                </button>
              </div>
            </div>
          </div>

          <!-- Default Agent -->
          <div class="flex flex-col gap-2">
            <label class="text-[12.5px] fw-560 text-ink">
              默认 Agent <span class="text-err">*</span>
            </label>
            <div class="flex flex-wrap gap-1.5">
              <button
                v-for="a in enabledAgents"
                :key="a.id"
                type="button"
                class="inline-flex items-center gap-1.5 h-[30px] px-2.5 rounded-[8px] border border-solid text-[12px] cursor-pointer transition-all duration-130"
                :class="
                  draft.agentId === a.id
                    ? 'border-ink-solid bg-active text-ink fw-580 shadow-card'
                    : a.available
                      ? 'border-line bg-hover text-ink-2 hover:border-line-strong hover:text-ink'
                      : 'border-dashed border-line bg-transparent text-ink-3 opacity-60 hover:opacity-100'
                "
                @click="draft.agentId = a.id"
              >
                <ProviderIcon :id="a.id" :name="a.name" :size="14" />
                <span>{{ a.name }}</span>
                <span v-if="!a.available" class="text-[10.5px] text-ink-3">未安装</span>
              </button>
            </div>
          </div>

          <!-- Create: Role & Responsibilities -->
          <div v-if="creating" class="flex flex-col gap-1.5">
            <label class="text-[12.5px] fw-560 text-ink">角色与职责</label>
            <Input.TextArea
              v-model:value="draftSoul"
              :auto-size="{ minRows: 4, maxRows: 7 }"
              placeholder="描述这个 Bot 的角色、擅长什么、以及边界要求（可留空，后续随时调整）"
            />
          </div>

          <!-- Detail/Edit: SOUL.md & MEMORY.md -->
          <div v-else class="flex flex-col gap-1.5">
            <div class="flex items-center justify-between gap-2">
              <div class="inline-flex items-center gap-[2px] p-[2px] rounded-[8px] bg-hover border border-solid border-line">
                <button
                  type="button"
                  class="h-[24px] px-2.5 border-0 rounded-[6px] text-[11.5px] cursor-pointer transition-colors"
                  :class="editDocTab === 'soul' ? 'bg-ink-solid text-ink-inv fw-560' : 'bg-transparent text-ink-2 hover:text-ink'"
                  @click="editDocTab = 'soul'"
                >
                  角色与职责 (SOUL.md)
                </button>
                <button
                  type="button"
                  class="h-[24px] px-2.5 border-0 rounded-[6px] text-[11.5px] cursor-pointer transition-colors"
                  :class="editDocTab === 'memory' ? 'bg-ink-solid text-ink-inv fw-560' : 'bg-transparent text-ink-2 hover:text-ink'"
                  @click="editDocTab = 'memory'"
                >
                  长期记忆 (MEMORY.md)
                </button>
              </div>

              <div v-if="botFiles" class="flex items-center gap-1 flex-none">
                <Tooltip title="从磁盘重新读取">
                  <button
                    type="button"
                    class="inline-flex items-center gap-1 border-0 bg-transparent text-ink-3 text-[11px] cursor-pointer px-1.5 py-0.5 rounded hover:bg-hover hover:text-ink"
                    :disabled="loadingFiles"
                    @click="reloadBotFiles(botFiles.botId)"
                  >
                    <ReloadOutlined :spin="loadingFiles" /> 刷新
                  </button>
                </Tooltip>
                <Tooltip v-if="inApp" :title="botFiles.dir">
                  <button
                    type="button"
                    class="inline-flex items-center gap-1 border-0 bg-transparent text-ink-3 text-[11px] cursor-pointer px-1.5 py-0.5 rounded hover:bg-hover hover:text-ink"
                    @click="revealBotDir"
                  >
                    <FolderOpenOutlined /> 打开目录
                  </button>
                </Tooltip>
              </div>
            </div>

            <Input.TextArea
              v-if="editDocTab === 'soul'"
              v-model:value="draftSoul"
              class="font-mono text-[12px]"
              :disabled="loadingFiles"
              :auto-size="{ minRows: 5, maxRows: 9 }"
              placeholder="角色职责、边界与审批原则…"
            />
            <Input.TextArea
              v-else
              v-model:value="draftMemory"
              class="font-mono text-[12px]"
              :disabled="loadingFiles"
              :auto-size="{ minRows: 5, maxRows: 9 }"
              placeholder="跨会话保留的项目路径、偏好与结论…"
            />
          </div>

          <!-- Advanced Settings (collapsed by default: Model + Permission, defaults to Agent default + Full permission) -->
          <details class="oc-disclosure rounded-[10px] border border-solid border-line bg-hover px-3 py-2.5">
            <summary class="text-[12px] text-ink-2">
              <DownOutlined class="oc-disclosure-chevron text-[10px] text-ink-3 flex-none" />
              <span class="fw-550">高级配置</span>
              <span class="text-[11px] text-ink-3 ml-1.5 truncate">{{ advancedSummary }}</span>
            </summary>

            <div class="pt-3 mt-2.5 border-0 border-t border-solid border-line flex flex-col gap-3">
              <div class="flex items-center justify-between gap-3">
                <div class="flex items-center gap-1.5 flex-none">
                  <span class="text-[12px] text-ink-2">默认模型</span>
                  <Tooltip title="重新检测模型列表">
                    <button
                      v-if="draft.agentId"
                      type="button"
                      class="inline-flex items-center gap-1 border-0 bg-transparent text-ink-3 text-[11px] cursor-pointer px-1 rounded hover:text-ink"
                      :disabled="probingCurrentModel"
                      @click="probeModels(draft.agentId, '', true)"
                    >
                      <ReloadOutlined :spin="probingCurrentModel" />
                    </button>
                  </Tooltip>
                </div>
                <Select
                  :value="draft.modelValue || ''"
                  size="small"
                  class="w-[240px]"
                  :options="modelSelectOptions"
                  placeholder="跟随 Agent 默认模型"
                  @change="(v: unknown) => onPickModel(String(v ?? ''))"
                />
              </div>

              <div class="flex items-center justify-between gap-2">
                <span class="text-[12px] text-ink-2">权限模式</span>
                <div class="inline-flex items-center gap-[2px] p-[2px] rounded-[7px] bg-modal border border-solid border-line-strong">
                  <button
                    v-for="opt in [
                      { value: 'allow', label: '完全权限' },
                      { value: 'ask', label: '人工确认' },
                      { value: 'inherit', label: '跟随全局' },
                    ]"
                    :key="opt.value"
                    type="button"
                    class="h-[23px] px-2.5 border-0 rounded-[5px] text-[11.5px] cursor-pointer whitespace-nowrap transition-colors"
                    :class="
                      permissionPolicy === opt.value
                        ? 'bg-ink-solid text-ink-inv fw-560'
                        : 'bg-transparent text-ink-2 hover:text-ink'
                    "
                    @click="permissionPolicy = opt.value as PermissionPolicy"
                  >
                    {{ opt.label }}
                  </button>
                </div>
              </div>
            </div>
          </details>
        </div>

        <!-- Single Footer -->
        <footer
          v-if="creating"
          class="flex-none px-5 py-3 border-0 border-t border-solid border-line flex items-center justify-between gap-2 bg-modal"
        >
          <Button size="small" @click="cancelCreate">{{ !openedAsCreate && bots.length > 0 ? "返回" : "取消" }}</Button>
          <div class="flex items-center gap-2 flex-none">
            <Button size="small" :loading="savingBot" @click="saveDraft(false)">仅创建</Button>
            <Button size="small" type="primary" :loading="savingBot" @click="saveDraft(true)">
              <template #icon><MessageOutlined /></template>
              创建并对话
            </Button>
          </div>
        </footer>

        <footer
          v-else-if="draft"
          class="flex-none px-5 py-3 border-0 border-t border-solid border-line flex items-center justify-between gap-2 bg-modal"
        >
          <span class="text-[11.5px] text-ink-3 truncate">SOUL.md 与 MEMORY.md 保存在本地 Bot 目录</span>
          <div class="flex items-center gap-2 flex-none">
            <Button v-if="isDirty" size="small" @click="resetEdits">重置</Button>
            <Button size="small" type="primary" :loading="savingBot" :disabled="!isDirty" @click="saveDraft(false)">
              保存更改
            </Button>
          </div>
        </footer>
      </div>
    </div>
  </Modal>

  <input
    ref="avatarInputRef"
    type="file"
    accept="image/*"
    class="hidden"
    @change="onBotAvatarPick"
  />

  <!-- Delete Confirm Modal -->
  <Modal
    :open="Boolean(deleteTarget)"
    :title="`删除 Bot「${deleteTarget?.name ?? ''}」？`"
    :width="380"
    centered
    ok-text="确认删除"
    ok-type="danger"
    cancel-text="取消"
    @ok="confirmDelete"
    @cancel="deleteTarget = null"
  >
    <p class="text-ink-2 m-0 text-[13px]">
      将移除此 Bot 配置。历史对话与磁盘上的 SOUL.md / MEMORY.md 不会被删除。
    </p>
  </Modal>
</template>

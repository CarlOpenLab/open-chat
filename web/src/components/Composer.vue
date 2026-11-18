<script setup lang="ts">
import { Sender } from "@antdv-next/x";
import type { SenderPasteInfo } from "@antdv-next/x";
import {
  CloseOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  PaperClipOutlined,
  PauseOutlined,
  ThunderboltOutlined,
} from "@antdv-next/icons";
import { Select, Tooltip } from "antdv-next";
import { computed, ref, watch } from "vue";
import { store } from "../store";
import type { Block, ConfigOption, LiveState } from "../types";

const props = defineProps<{
  value: string;
  live: LiveState;
  agentName: string;
  cwd: string;
  sending: boolean;
  disabled?: boolean;
  placeholder?: string;
  /** Chips shown under the input; the new-chat screen swaps them for pickers. */
  compact?: boolean;
}>();

const emit = defineEmits<{
  "update:value": [value: string];
  send: [blocks: Block[]];
  stop: [];
  "pick-model": [configId: string, value: string];
  "pick-mode": [modeId: string];
  cwd: [];
  agent: [];
}>();

const attached = ref<Block[]>([]);
const inputFiles = ref<HTMLInputElement | null>(null);

const draft = computed({
  get: () => props.value,
  set: (v: string) => emit("update:value", v),
});

const running = computed(() => props.live.status === "running");
const sendKey = computed(() => (localStorage.getItem("oc.sendKey") === "modEnter" ? "shiftEnter" : "enter"));

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
const effortOption = computed<ConfigOption | null>(() => {
  const opts = props.live.configOptions ?? [];
  return opts.find((o) => o.category === "thought_level") ?? null;
});

/** Some agents expose the session mode only as a config option, not as `modes`. */
const modeConfig = computed<ConfigOption | null>(() => {
  if (props.live.modes) return null;
  return (props.live.configOptions ?? []).find((o) => o.category === "mode") ?? null;
});

function selectOptions(o: ConfigOption) {
  const list = o.options ?? [];
  const flat = Array.isArray(list) && list.length && "group" in (list[0] as object)
    ? (list as { group: string; name: string; options: { value: string; name: string }[] }[]).flatMap((g) =>
        g.options.map((x) => ({ label: `${g.name} · ${x.name}`, value: x.value })),
      )
    : (list as { value: string; name: string }[]).map((x) => ({ label: x.name, value: x.value }));
  return flat;
}

const modes = computed(() => props.live.modes?.availableModes ?? []);
const modeName = computed(() => {
  const cur = props.live.modes?.currentModeId;
  return modes.value.find((m) => m.id === cur)?.name ?? "";
});

const canSend = computed(() => !props.disabled && (props.value.trim().length > 0 || attached.value.length > 0));

/** The folder's own name, with `~` for the home directory. */
const cwdLabel = computed(() => {
  const home = store.boot?.home;
  if (home && props.cwd === home) return "~";
  return props.cwd.split("/").filter(Boolean).pop() || props.cwd;
});

function submit() {
  if (!canSend.value || running.value) return;
  const blocks: Block[] = [];
  const text = props.value.trim();
  if (text) blocks.push({ type: "text", text });
  for (const a of attached.value) blocks.push(a);
  emit("send", blocks);
  attached.value = [];
}

function onKeydown(e: KeyboardEvent): void | false {
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

function removeAt(i: number) {
  attached.value.splice(i, 1);
}

defineExpose({ addFiles });
</script>

<template>
  <div class="composer-wrap">
    <Transition name="pop">
      <div v-if="slashOpen && !slashDismissed" class="slash">
        <div class="slash-hint">命令</div>
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

    <div class="composer" :class="{ busy: running }">
      <div v-if="attached.length" class="chips">
        <span v-for="(a, i) in attached" :key="i" class="chip">
          <img v-if="a.type === 'image'" :src="`data:${a.mimeType};base64,${a.data}`" alt="" />
          <FileTextOutlined v-else />
          <span class="chip-name">{{ a.type === "image" ? "图片" : (a as { name: string }).name }}</span>
          <button class="chip-x" @click="removeAt(i)"><CloseOutlined /></button>
        </span>
      </div>

      <Sender
        v-model:value="draft"
        :loading="running"
        :disabled="disabled"
        :submit-type="sendKey"
        :auto-size="{ minRows: 1, maxRows: 10 }"
        :placeholder="placeholder ?? '说说你想让它做什么…'"
        :on-key-down="onKeydown"
        :on-paste-file="onPasteFile"
        :on-paste="onPaste"
        :on-submit="submit"
        :on-cancel="() => emit('stop')"
        class="sender"
      >
        <template #prefix>
          <div class="pre">
            <Tooltip title="添加图片或文件" :mouse-enter-delay="0.3">
              <button class="mini" @click="inputFiles?.click()"><PaperClipOutlined /></button>
            </Tooltip>
          </div>
        </template>
        <template #footer>
          <div class="bar">
            <Tooltip v-if="!compact" :title="`切换工作目录：${cwd}`" placement="top" :mouse-enter-delay="0.3">
              <button class="pill mono" @click="emit('cwd')">
                <FolderOpenOutlined />
                <span class="ellip">{{ cwdLabel }}</span>
              </button>
            </Tooltip>
            <button v-if="compact" class="pill" @click="emit('agent')">
              <ThunderboltOutlined />
              <span>{{ agentName }}</span>
            </button>

            <Select
              v-if="!compact && modelOption"
              :value="String(modelOption.currentValue)"
              :options="selectOptions(modelOption)"
              size="small"
              variant="borderless"
              class="sel"
              :popup-match-select-width="false"
              @change="(v: string) => emit('pick-model', modelOption!.id, v)"
            />
            <Select
              v-if="!compact && effortOption"
              :value="String(effortOption.currentValue)"
              :options="selectOptions(effortOption)"
              size="small"
              variant="borderless"
              class="sel"
              :popup-match-select-width="false"
              @change="(v: string) => emit('pick-model', effortOption!.id, v)"
            />
            <Select
              v-if="!compact && modes.length > 1"
              :value="live.modes?.currentModeId"
              :options="modes.map((m) => ({ label: m.name, value: m.id, title: m.description }))"
              size="small"
              variant="borderless"
              class="sel"
              :popup-match-select-width="false"
              @change="(v: string) => emit('pick-mode', v)"
            />
            <Select
              v-else-if="!compact && modeConfig && selectOptions(modeConfig).length > 1"
              :value="String(modeConfig.currentValue)"
              :options="selectOptions(modeConfig)"
              size="small"
              variant="borderless"
              class="sel"
              :popup-match-select-width="false"
              @change="(v: string) => emit('pick-model', modeConfig!.id, v)"
            />
            <span class="grow" />
            <span v-if="running" class="stop-hint">
              <PauseOutlined /> 生成中…
            </span>
            <span v-else class="kbd-hint">
              <kbd>{{ sendKey === "enter" ? "⏎" : "⇧⏎" }}</kbd>
              <span>发送</span>
            </span>
          </div>
        </template>
      </Sender>
    </div>

    <input ref="inputFiles" type="file" multiple hidden @change="(e) => addFiles((e.target as HTMLInputElement).files!)" />
  </div>
</template>

<style scoped>
.composer-wrap {
  position: relative;
  width: 100%;
}

.composer {
  border: 1px solid var(--border);
  background: var(--surface);
  border-radius: 16px;
  box-shadow: var(--shadow-composer);
  transition: border-color 0.18s var(--ease), box-shadow 0.18s var(--ease);
  overflow: hidden;
}
.composer:focus-within {
  border-color: color-mix(in srgb, var(--accent) 40%, var(--border));
  box-shadow: var(--shadow-composer), 0 0 0 3px var(--accent-soft);
}
.composer.busy {
  border-color: color-mix(in srgb, var(--accent) 28%, var(--border));
}

.sender {
  background: transparent !important;
}
.sender :deep(.antd-sender-content) {
  padding: 10px 10px 0 !important;
}
.sender :deep(textarea),
.sender :deep(.ant-input) {
  font-size: 14.5px !important;
  line-height: 1.6 !important;
  padding: 1px 4px 5px !important;
}
.sender :deep(.antd-sender-footer) {
  padding: 0 8px 8px !important;
}
.sender :deep(.antd-sender-input) {
  background: transparent !important;
  border: none !important;
  box-shadow: none !important;
}

.pre {
  display: flex;
  align-items: center;
  padding-left: 8px;
  padding-bottom: 2px;
}
.mini {
  display: inline-grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--text-3);
  cursor: pointer;
  font-size: 14px;
}
.mini:hover {
  background: var(--hover);
  color: var(--text);
}

.bar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 10px 9px 10px;
  min-height: 32px;
}
.pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: 210px;
  height: 24px;
  padding: 0 8px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--text-3);
  font-size: 12px;
  cursor: pointer;
}
.pill:hover {
  background: var(--hover);
  color: var(--text-2);
}
.ellip {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sel {
  font-size: 12px;
  max-width: 172px;
}
.sel :deep(.ant-select-selection-item) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sel :deep(.ant-select-selector) {
  padding: 0 6px !important;
  height: 24px !important;
  color: var(--text-3) !important;
  font-size: 12px;
}
.sel :deep(.ant-select-selection-item) {
  line-height: 24px !important;
  font-size: 12px;
}
.grow {
  flex: 1;
}
.kbd-hint {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: var(--text-3);
  margin-right: 4px;
  opacity: 0;
  transition: opacity 0.15s;
}
.composer:focus-within .kbd-hint {
  opacity: 1;
}
.stop-hint {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: var(--accent-text);
  margin-right: 6px;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 10px 12px 0;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  padding: 0 4px 0 6px;
  border-radius: 7px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  font-size: 11.5px;
  color: var(--text-2);
}
.chip img {
  width: 18px;
  height: 18px;
  object-fit: cover;
  border-radius: 4px;
}
.chip-name {
  max-width: 130px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.chip-x {
  display: inline-grid;
  place-items: center;
  width: 16px;
  height: 16px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--text-3);
  font-size: 9px;
  cursor: pointer;
}
.chip-x:hover {
  background: var(--hover);
  color: var(--text);
}

.slash {
  position: absolute;
  left: 8px;
  right: 8px;
  bottom: calc(100% - 6px);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: var(--shadow-pop);
  padding: 5px;
  z-index: 30;
  max-height: 260px;
  overflow-y: auto;
}
.slash-hint {
  font-size: 10.5px;
  color: var(--text-3);
  padding: 4px 8px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.slash-item {
  display: flex;
  align-items: baseline;
  gap: 10px;
  width: 100%;
  border: none;
  background: transparent;
  border-radius: 7px;
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

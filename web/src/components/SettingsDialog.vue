<script setup lang="ts">
import {
  CheckCircleFilled,
  CloseCircleFilled,
  DeleteOutlined,
  PlusOutlined,
  ReloadOutlined,
} from "@antdv-next/icons";
import { Button, Input, Modal, Segmented, Switch, Tabs, Tag, Tooltip, message } from "antdv-next";
import { computed, ref, watch } from "vue";
import { refreshAgents, saveSettings, store } from "../store";
import type { CustomAgent, Settings } from "../types";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ "update:open": [boolean] }>();

const tab = ref("general");
const local = ref<Settings | null>(null);
const saving = ref(false);

watch(
  () => props.open,
  (open) => {
    if (open && store.settings) {
      local.value = JSON.parse(JSON.stringify(store.settings)) as Settings;
      local.value.customAgents = local.value.customAgents ?? [];
      local.value.recentDirs = local.value.recentDirs ?? [];
      void refreshAgents();
    }
  },
);

const agents = computed(() => store.agents);

async function save() {
  if (!local.value) return;
  saving.value = true;
  try {
    await saveSettings(local.value);
    message.success("已保存");
  } catch (e) {
    message.error(e instanceof Error ? e.message : String(e));
  } finally {
    saving.value = false;
  }
}

function addCustom() {
  if (!local.value) return;
  const agent: CustomAgent = { id: "", name: "新 agent", command: "", args: [], env: {} };
  local.value.customAgents = [...(local.value.customAgents ?? []), agent];
}

function removeCustom(i: number) {
  local.value?.customAgents?.splice(i, 1);
}

const overrideOf = (id: string) => local.value?.agents?.[id] ?? {};
function setOverride(id: string, patch: Record<string, unknown>) {
  if (!local.value) return;
  local.value.agents = { ...(local.value.agents ?? {}), [id]: { ...(local.value.agents?.[id] ?? {}), ...patch } };
}

const platformName = computed(() => ({ darwin: "macOS", win32: "Windows", linux: "Linux" })[store.boot?.platform ?? ""] ?? store.boot?.platform);
</script>

<template>
  <Modal
    :open="props.open"
    :width="720"
    :footer="null"
    title="设置"
    class="settings-modal"
    @cancel="emit('update:open', false)"
  >
    <Tabs v-model:activeKey="tab" size="small" class="tabs">
      <Tabs.TabPane key="general" tab="常规">
        <div v-if="local" class="pane">
          <section class="row">
            <div class="label">
              <div class="title">外观</div>
              <div class="desc">跟随系统，或固定亮 / 暗</div>
            </div>
            <Segmented
              v-model:value="local.theme"
              :options="[
                { label: '跟随系统', value: 'system' },
                { label: '浅色', value: 'light' },
                { label: '深色', value: 'dark' },
              ]"
            />
          </section>

          <section class="row">
            <div class="label">
              <div class="title">发送消息</div>
              <div class="desc">Enter 发送，还是 ⇧/⌘ + Enter 发送</div>
            </div>
            <Segmented
              v-model:value="local.sendKey"
              :options="[
                { label: 'Enter 发送', value: 'enter' },
                { label: '⇧ Enter 发送', value: 'modEnter' },
              ]"
            />
          </section>

          <section class="row">
            <div class="label">
              <div class="title">自动批准工具调用</div>
              <div class="desc">agent 请求改文件 / 跑命令时不再询问，直接允许一次</div>
            </div>
            <Switch v-model:checked="local.autoAllow" />
          </section>
          <p v-if="local.autoAllow" class="warn-line">
            打开后 agent 会不经确认就修改你的文件、执行命令。只在你信任的目录里这么做。
          </p>

          <section class="row">
            <div class="label">
              <div class="title">Node.js 路径</div>
              <div class="desc">留空则用 PATH 里的 node（需要 22 或更高）</div>
            </div>
            <Input v-model:value="local.nodePath" placeholder="/usr/local/bin/node" class="mono widen" />
          </section>

          <section class="row">
            <div class="label">
              <div class="title">Node 版本</div>
              <div class="desc">{{ store.boot?.nodeError || "检测正常" }}</div>
            </div>
            <span class="mono value">{{ store.boot?.nodeVersion || "—" }}</span>
          </section>
        </div>
      </Tabs.TabPane>

      <Tabs.TabPane key="agents" tab="Agents">
        <div class="pane">
          <p class="hint">
            这里列出所有通过 ACP 驱动的 agent。命令在 PATH 里被找到才可启动；点 <ReloadOutlined /> 重新检测。
            <button class="link" @click="refreshAgents">重新检测</button>
          </p>

          <div v-for="a in agents" :key="a.id" class="agent">
            <div class="agent-head">
              <span class="dot" :class="a.available ? 'ok' : 'off'" />
              <span class="aname">{{ a.name }}</span>
              <Tag v-if="a.demo" color="blue" :bordered="false">演示</Tag>
              <Tag v-else-if="a.custom" :bordered="false">自定义</Tag>
              <span class="cmd mono">{{ a.demo ? "open-chat 内置" : a.resolved || a.command }}</span>
              <span class="spacer" />
              <CheckCircleFilled v-if="a.available" class="ok-i" />
              <Tooltip v-else title="没在 PATH 里找到">
                <CloseCircleFilled class="off-i" />
              </Tooltip>
              <Switch
                v-if="!a.custom"
                size="small"
                :checked="!overrideOf(a.id).disabled"
                @change="(v: unknown) => setOverride(a.id, { disabled: !v })"
              />
            </div>
            <div v-if="!a.custom" class="override">
              <Input
                size="small"
                class="mono"
                placeholder="覆盖启动命令（例如 npx -y @agentclientprotocol/codex-acp）"
                :value="overrideOf(a.id).command ?? ''"
                @change="(e: Event) => setOverride(a.id, { command: (e.target as HTMLInputElement).value, args: [] })"
              />
            </div>
          </div>

          <div class="custom-head">
            <span class="title">自定义 agent</span>
            <Button size="small" @click="addCustom">
              <template #icon><PlusOutlined /></template>
              添加
            </Button>
          </div>
          <div v-for="(c, i) in local?.customAgents ?? []" :key="i" class="custom">
            <Input v-model:value="c.name" placeholder="名字" size="small" style="width: 130px" />
            <Input v-model:value="c.command" placeholder="命令（如 my-agent）" size="small" class="mono" style="flex: 1" />
            <Input
              :value="(c.args ?? []).join(' ')"
              placeholder="参数，空格分隔"
              size="small"
              class="mono"
              style="flex: 1"
              @change="(e: Event) => (c.args = (e.target as HTMLInputElement).value.split(/\s+/).filter(Boolean))"
            />
            <Button size="small" danger @click="removeCustom(i)">
              <template #icon><DeleteOutlined /></template>
            </Button>
          </div>
        </div>
      </Tabs.TabPane>

      <Tabs.TabPane key="about" tab="关于">
        <div class="pane about">
          <div class="logo-lg" />
          <div>
            <div class="about-name">open-chat</div>
            <div class="muted">一个把本机 coding agent 收进同一个窗口的工作台。</div>
          </div>
          <div class="kv">
            <span>版本</span><span class="mono">{{ store.boot?.version }}</span>
            <span>界面</span><span class="mono">{{ store.boot?.mode === "desktop" ? "桌面端（mygo + WebView）" : "网页模式" }}</span>
            <span>系统</span><span class="mono">{{ platformName }}</span>
            <span>Node</span><span class="mono">{{ store.boot?.nodeVersion || "—" }}</span>
            <span>Agent 协议</span><span class="mono">ACP · acp-hub</span>
          </div>
        </div>
      </Tabs.TabPane>
    </Tabs>

    <div class="footer">
      <span class="faint small">
        设置保存在本机 <span class="mono">~/.config/open-chat</span>
      </span>
      <span class="spacer" />
      <Button @click="emit('update:open', false)">关闭</Button>
      <Button type="primary" :loading="saving" @click="save">保存</Button>
    </div>
  </Modal>
</template>

<style scoped>
.pane {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-height: 320px;
  padding-top: 4px;
}
.row {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 11px 2px;
  border-bottom: 1px solid var(--border);
}
.row:last-of-type {
  border-bottom: none;
}
.label {
  flex: 1;
  min-width: 0;
}
.title {
  font-size: 13px;
  font-weight: 500;
}
.desc {
  font-size: 11.5px;
  color: var(--text-3);
  margin-top: 1px;
}
.widen {
  width: 300px;
}
.value {
  font-size: 12px;
  color: var(--text-2);
}
.warn-line {
  font-size: 11.5px;
  color: var(--warn);
  background: var(--warn-soft);
  border-radius: 7px;
  padding: 7px 10px;
  margin: 2px 0 6px;
}
.hint {
  font-size: 12px;
  color: var(--text-3);
  margin: 0 0 6px;
}
.link {
  border: none;
  background: transparent;
  color: var(--accent-text);
  cursor: pointer;
  font-size: inherit;
  padding: 0 2px;
  text-decoration: underline;
  text-underline-offset: 2px;
}
.agent {
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 9px 11px;
  margin-bottom: 7px;
  background: var(--surface);
}
.agent-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex: none;
}
.dot.ok {
  background: var(--ok);
}
.dot.off {
  background: var(--text-3);
  opacity: 0.5;
}
.aname {
  font-size: 13px;
  font-weight: 550;
}
.cmd {
  font-size: 11px;
  color: var(--text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 340px;
}
.spacer {
  flex: 1;
}
.ok-i {
  color: var(--ok);
  font-size: 12px;
}
.off-i {
  color: var(--text-3);
  font-size: 12px;
}
.override {
  margin-top: 8px;
}
.custom-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 14px 0 8px;
}
.custom {
  display: flex;
  gap: 6px;
  margin-bottom: 6px;
}
.about {
  align-items: center;
  text-align: center;
  gap: 14px;
  padding-top: 18px;
}
.logo-lg {
  width: 54px;
  height: 54px;
  border-radius: 16px;
  background: linear-gradient(140deg, #9d9eff, #4545cc);
  box-shadow: 0 10px 28px rgba(91, 91, 214, 0.35);
}
.about-name {
  font-size: 18px;
  font-weight: 650;
  letter-spacing: -0.01em;
}
.kv {
  display: grid;
  grid-template-columns: auto auto;
  gap: 6px 22px;
  margin-top: 8px;
  font-size: 12.5px;
  text-align: left;
  color: var(--text-2);
}
.kv span:nth-child(odd) {
  color: var(--text-3);
}
.footer {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-top: 12px;
  margin-top: 6px;
  border-top: 1px solid var(--border);
}
.small {
  font-size: 11.5px;
}
</style>

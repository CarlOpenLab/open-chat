<script setup lang="ts">
import {
  ArrowDown,
  Bell,
  CloudUpload,
  Database,
  Info,
  Monitor,
  Moon,
  Settings2,
  Sun,
  Trash2,
  X,
} from "@lucide/vue";
import { Button, Modal, Segmented, Switch } from "antdv-next";
import { computed, h, ref, watch } from "vue";
import { APP_VERSION } from "../../version";

type ThemeMode = "system" | "light" | "dark";
type SettingsTab = "general" | "data" | "about";
export type AutoScrollMode = "follow" | "always" | "never";

interface Props {
  open: boolean;
  dark: boolean;
  themeMode: ThemeMode;
  taskCompletionNotificationsEnabled: boolean;
  browserNotificationsSupported: boolean;
  autoScrollMode: AutoScrollMode;
}

interface Emits {
  (e: "update:open", value: boolean): void;
  (e: "themeModeChange", mode: ThemeMode): void;
  (e: "taskCompletionNotificationsChange", enabled: boolean): void;
  (e: "testTaskCompletionNotification"): void;
  (e: "exportHistory"): void;
  (e: "clearHistory"): void;
  (e: "autoScrollModeChange", mode: AutoScrollMode): void;
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

const activeTab = ref<SettingsTab>("general");

const themeModeValue = computed({
  get: () => props.themeMode,
  set: (mode: ThemeMode) => emit("themeModeChange", mode),
});

const taskCompletionNotificationsValue = computed({
  get: () => props.taskCompletionNotificationsEnabled,
  set: (enabled: boolean) => emit("taskCompletionNotificationsChange", enabled),
});

const autoScrollModeValue = computed({
  get: () => props.autoScrollMode,
  set: (mode: AutoScrollMode) => emit("autoScrollModeChange", mode),
});

// @lucide/vue 图标是函数式组件，直接作为 Segmented 的 icon 会被 antdv-next
// 当作普通函数调用导致崩溃（Cannot destructure property 'slots' of undefined）。
// 包一层渲染函数，由 Vue 的 h() 负责创建 vnode。
const themeSegmentedOptions = [
  { label: "跟随系统", value: "system", icon: () => h(Monitor) },
  { label: "浅色", value: "light", icon: () => h(Sun) },
  { label: "深色", value: "dark", icon: () => h(Moon) },
];

const autoScrollSegmentedOptions = [
  { label: "智能跟随", value: "follow" },
  { label: "始终滚动", value: "always" },
  { label: "关闭", value: "never" },
];

watch(
  () => props.open,
  (open) => {
    if (open) activeTab.value = "general";
  },
);

const navItems = [
  { key: "general", label: "常规", description: "外观与主题", icon: Settings2 },
  { key: "data", label: "数据", description: "导出与清理", icon: Database },
  { key: "about", label: "关于", description: "版本信息", icon: Info },
] as const;
</script>

<template>
  <Modal
    :open="open"
    :footer="null"
    :closable="false"
    centered
    :width="800"
    wrap-class-name="settings-dialog-wrap"
    @update:open="emit('update:open', $event)"
  >
    <div class="settings-dialog">
      <header class="settings-dialog-header">
        <div class="flex min-w-0 items-center gap-3">
          <div class="min-w-0">
            <h2 class="m-0 truncate text-[15px] font-720">设置</h2>
          </div>
        </div>
        <button
          type="button"
          class="settings-dialog-close"
          aria-label="关闭设置"
          @click="emit('update:open', false)"
        >
          <X class="!h-[18px] !w-[18px]" />
        </button>
      </header>

      <div class="settings-dialog-body">
        <nav class="settings-nav" aria-label="设置分类">
          <button
            v-for="item in navItems"
            :key="item.key"
            type="button"
            class="settings-nav-item"
            :class="{ 'is-active': activeTab === item.key }"
            :aria-current="activeTab === item.key ? 'page' : undefined"
            @click="activeTab = item.key"
          >
            <span class="settings-nav-icon">
              <component :is="item.icon" class="!h-[15px] !w-[15px]" />
            </span>
            <span class="settings-nav-copy">
              <strong>{{ item.label }}</strong>
              <small>{{ item.description }}</small>
            </span>
          </button>
        </nav>

        <main class="settings-panel">
          <section v-if="activeTab === 'general'" aria-label="常规设置">
            <h3 class="settings-section-title">外观</h3>
            <p class="settings-section-desc">设置工作区的明暗主题。</p>
            <div class="settings-card">
              <div class="settings-row settings-row-wrap">
                <div class="min-w-0">
                  <div class="settings-label">主题模式</div>
                  <p class="settings-hint">跟随系统时会随操作系统的明暗设置自动切换</p>
                </div>
                <Segmented
                  class="theme-segmented"
                  :value="themeModeValue"
                  :options="themeSegmentedOptions"
                  @change="themeModeValue = $event as ThemeMode"
                />
              </div>
            </div>

            <h3 class="settings-section-title settings-section-title-spaced">对话滚动</h3>
            <p class="settings-section-desc">
              输出时是否自动滚动到底部。智能跟随仅在已位于底部时才滚动，避免打断阅读。
            </p>
            <div class="settings-card">
              <div class="settings-row settings-row-wrap">
                <div class="min-w-0">
                  <div class="settings-label settings-label-with-icon">
                    <ArrowDown class="!h-[14px] !w-[14px]" />自动滚动
                  </div>
                  <p class="settings-hint">
                    {{
                      autoScrollModeValue === "follow"
                        ? "已在底部时跟随滚动，阅读上方内容不会被打断"
                        : autoScrollModeValue === "always"
                          ? "输出时始终滚动到底部"
                          : "输出时不自动滚动，需手动点击按钮回到底部"
                    }}
                  </p>
                </div>
                <Segmented
                  :value="autoScrollModeValue"
                  :options="autoScrollSegmentedOptions"
                  @change="autoScrollModeValue = $event as AutoScrollMode"
                />
              </div>
            </div>

            <h3 class="settings-section-title settings-section-title-spaced">通知</h3>
            <p class="settings-section-desc">在任务完成后发送浏览器系统通知。</p>
            <div class="settings-card">
              <div class="settings-row">
                <div class="min-w-0">
                  <div class="settings-label settings-label-with-icon">
                    <Bell class="!h-[14px] !w-[14px]" />任务完成通知
                  </div>
                  <p class="settings-hint">
                    {{
                      browserNotificationsSupported
                        ? taskCompletionNotificationsEnabled
                          ? "浏览器已允许系统通知"
                          : "开启后将请求浏览器通知权限"
                        : "当前浏览器不支持系统通知"
                    }}
                  </p>
                </div>
                <div class="settings-notification-actions">
                  <Button
                    :disabled="
                      !taskCompletionNotificationsEnabled || !browserNotificationsSupported
                    "
                    @click="emit('testTaskCompletionNotification')"
                  >
                    <Bell class="!h-[14px] !w-[14px]" />测试通知
                  </Button>
                  <Switch
                    v-model:checked="taskCompletionNotificationsValue"
                    :disabled="!browserNotificationsSupported"
                    aria-label="任务完成通知"
                  />
                </div>
              </div>
            </div>
          </section>

          <section v-else-if="activeTab === 'data'" aria-label="数据设置">
            <h3 class="settings-section-title">聊天记录</h3>
            <p class="settings-section-desc">
              记录保存在浏览器本地（IndexedDB），不会上传到服务器。
            </p>
            <div class="settings-card">
              <div class="settings-row settings-card-row">
                <div class="min-w-0">
                  <div class="settings-label">导出索引</div>
                  <p class="settings-hint">
                    仅导出会话 id、供应商与会话路径等索引信息，不含消息内容
                  </p>
                </div>
                <Button @click="emit('exportHistory')">
                  <CloudUpload class="!h-[14px] !w-[14px]" />导出
                </Button>
              </div>
              <div class="settings-row settings-card-row">
                <div class="min-w-0">
                  <div class="settings-label text-brand-danger">清空历史</div>
                  <p class="settings-hint">删除本地保存的全部会话与消息，无法恢复</p>
                </div>
                <Button danger @click="emit('clearHistory')">
                  <Trash2 class="!h-[14px] !w-[14px]" />清空历史
                </Button>
              </div>
            </div>
          </section>

          <section v-else aria-label="关于">
            <h3 class="settings-section-title">Open Chat</h3>
            <p class="settings-section-desc">
              通过开放协议连接本地 AI CLI 工具的工作区，基于 <code>@antdv-next/x</code> 构建。
            </p>
            <div class="settings-card">
              <div class="settings-row">
                <div class="settings-label">版本</div>
                <span class="text-[11px] font-650 text-brand-muted-strong">v{{ APP_VERSION }}</span>
              </div>
            </div>
          </section>
        </main>
      </div>
    </div>
  </Modal>
</template>

<style scoped>
/* :global() 覆盖 wrap-class-name 挂载的 antd Modal 结构，保留。
   antdv-next 的容器类是 .ant-modal-container（不是 .ant-modal-content），
   必须置 padding: 0，否则 antd 默认 20px 24px 内边距会让内容悬浮在弹窗中间。 */
:global(.settings-dialog-wrap .ant-modal) {
  max-width: calc(100vw - 32px);
}
:global(.settings-dialog-wrap .ant-modal-container) {
  border: 1px solid var(--brand-border);
  border-radius: 12px;
  padding: 0;
  overflow: hidden;
}

.settings-dialog-header {
  display: flex;
  min-height: 62px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-bottom: 1px solid var(--brand-border);
  padding: 0 24px;
}
.settings-dialog-logo {
  display: grid;
  width: 36px;
  height: 36px;
  flex: 0 0 36px;
  place-items: center;
  border-radius: 8px;
  background: var(--brand-primary);
  color: var(--brand-primary-foreground);
}
.settings-dialog-close {
  display: grid;
  width: 32px;
  height: 32px;
  flex: 0 0 32px;
  place-items: center;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--brand-muted);
  cursor: pointer;
  transition:
    background 140ms ease,
    color 140ms ease;
}
.settings-dialog-close:hover {
  background: var(--brand-surface-subtle);
  color: var(--brand-foreground);
}

.settings-dialog-body {
  display: flex;
  height: min(560px, calc(100dvh - 170px));
  min-height: 320px;
}
.settings-nav {
  display: flex;
  width: 172px;
  flex: 0 0 172px;
  flex-direction: column;
  gap: 4px;
  border-right: 1px solid var(--brand-border);
  background: color-mix(in srgb, var(--brand-surface-subtle) 55%, transparent);
  padding: 16px 12px;
}
.settings-nav-item {
  display: flex;
  width: 100%;
  min-height: 46px;
  align-items: center;
  gap: 10px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  padding: 7px 10px;
  color: var(--brand-muted);
  text-align: left;
  cursor: pointer;
  transition:
    background 140ms ease,
    border-color 140ms ease;
}
.settings-nav-item:hover {
  background: var(--brand-surface-subtle);
  color: var(--brand-foreground);
}
.settings-nav-item.is-active {
  border-color: transparent;
  background: color-mix(in srgb, var(--brand-accent) 10%, var(--brand-surface));
  color: var(--brand-foreground);
}
.settings-nav-icon {
  display: grid;
  width: 28px;
  height: 28px;
  flex: 0 0 28px;
  place-items: center;
  border: 1px solid var(--brand-border);
  border-radius: 6px;
  background: var(--brand-surface);
  color: var(--brand-muted);
}
.settings-nav-item.is-active .settings-nav-icon {
  border-color: transparent;
  background: color-mix(in srgb, var(--brand-accent) 14%, var(--brand-surface));
  color: var(--brand-accent);
}
.settings-nav-copy {
  display: block;
  min-width: 0;
  line-height: 1.2;
}
.settings-nav-copy strong,
.settings-nav-copy small {
  display: block;
}
.settings-nav-copy strong {
  color: var(--brand-foreground);
  font-size: 11.5px;
  font-weight: 680;
}
.settings-nav-copy small {
  margin-top: 2px;
  color: var(--brand-muted);
  font-size: 9.5px;
  font-weight: 450;
}

.settings-panel {
  min-width: 0;
  flex: 1;
  overflow-y: auto;
  padding: 24px;
}
.settings-section-title {
  margin: 0;
  font-size: 13px;
  font-weight: 680;
  color: var(--brand-foreground);
}
.settings-section-desc {
  margin: 5px 0 18px;
  font-size: 11px;
  line-height: 1.6;
  color: var(--brand-muted);
}
.settings-section-title-spaced {
  margin-top: 28px;
}
.settings-card {
  border: 1px solid var(--brand-border);
  border-radius: 10px;
  background: var(--brand-surface);
  padding: 14px 16px;
}
.settings-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.settings-row-wrap {
  flex-wrap: wrap;
}
.settings-card-row + .settings-card-row {
  margin-top: 12px;
  border-top: 1px solid var(--brand-border);
  padding-top: 12px;
}
.settings-label {
  color: var(--brand-foreground);
  font-size: 11.5px;
  font-weight: 650;
}
.settings-label-with-icon {
  display: flex;
  align-items: center;
  gap: 6px;
}
.settings-notification-actions {
  display: flex;
  flex: none;
  align-items: center;
  gap: 8px;
}

/* Segmented 的 label 行高较大：
   1. label 用 flex 让 icon span 与文字 span 垂直居中；
   2. icon span 内部的 svg 默认 baseline 对齐仍会偏上，需让 icon span
      自身也变为 flex 容器，svg 才能真正居中。 */
.theme-segmented :deep(.ant-segmented-item-label) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.theme-segmented :deep(.ant-segmented-item-icon) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.settings-hint {
  margin: 3px 0 0;
  color: var(--brand-muted);
  font-size: 10px;
  line-height: 1.5;
}

@media (max-width: 560px) {
  :global(.settings-dialog-wrap .ant-modal) {
    max-width: 100%;
    margin: 0;
    padding-bottom: 0;
    top: auto;
  }
  :global(.settings-dialog-wrap .ant-modal-container) {
    border-width: 1px 0 0;
    border-radius: 12px 12px 0 0;
  }
  .settings-dialog-header {
    min-height: 56px;
    padding: 0 14px;
  }
  .settings-dialog-body {
    flex-direction: column;
    height: min(640px, calc(100dvh - 96px));
    min-height: 0;
  }
  .settings-nav {
    width: 100%;
    flex: none;
    flex-direction: row;
    gap: 4px;
    overflow-x: auto;
    border-right: 0;
    border-bottom: 1px solid var(--brand-border);
    padding: 8px;
  }
  .settings-nav-item {
    min-height: 40px;
    flex: 1 0 auto;
    min-width: max-content;
    justify-content: center;
    padding: 5px 10px;
  }
  .settings-nav-icon {
    width: 24px;
    height: 24px;
    flex-basis: 24px;
  }
  .settings-nav-copy small {
    display: none;
  }
  .settings-panel {
    padding: 18px 14px 22px;
  }
}
</style>

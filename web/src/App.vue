<script setup lang="ts">
import { App as AntApp, ConfigProvider } from "antdv-next";
import { XProvider } from "@antdv-next/x";
import { computed, onBeforeUnmount, onMounted } from "vue";
import AppSidebar from "./components/AppSidebar.vue";
import ChatView from "./components/ChatView.vue";
import NewChat from "./components/NewChat.vue";
import SettingsDialog from "./components/SettingsDialog.vue";
import { init, isDark, newConversation, store } from "./store";
import { antdThemeFor } from "./theme";

const theme = computed(() => antdThemeFor(isDark.value));

const mod = navigator.platform.includes("Mac") ? (e: KeyboardEvent) => e.metaKey : (e: KeyboardEvent) => e.ctrlKey;

function onKey(e: KeyboardEvent) {
  if (!mod(e)) return;
  if (e.key === "n") {
    e.preventDefault();
    newConversation();
  } else if (e.key === "k") {
    e.preventDefault();
    store.sidebarCollapsed = false;
    document.getElementById("conv-search")?.focus();
  } else if (e.key === ",") {
    e.preventDefault();
    store.settingsOpen = true;
  }
}

onMounted(() => {
  window.addEventListener("keydown", onKey);
  void init();
});
onBeforeUnmount(() => window.removeEventListener("keydown", onKey));
</script>

<template>
  <ConfigProvider :theme="theme">
    <XProvider :theme="theme">
      <AntApp>
        <div class="shell">
          <div v-if="!store.ready" class="boot">
            <div class="boot-mark" />
            <p v-if="store.bootError" class="boot-error selectable">{{ store.bootError }}</p>
            <p v-else class="faint">正在准备你的工作台…</p>
          </div>
          <template v-else>
            <AppSidebar v-if="!store.sidebarCollapsed" />
            <main class="main">
              <ChatView v-if="store.activeId && store.metas[store.activeId]" :key="store.activeId" />
              <NewChat v-else />
            </main>
            <SettingsDialog v-model:open="store.settingsOpen" />
          </template>
        </div>
      </AntApp>
    </XProvider>
  </ConfigProvider>
</template>

<style scoped>
.shell {
  display: flex;
  height: 100dvh;
  overflow: hidden;
  background: var(--bg);
}

.main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  position: relative;
  background: var(--bg);
}

.boot {
  flex: 1;
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 14px;
}

.boot-mark {
  width: 34px;
  height: 34px;
  border-radius: 11px;
  background: linear-gradient(135deg, #8b8cff, #4b4bd0);
  box-shadow: 0 8px 24px rgba(91, 91, 214, 0.35);
  animation: oc-pulse 1.6s ease-in-out infinite;
}

.boot-error {
  max-width: 460px;
  font-size: 13px;
  color: var(--err);
  text-align: center;
}
</style>

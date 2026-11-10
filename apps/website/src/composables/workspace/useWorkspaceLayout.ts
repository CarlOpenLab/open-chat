import { onBeforeUnmount, onMounted, ref } from "vue";

/**
 * 工作区布局状态：侧栏可见性与浮层开关。
 * 媒体查询监听归属本组合式函数，由它自行注册与注销。
 */
export function useWorkspaceLayout() {
  const conversationsOpen = ref(true);
  /** 默认 sidebar 252 */
  const sidebarWidth = ref(252);
  const commandPaletteOpen = ref(false);
  const settingsOpen = ref(false);
  /** 移动端断点监听：跨越 767px 时收起侧栏 */
  const mobileLayoutMedia =
    typeof window !== "undefined" ? window.matchMedia("(max-width: 767px)") : null;

  const handleMobileLayoutChange = (event: MediaQueryListEvent) => {
    if (event.matches) {
      conversationsOpen.value = false;
    }
  };

  onMounted(() => {
    mobileLayoutMedia?.addEventListener("change", handleMobileLayoutChange);
    if (mobileLayoutMedia?.matches) {
      conversationsOpen.value = false;
    }
  });

  onBeforeUnmount(() => {
    mobileLayoutMedia?.removeEventListener("change", handleMobileLayoutChange);
  });

  return {
    conversationsOpen,
    sidebarWidth,
    commandPaletteOpen,
    settingsOpen,
    handleMobileLayoutChange,
  };
}

import { onBeforeUnmount, onMounted, ref, type Ref } from "vue";

/** 看板抽屉宽度：桌面默认 1080，上限视口 92%；移动端由 CSS 全屏接管。 */
const DRAWER_WIDTH_DEFAULT = 1080;

export interface UseWorkspaceLayoutDeps {
  /** 窄屏折叠时同步关闭的看板抽屉 key（跨域状态由容器持有）。 */
  boardOpenKey: Ref<string>;
}

/**
 * 工作区布局状态：侧栏可见性 / 宽度、看板抽屉宽度与移动端断点监听。
 * 媒体查询监听归属本组合式函数，由它自行注册与注销。
 */
export function useWorkspaceLayout(deps: UseWorkspaceLayoutDeps) {
  const conversationsOpen = ref(true);
  /** 默认 sidebar 252 */
  const sidebarWidth = ref(252);
  const commandPaletteOpen = ref(false);
  const settingsOpen = ref(false);
  const drawerWidth = ref(
    typeof window !== "undefined"
      ? Math.min(DRAWER_WIDTH_DEFAULT, Math.floor(window.innerWidth * 0.92))
      : DRAWER_WIDTH_DEFAULT,
  );
  /** 移动端断点监听：跨越 767px 时收起侧栏并重算抽屉宽度上限 */
  const mobileLayoutMedia =
    typeof window !== "undefined" ? window.matchMedia("(max-width: 767px)") : null;

  const handleMobileLayoutChange = (event: MediaQueryListEvent) => {
    if (event.matches) {
      conversationsOpen.value = false;
      deps.boardOpenKey.value = "";
    }
    drawerWidth.value = Math.min(DRAWER_WIDTH_DEFAULT, Math.floor(window.innerWidth * 0.92));
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
    drawerWidth,
    commandPaletteOpen,
    settingsOpen,
    handleMobileLayoutChange,
  };
}

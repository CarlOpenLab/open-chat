<script setup lang="ts">
import {
  ArrowRight as ArrowRightOutlined,
  Menu as MenuOutlined,
  Moon as MoonOutlined,
  Sparkles,
  Sun as SunOutlined,
} from "@lucide/vue";
import { Button } from "antdv-next";
import { onBeforeUnmount, onMounted, ref } from "vue";

interface Props {
  dark: boolean;
}

interface Emits {
  (e: "navigate", path: string): void;
  (e: "toggleTheme"): void;
}

defineProps<Props>();
const emit = defineEmits<Emits>();

const mobileMenuOpen = ref(false);
const headerScrolled = ref(false);

const go = (path: string) => emit("navigate", path);
const onScroll = () => {
  headerScrolled.value = window.scrollY > 12;
};
const onKeydown = (event: KeyboardEvent) => {
  if (event.key === "Escape") mobileMenuOpen.value = false;
};
const onDocumentClick = (event: MouseEvent) => {
  if (!(event.target as Element).closest(".nav-shell")) mobileMenuOpen.value = false;
};

onMounted(() => {
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("keydown", onKeydown);
  document.addEventListener("click", onDocumentClick);
});
onBeforeUnmount(() => {
  window.removeEventListener("scroll", onScroll);
  window.removeEventListener("keydown", onKeydown);
  document.removeEventListener("click", onDocumentClick);
});
</script>

<template>
  <header
    class="site-header fixed inset-x-0 top-0 z-20 h-16 border-b-1 border-b-solid bg-[color-mix(in_srgb,var(--background)_88%,transparent)] backdrop-blur-[16px] transition-[border-color,box-shadow] duration-180 ease-[ease]"
    :class="headerScrolled ? 'border-b-border shadow-sm' : 'border-b-transparent'"
  >
    <nav
      class="nav-shell mx-auto grid h-full w-[min(1240px,calc(100%-48px))] grid-cols-[1fr_auto_1fr] items-center gap-6"
      aria-label="主导航"
    >
      <a
        class="brand inline-flex min-h-11 w-fit items-center gap-2.5 font-650 text-foreground no-underline"
        href="#top"
        aria-label="Open Chat 首页"
      >
        <span
          class="brand-mark grid h-[30px] w-[30px] place-items-center rounded-[5px] bg-foreground text-background"
          ><Sparkles class="h-4 w-4" /></span
        ><span>Open Chat</span>
      </a>
      <div
        class="nav-links flex items-center gap-[30px]"
        :class="{ open: mobileMenuOpen }"
        @click="mobileMenuOpen = false"
      >
        <a
          class="cursor-pointer text-[14px] text-muted-foreground no-underline transition-[color] duration-150 ease-[ease] hover:text-foreground"
          href="#features"
          >功能</a
        >
        <a
          class="cursor-pointer text-[14px] text-muted-foreground no-underline transition-[color] duration-150 ease-[ease] hover:text-foreground"
          href="#architecture"
          >架构</a
        >
        <a
          class="cursor-pointer text-[14px] text-muted-foreground no-underline transition-[color] duration-150 ease-[ease] hover:text-foreground"
          href="#pricing"
          >版本</a
        >
        <a
          class="cursor-pointer text-[14px] text-muted-foreground no-underline transition-[color] duration-150 ease-[ease] hover:text-foreground"
          href="#faq"
          >FAQ</a
        >
      </div>
      <div class="nav-actions flex items-center justify-self-end gap-2">
        <button
          class="login-link cursor-pointer border-0 bg-transparent text-[14px] text-muted-foreground transition-[color] duration-150 ease-[ease] hover:text-foreground"
          type="button"
          @click="go('/auth')"
        >
          登录
        </button>
        <Button
          type="text"
          shape="circle"
          :aria-label="dark ? '切换浅色模式' : '切换深色模式'"
          @click="emit('toggleTheme')"
        >
          <MoonOutlined v-if="!dark" /><SunOutlined v-else />
        </Button>
        <Button type="primary" class="desktop-cta" @click="go('/chat')">
          打开工作区 <ArrowRightOutlined />
        </Button>
        <Button
          class="menu-button"
          type="text"
          shape="circle"
          :aria-label="mobileMenuOpen ? '关闭导航菜单' : '打开导航菜单'"
          :aria-expanded="mobileMenuOpen"
          @click="mobileMenuOpen = !mobileMenuOpen"
        >
          <MenuOutlined />
        </Button>
      </div>
    </nav>
  </header>
</template>

<style scoped>
/* antd 组件内部类覆盖（:deep）与非常规断点（900/760/430px）媒体查询，保留 */
.nav-actions :deep(.ant-btn-circle),
.menu-button {
  width: 40px;
  min-width: 40px;
  height: 40px;
}
.menu-button {
  display: none;
}

@media (max-width: 900px) {
  .nav-shell {
    grid-template-columns: 1fr auto;
  }
  .nav-links {
    position: absolute;
    top: 63px;
    right: 24px;
    left: 24px;
    display: none;
    align-items: stretch;
    flex-direction: column;
    gap: 0;
    padding: 8px;
    border: 1px solid var(--border);
    border-radius: 7px;
    background: var(--background);
    box-shadow: var(--shadow-xl);
  }
  .nav-links.open {
    display: flex;
  }
  .nav-links a {
    display: flex;
    min-height: 44px;
    align-items: center;
    padding: 0 12px;
    border-radius: 4px;
  }
  .nav-links a:hover {
    background: var(--muted);
  }
  .menu-button {
    display: inline-flex;
  }
}
@media (max-width: 760px) {
  .nav-shell {
    width: calc(100% - 32px);
  }
  .site-header {
    height: 58px;
  }
  .desktop-cta {
    display: none;
  }
  .login-link {
    min-width: 44px;
    min-height: 44px;
    padding-inline: 6px;
  }
  .nav-actions :deep(.ant-btn-circle),
  .menu-button {
    width: 44px;
    min-width: 44px;
    height: 44px;
  }
}
@media (max-width: 430px) {
  .nav-links {
    right: 12px;
    left: 12px;
  }
}
</style>

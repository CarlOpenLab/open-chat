<script setup lang="ts">
import { onBeforeUnmount, onMounted } from "vue";
import LandingArchitecture from "../components/landing/LandingArchitecture.vue";
import LandingFaq from "../components/landing/LandingFaq.vue";
import LandingFeatures from "../components/landing/LandingFeatures.vue";
import LandingFinalCta from "../components/landing/LandingFinalCta.vue";
import LandingFooter from "../components/landing/LandingFooter.vue";
import LandingHeader from "../components/landing/LandingHeader.vue";
import LandingHero from "../components/landing/LandingHero.vue";
import LandingOffer from "../components/landing/LandingOffer.vue";
import LandingProofStrip from "../components/landing/LandingProofStrip.vue";

interface Props {
  dark: boolean;
}

interface Emits {
  (e: "navigate", path: string): void;
  (e: "toggleTheme"): void;
}

defineProps<Props>();
const emit = defineEmits<Emits>();

let revealObserver: IntersectionObserver | undefined;

const go = (path: string) => emit("navigate", path);

onMounted(() => {
  revealObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("visible");
        revealObserver?.unobserve(entry.target);
      });
    },
    { threshold: 0.12 },
  );
  document.querySelectorAll(".landing-page .reveal").forEach((element, index) => {
    (element as HTMLElement).style.transitionDelay = `${Math.min(index % 4, 3) * 70}ms`;
    revealObserver?.observe(element);
  });
});
onBeforeUnmount(() => {
  revealObserver?.disconnect();
});
</script>

<template>
  <div class="landing-page min-h-[100dvh] bg-background text-[16px] text-foreground">
    <a class="skip-link" href="#main">跳到主要内容</a>

    <LandingHeader :dark="dark" @navigate="go" @toggle-theme="emit('toggleTheme')" />

    <main id="main">
      <LandingHero @navigate="go" />
      <LandingProofStrip />
      <LandingFeatures />
      <LandingArchitecture @navigate="go" />
      <LandingOffer @navigate="go" />
      <LandingFaq />
      <LandingFinalCta @navigate="go" />
    </main>

    <LandingFooter @navigate="go" />
  </div>
</template>

<style scoped>
/* reveal 进场动画：由 JS 动态添加 .visible，且需响应 prefers-reduced-motion，保留 */
.landing-page :deep(.reveal) {
  opacity: 0;
  transform: translateY(14px);
  transition:
    opacity 560ms ease,
    transform 560ms ease;
}
.landing-page :deep(.reveal.visible) {
  opacity: 1;
  transform: translateY(0);
}

/* 全页 antd 按钮触控尺寸（:deep + 非常规断点 760px），保留 */
@media (max-width: 760px) {
  .landing-page :deep(.ant-btn) {
    min-height: 44px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .landing-page :deep(.reveal) {
    opacity: 1;
    transform: none;
  }
}
</style>

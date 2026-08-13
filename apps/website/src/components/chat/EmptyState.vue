<script setup lang="ts">
import { Asterisk } from "@lucide/vue";

interface Props {
  /** 标题中被下划线标注的工作区名 */
  projectName?: string;
  /** 副标题，默认不展示 */
  description?: string;
}

withDefaults(defineProps<Props>(), {
  projectName: "open-chat",
  description: "",
});
</script>

<template>
  <div
    class="flex flex-1 flex-col items-center justify-center px-8 pb-[52px] select-none"
    aria-label="空对话欢迎页"
  >
    <span class="grid place-items-center" aria-hidden="true">
      <Asterisk class="!h-5 !w-5 text-brand-accent" />
    </span>
    <h1 class="mt-[14px] mb-0 text-[20px] font-medium text-brand-foreground">
      想在
      <span class="project-name">{{ projectName }}</span>
      中构建什么？
    </h1>
    <p
      v-if="description"
      class="mt-2 mb-0 max-w-[380px] text-center text-[12.5px] leading-[19px] text-brand-muted-strong"
    >
      {{ description }}
    </p>
    <slot />
  </div>
</template>

<style scoped>
/* Waku 的 ProjectNameSelector：贴着元素底边的 1px 虚线（dash 1 / gap 2），
   颜色是 text_tertiary。text-decoration 的 dotted 点距不可控，改用背景渐变。 */
.project-name {
  padding-bottom: 1px;
  background-image: linear-gradient(to right, var(--brand-muted-strong) 0 1px, transparent 1px 3px);
  background-repeat: repeat-x;
  background-position: bottom left;
  background-size: 3px 1px;
}
</style>

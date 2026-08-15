<script setup lang="ts">
interface Props {
  size?: number;
  title?: string;
}

const props = withDefaults(defineProps<Props>(), {
  size: 24,
  title: "",
});
</script>

<template>
  <img
    src="/logo.png"
    :width="props.size"
    :height="props.size"
    class="open-chat-logo"
    :alt="props.title || undefined"
    :aria-hidden="props.title ? undefined : 'true'"
  />
</template>

<style scoped>
/* logo.png 是灰阶图但含明暗两种像素（气泡 + 内部高光细节）：
   浅色主题原样显示；
   深色主题下若直接 invert(1)，暗像素变亮的同时内部亮像素会变暗，
   与深色背景同色而消失，图标残缺。
   先 brightness(0) 把整图压成纯黑剪影（只保留 alpha 形状），
   再 invert(0.87) 提为均匀浅灰，保证剪影完整、颜色单调。 */
.open-chat-logo {
  display: block;
  object-fit: contain;
}
/* :global(html[data-theme="dark"]) .open-chat-logo {
  filter: invert(1);
} */
</style>

<script setup lang="ts">
import { Bubble } from "@antdv-next/x";
import { Image } from "antdv-next";

/** 图片附件缩略图：src 由父层解析（本组件不接触服务层）。 */
interface AttachmentThumb {
  reference: string;
  name: string;
  src: string;
}

interface Props {
  /** 气泡文本内容（等于 item.content）。 */
  content: string;
  /** 已过滤为图片的附件缩略图。 */
  attachments?: AttachmentThumb[];
}

const props = withDefaults(defineProps<Props>(), { attachments: () => [] });
</script>

<template>
  <div class="flex w-full justify-end">
    <Bubble class="user-bubble" placement="end" variant="filled" shape="round" :content="content">
      <template #contentRender="{ content: renderedContent }">
        <div v-if="attachments.length" class="user-attachments">
          <div v-for="att in attachments" :key="att.reference" class="user-attachment-link">
            <Image :src="att.src" :alt="att.name" class="user-attachment-image" />
          </div>
        </div>
        <span class="whitespace-pre-wrap break-words">{{ renderedContent }}</span>
      </template>
    </Bubble>
  </div>
</template>

<style scoped>
.user-bubble {
  max-width: 50%;
  word-break: break-all;
  animation: message-in 260ms cubic-bezier(0.2, 0, 0, 1) both;
}

.user-attachments {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 6px;
}
.user-attachment-link {
  display: block;
  width: 160px;
  max-width: 100%;
  overflow: hidden;
  border: 1px solid var(--brand-border);
  border-radius: 10px;
}
.user-attachment-image {
  display: block;
  width: 100%;
  height: 112px;
  object-fit: cover;
  transition: transform 160ms ease;
}
.user-attachment-link:hover .user-attachment-image {
  transform: scale(1.02);
}

@keyframes message-in {
  from {
    opacity: 0;
    transform: translateY(7px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>

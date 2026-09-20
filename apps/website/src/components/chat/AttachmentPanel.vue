<script setup lang="ts">
import { ImagePlus, X } from "@lucide/vue";
import { ref } from "vue";
import type { StagedAttachment } from "../../composables/useComposerData";
import { createStyles } from "../../theme/antdvStyle";
import type { AccentGlobalToken } from "../../theme/shadcnTheme";

interface Props {
  attachments: StagedAttachment[];
}

defineProps<Props>();

const emit = defineEmits<{
  (e: "remove", index: number): void;
  /** 文件选择器产出的待上传文件；父级统一走 attachmentsUpload 上抛。 */
  (e: "upload", files: File[]): void;
}>();

const useStyles = createStyles(({ token, css }) => ({
  // 面板只渲染在 sender-header-card 内：原 .attachment-preview-row 的 padding
  // 10px 10px 0 被 .sender-header-card 上下文覆写为 0，此处直接取覆写后的值。
  root: css`
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    padding: 0;

    .attachment-tile {
      position: relative;
      width: 64px;
      height: 64px;
      flex: none;
      overflow: hidden;
      border: 1px solid ${token.colorBorder};
      border-radius: 8px;
      background: ${token.colorFillSecondary};
    }
    .attachment-image {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }
    .attachment-remove {
      position: absolute;
      top: 3px;
      right: 3px;
      display: grid;
      width: 18px;
      height: 18px;
      place-items: center;
      border: 0;
      border-radius: 50%;
      padding: 0;
      background: rgba(0, 0, 0, 0.55);
      color: #fff;
      cursor: pointer;
      opacity: 1;
      transition: opacity ${token.motionDurationMid} ${token.motionEaseInOut};
    }
    .attachment-tile:hover .attachment-remove {
      opacity: 0.92;
    }
    .attachment-remove-icon {
      width: 10px;
      height: 10px;
    }
    .attachment-overlay {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 10.5px;
      color: ${token.colorText};
      background: color-mix(in srgb, ${token.colorBgLayout} 78%, transparent);
    }
    .attachment-add {
      display: grid;
      width: 64px;
      height: 64px;
      flex: none;
      place-items: center;
      border: 1px dashed ${token.colorBorder};
      border-radius: 8px;
      padding: 0;
      background: transparent;
      color: ${token.colorTextTertiary};
      cursor: pointer;
      transition:
        border-color ${token.motionDurationMid} ${token.motionEaseInOut},
        color ${token.motionDurationMid} ${token.motionEaseInOut};
    }
    .attachment-add:hover {
      border-color: ${(token as AccentGlobalToken).colorAccent};
      color: ${(token as AccentGlobalToken).colorAccent};
    }
    .attachment-add-icon {
      width: 14px;
      height: 14px;
    }
  `,
}));

const { styles } = useStyles();

// 常驻挂载：面板打开期间点击“添加图片”直接触发系统文件选择器。
const fileInputRef = ref<HTMLInputElement | null>(null);
const pickFiles = () => fileInputRef.value?.click();

const handleFileInputChange = (event: Event) => {
  const input = event.target as HTMLInputElement;
  if (input.files?.length) emit("upload", Array.from(input.files));
  input.value = "";
};
</script>

<template>
  <div class="attachment-preview-row" :class="styles.root">
    <div
      v-for="(attachment, index) in attachments"
      :key="attachment.sourceKey"
      class="attachment-tile"
      :class="{
        'is-uploading': attachment.uploading,
        'has-error': Boolean(attachment.error),
      }"
    >
      <img v-if="attachment.isImage" :src="attachment.previewUrl" class="attachment-image" alt="" />
      <button
        type="button"
        class="attachment-remove"
        aria-label="移除附件"
        title="删除图片"
        @click.stop.prevent="emit('remove', index)"
      >
        <X class="attachment-remove-icon" />
      </button>
      <div v-if="attachment.uploading" class="attachment-overlay">上传中…</div>
      <div v-else-if="attachment.error" class="attachment-overlay">上传失败</div>
    </div>
    <button type="button" class="attachment-add" aria-label="添加图片" @click="pickFiles">
      <ImagePlus class="attachment-add-icon" />
    </button>
    <input
      ref="fileInputRef"
      type="file"
      accept="image/*"
      multiple
      hidden
      @change="handleFileInputChange"
    />
  </div>
</template>

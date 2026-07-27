<script setup lang="ts">
import { XMarkdown } from "@antdv-next/x-markdown";
import { computed, provide, type Component } from "vue";
import { parseA2UIContent } from "../../utils/a2ui";
import A2UIRenderer from "./A2UIRenderer.vue";
import MarkdownCodeRenderer from "./MarkdownCodeRenderer.vue";
import { markdownThemeKey, type MarkdownTheme } from "./markdownTheme";

interface Props {
  modelValue: string;
  dark: boolean;
}

interface Emits {
  (e: "update:modelValue", value: string): void;
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

const parsedContent = computed(() => parseA2UIContent(props.modelValue));
const markdownTheme = computed<MarkdownTheme>(() => (props.dark ? "dark" : "light"));
const markdownClassName = computed(
  () => `assistant-opening-markdown x-markdown-${markdownTheme.value}`,
);
const markdownComponents: Record<string, Component> = {
  code: MarkdownCodeRenderer,
};
const markdownStreaming = {
  enableAnimation: false,
  hasNextChunk: false,
};

const handleInput = (event: Event) => {
  emit("update:modelValue", (event.target as HTMLTextAreaElement).value);
};

provide(markdownThemeKey, markdownTheme);
</script>

<template>
  <section class="opening-message-field" aria-labelledby="opening-message-title">
    <div>
      <span id="opening-message-title" class="opening-message-label">预置开场消息（可选）</span>
      <p class="opening-message-help">
        助手打开时由宿主直接展示，不调用模型；支持 Markdown 和完整的 A2UI 协议块。
      </p>
    </div>
    <div class="opening-message-workbench">
      <div class="opening-message-pane">
        <div class="opening-message-pane-title">Markdown</div>
        <textarea
          :value="modelValue"
          class="opening-message-editor"
          rows="12"
          spellcheck="false"
          aria-label="编辑预置开场消息"
          placeholder="例如：&#10;## 你好 👋&#10;&#10;告诉我你今天想完成什么。"
          @input="handleInput"
        />
      </div>
      <div class="opening-message-pane">
        <div class="opening-message-pane-title">实时预览</div>
        <div class="opening-message-preview">
          <div v-if="!modelValue.trim()" class="opening-message-empty">
            输入 Markdown 后，这里会实时显示用户看到的开场效果。
          </div>
          <template v-else>
            <XMarkdown
              v-if="parsedContent.markdown.trim()"
              :content="parsedContent.markdown"
              :components="markdownComponents"
              :streaming="markdownStreaming"
              :class-name="markdownClassName"
              open-links-in-new-tab
            />
            <A2UIRenderer
              v-if="
                parsedContent.commands.length ||
                parsedContent.errors.length ||
                parsedContent.hasPendingBlock
              "
              :commands="parsedContent.commands"
              :errors="parsedContent.errors"
              :pending="parsedContent.hasPendingBlock"
              :action-pending="false"
              owner-message-id="assistant-opening-preview"
            />
          </template>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.opening-message-field {
  display: grid;
  gap: 9px;
}
.opening-message-label {
  color: var(--brand-foreground);
  font-size: 11px;
  font-weight: 650;
}
.opening-message-help {
  margin: 4px 0 0;
  color: var(--brand-muted);
  font-size: 10px;
  font-weight: 450;
  line-height: 1.55;
}
.opening-message-workbench {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  overflow: hidden;
  min-height: 280px;
  border: 1px solid var(--brand-border);
  border-radius: 8px;
  background: var(--brand-surface);
}
.opening-message-pane {
  display: grid;
  min-width: 0;
  grid-template-rows: auto minmax(0, 1fr);
}
.opening-message-pane + .opening-message-pane {
  border-left: 1px solid var(--brand-border);
}
.opening-message-pane-title {
  border-bottom: 1px solid var(--brand-border);
  background: var(--brand-surface-subtle);
  padding: 8px 11px;
  color: var(--brand-muted-strong);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.opening-message-editor {
  width: 100%;
  min-height: 240px;
  border: 0;
  background: transparent;
  padding: 12px;
  color: var(--brand-foreground);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 11px;
  line-height: 1.65;
  outline: 0;
  resize: vertical;
}
.opening-message-editor:focus {
  box-shadow: inset 0 0 0 2px var(--brand-ring);
}
.opening-message-preview {
  min-height: 240px;
  overflow: auto;
  padding: 14px;
}
.opening-message-empty {
  display: grid;
  min-height: 210px;
  place-items: center;
  padding: 24px;
  color: var(--brand-muted);
  font-size: 10px;
  line-height: 1.6;
  text-align: center;
}

@media (max-width: 767px) {
  .opening-message-workbench {
    grid-template-columns: 1fr;
  }
  .opening-message-pane + .opening-message-pane {
    border-top: 1px solid var(--brand-border);
    border-left: 0;
  }
  .opening-message-editor,
  .opening-message-preview {
    min-height: 220px;
  }
}
</style>

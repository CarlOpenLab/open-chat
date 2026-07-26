<script setup lang="ts">
import { css } from "@codemirror/lang-css";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { vue } from "@codemirror/lang-vue";
import { LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { oneDark } from "@codemirror/theme-one-dark";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { onBeforeUnmount, onMounted, ref, watch } from "vue";

interface Props {
  modelValue: string;
  language?: string;
  dark?: boolean;
  readOnly?: boolean;
}

interface Emits {
  (e: "update:modelValue", value: string): void;
}

const props = withDefaults(defineProps<Props>(), {
  language: "text",
  dark: false,
  readOnly: false,
});
const emit = defineEmits<Emits>();
const host = ref<HTMLDivElement>();
let editor: EditorView | undefined;

const languageCompartment = new Compartment();
const themeCompartment = new Compartment();
const readOnlyCompartment = new Compartment();

const getSyncLanguageExtension = (normalized: string): Extension | null => {
  if (["js", "javascript", "jsx"].includes(normalized)) {
    return javascript({ jsx: normalized === "jsx" });
  }
  if (["ts", "typescript", "tsx"].includes(normalized)) {
    return javascript({ typescript: true, jsx: normalized === "tsx" });
  }
  if (normalized === "vue") return vue();
  if (normalized === "json") return json();
  if (normalized === "css") return css();
  if (["md", "markdown"].includes(normalized)) return markdown();
  return null;
};

let languageRequestId = 0;

const applyLanguage = async (language: string) => {
  const requestId = ++languageRequestId;
  const normalized = language.toLowerCase();
  let extension = getSyncLanguageExtension(normalized);
  if (!extension) {
    const description = LanguageDescription.matchLanguageName(languages, normalized, true);
    extension = description ? await description.load() : [];
  }
  if (!editor || requestId !== languageRequestId) return;
  editor.dispatch({ effects: languageCompartment.reconfigure(extension) });
};

const lightTheme = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: "var(--brand-sidebar)",
    color: "var(--brand-foreground)",
  },
  ".cm-content": {
    caretColor: "var(--brand-foreground)",
    fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)",
  },
  ".cm-gutters": {
    backgroundColor: "var(--brand-sidebar)",
    color: "var(--brand-muted)",
    borderRight: "1px solid var(--brand-border)",
  },
  ".cm-activeLine, .cm-activeLineGutter": {
    backgroundColor: "var(--brand-surface-subtle)",
  },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
    backgroundColor: "color-mix(in srgb, var(--brand-primary) 18%, transparent)",
  },
});

const getThemeExtension = (): Extension => (props.dark ? oneDark : lightTheme);
const getReadOnlyExtension = (): Extension => [
  EditorState.readOnly.of(props.readOnly),
  EditorView.editable.of(!props.readOnly),
];

onMounted(() => {
  if (!host.value) return;
  const initialLanguage = props.language.toLowerCase();
  editor = new EditorView({
    parent: host.value,
    state: EditorState.create({
      doc: props.modelValue,
      extensions: [
        basicSetup,
        EditorView.lineWrapping,
        languageCompartment.of(getSyncLanguageExtension(initialLanguage) ?? []),
        themeCompartment.of(getThemeExtension()),
        readOnlyCompartment.of(getReadOnlyExtension()),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return;
          const value = update.state.doc.toString();
          if (value !== props.modelValue) emit("update:modelValue", value);
        }),
      ],
    }),
  });
  if (!getSyncLanguageExtension(initialLanguage)) void applyLanguage(props.language);
});

watch(
  () => props.modelValue,
  (value) => {
    if (!editor || value === editor.state.doc.toString()) return;
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } });
  },
);

watch(
  () => props.language,
  (language) => {
    void applyLanguage(language);
  },
);

watch(
  () => props.dark,
  () => {
    editor?.dispatch({ effects: themeCompartment.reconfigure(getThemeExtension()) });
  },
);

watch(
  () => props.readOnly,
  () => {
    editor?.dispatch({ effects: readOnlyCompartment.reconfigure(getReadOnlyExtension()) });
  },
);

onBeforeUnmount(() => {
  editor?.destroy();
  editor = undefined;
});
</script>

<template>
  <div ref="host" class="workspace-code-editor h-full min-h-0 w-full overflow-hidden"></div>
</template>

<style scoped>
/* 保留：:deep() 覆盖 CodeMirror 内部类 */
.workspace-code-editor :deep(.cm-editor) {
  height: 100%;
  font-size: 12px;
}
.workspace-code-editor :deep(.cm-scroller) {
  overflow: auto;
}
.workspace-code-editor :deep(.cm-content) {
  min-height: 100%;
  padding-block: 12px 32px;
}
.workspace-code-editor :deep(.cm-line) {
  padding-inline: 8px;
}
.workspace-code-editor :deep(.cm-focused) {
  outline: none;
}
</style>

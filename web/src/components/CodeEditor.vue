<script setup lang="ts">
import { indentWithTab } from "@codemirror/commands";
import { css } from "@codemirror/lang-css";
import { go } from "@codemirror/lang-go";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";
import { sql } from "@codemirror/lang-sql";
import { vue } from "@codemirror/lang-vue";
import { xml } from "@codemirror/lang-xml";
import { yaml } from "@codemirror/lang-yaml";
import { syntaxHighlighting } from "@codemirror/language";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { oneDarkHighlightStyle } from "@codemirror/theme-one-dark";
import { EditorView, keymap } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { onBeforeUnmount, onMounted, ref, watch } from "vue";

const props = defineProps<{
  modelValue: string;
  filename: string;
  dark: boolean;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: string];
  save: [];
}>();

const hostRef = ref<HTMLDivElement | null>(null);
let view: EditorView | null = null;
const langComp = new Compartment();
const themeComp = new Compartment();
let syncingFromProp = false;

function languageFor(filename: string): Extension {
  const lower = filename.toLowerCase();
  const ext = lower.includes(".") ? lower.split(".").pop() || "" : "";
  switch (ext) {
    case "ts":
    case "mts":
    case "cts":
      return javascript({ typescript: true });
    case "tsx":
      return javascript({ typescript: true, jsx: true });
    case "js":
    case "mjs":
    case "cjs":
      return javascript();
    case "jsx":
      return javascript({ jsx: true });
    case "vue":
      return vue();
    case "go":
      return go();
    case "json":
    case "jsonc":
    case "json5":
      return json();
    case "md":
    case "markdown":
    case "mdx":
      return markdown();
    case "css":
    case "scss":
    case "sass":
    case "less":
      return css();
    case "html":
    case "htm":
      return html();
    case "yaml":
    case "yml":
      return yaml();
    case "py":
    case "pyi":
      return python();
    case "rs":
      return rust();
    case "sql":
      return sql();
    case "xml":
    case "svg":
    case "plist":
      return xml();
    default:
      return [];
  }
}

function buildChromeTheme(dark: boolean): Extension {
  return EditorView.theme(
    {
      "&": {
        height: "100%",
        fontSize: "12.5px",
        backgroundColor: "transparent",
        color: dark ? "#d8dee9" : "var(--text)",
      },
      ".cm-scroller": {
        fontFamily: "var(--mono)",
        lineHeight: "1.66",
        overflow: "auto",
      },
      ".cm-content": {
        padding: "10px 0",
        caretColor: "var(--text)",
      },
      ".cm-cursor, .cm-dropCursor": {
        borderLeftColor: "var(--text)",
      },
      ".cm-line": {
        padding: "0 14px",
      },
      ".cm-gutters": {
        backgroundColor: "transparent",
        color: "var(--text-3)",
        borderRight: "1px solid var(--border)",
        minWidth: "40px",
      },
      ".cm-lineNumbers .cm-gutterElement": {
        padding: "0 10px 0 12px",
        fontSize: "11.5px",
      },
      ".cm-foldGutter .cm-gutterElement": {
        padding: "0 4px 0 0",
        color: "var(--text-3)",
      },
      ".cm-activeLine": {
        backgroundColor: dark ? "rgba(255, 255, 255, 0.032)" : "rgba(15, 23, 42, 0.032)",
      },
      ".cm-activeLineGutter": {
        backgroundColor: "transparent",
        color: "var(--text-2)",
      },
      "&.cm-focused": {
        outline: "none",
      },
      "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
        {
          backgroundColor: dark ? "rgba(148, 163, 184, 0.22)" : "rgba(15, 23, 42, 0.12)",
        },
      ".cm-matchingBracket": {
        backgroundColor: dark ? "rgba(255, 255, 255, 0.1)" : "rgba(15, 23, 42, 0.08)",
        outline: `1px solid ${dark ? "rgba(255, 255, 255, 0.18)" : "rgba(15, 23, 42, 0.16)"}`,
        borderRadius: "2px",
      },
      ".cm-panels": {
        backgroundColor: "var(--surface-strong)",
        color: "var(--text)",
        borderTop: "1px solid var(--border)",
      },
      ".cm-textfield": {
        backgroundColor: "var(--surface-2)",
        color: "var(--text)",
        border: "1px solid var(--border)",
        borderRadius: "5px",
      },
      ".cm-button": {
        backgroundImage: "none",
        backgroundColor: "var(--hover)",
        color: "var(--text)",
        border: "1px solid var(--border)",
        borderRadius: "5px",
      },
    },
    { dark },
  );
}

const darkChrome = buildChromeTheme(true);
const lightChrome = buildChromeTheme(false);

function themeFor(dark: boolean): Extension {
  return dark ? [syntaxHighlighting(oneDarkHighlightStyle), darkChrome] : [lightChrome];
}

onMounted(() => {
  if (!hostRef.value) return;
  const saveKeymap = keymap.of([
    {
      key: "Mod-s",
      run: () => {
        emit("save");
        return true;
      },
    },
    indentWithTab,
  ]);

  const updateListener = EditorView.updateListener.of((u) => {
    if (u.docChanged && !syncingFromProp) {
      emit("update:modelValue", u.state.doc.toString());
    }
  });

  view = new EditorView({
    state: EditorState.create({
      doc: props.modelValue,
      extensions: [
        basicSetup,
        saveKeymap,
        updateListener,
        langComp.of(languageFor(props.filename)),
        themeComp.of(themeFor(props.dark)),
      ],
    }),
    parent: hostRef.value,
  });
});

watch(
  () => props.modelValue,
  (next) => {
    if (!view) return;
    const current = view.state.doc.toString();
    if (next === current) return;
    syncingFromProp = true;
    view.dispatch({
      changes: { from: 0, to: current.length, insert: next },
    });
    syncingFromProp = false;
  },
);

watch(
  () => props.filename,
  (next) => {
    view?.dispatch({ effects: langComp.reconfigure(languageFor(next)) });
  },
);

watch(
  () => props.dark,
  (next) => {
    view?.dispatch({ effects: themeComp.reconfigure(themeFor(next)) });
  },
);

onBeforeUnmount(() => {
  view?.destroy();
  view = null;
});
</script>

<template>
  <div ref="hostRef" class="cm-host" />
</template>

<style scoped>
.cm-host {
  flex: 1;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  user-select: text;
  -webkit-user-select: text;
}
</style>

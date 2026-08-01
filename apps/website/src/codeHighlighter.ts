import type { LanguageInput } from "shiki";

import { setupCodeHighlighter } from "@antdv-next/x";

const languageAliases: Record<string, string> = {
  rb: "ruby",
  rs: "rust",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  yml: "yaml",
  md: "markdown",
  "c++": "cpp",
  "c#": "csharp",
};

const languageLoaders: Record<string, () => Promise<{ default: LanguageInput }>> = {
  jsx: () => import("shiki/dist/langs/jsx.mjs"),
  tsx: () => import("shiki/dist/langs/tsx.mjs"),
  bash: () => import("shiki/dist/langs/bash.mjs"),
  scss: () => import("shiki/dist/langs/scss.mjs"),
  vue: () => import("shiki/dist/langs/vue.mjs"),
  "vue-html": () => import("shiki/dist/langs/vue-html.mjs"),
  markdown: () => import("shiki/dist/langs/markdown.mjs"),
  yaml: () => import("shiki/dist/langs/yaml.mjs"),
  xml: () => import("shiki/dist/langs/xml.mjs"),
  sql: () => import("shiki/dist/langs/sql.mjs"),
  go: () => import("shiki/dist/langs/go.mjs"),
  rust: () => import("shiki/dist/langs/rust.mjs"),
  java: () => import("shiki/dist/langs/java.mjs"),
  c: () => import("shiki/dist/langs/c.mjs"),
  cpp: () => import("shiki/dist/langs/cpp.mjs"),
  csharp: () => import("shiki/dist/langs/csharp.mjs"),
  php: () => import("shiki/dist/langs/php.mjs"),
  ruby: () => import("shiki/dist/langs/ruby.mjs"),
  diff: () => import("shiki/dist/langs/diff.mjs"),
  dockerfile: () => import("shiki/dist/langs/dockerfile.mjs"),
  toml: () => import("shiki/dist/langs/toml.mjs"),
  ini: () => import("shiki/dist/langs/ini.mjs"),
  graphql: () => import("shiki/dist/langs/graphql.mjs"),
  regex: () => import("shiki/dist/langs/regex.mjs"),
};

setupCodeHighlighter({
  loadLanguage: async (language) => {
    const normalizedLanguage = languageAliases[language] ?? language;
    const loader = languageLoaders[normalizedLanguage];
    return loader ? (await loader()).default : null;
  },
});

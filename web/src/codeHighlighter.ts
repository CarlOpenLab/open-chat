import type { LanguageInput } from "shiki";
import { setupCodeHighlighter } from "@antdv-next/x";

const aliases: Record<string, string> = {
  rb: "ruby", rs: "rust", ts: "typescript", js: "javascript", sh: "bash", shell: "bash", zsh: "bash",
  console: "bash", yml: "yaml", md: "markdown", "c++": "cpp", "c#": "csharp", py: "python", golang: "go",
};

const loaders: Record<string, () => Promise<{ default: LanguageInput }>> = {
  typescript: () => import("shiki/dist/langs/typescript.mjs"),
  javascript: () => import("shiki/dist/langs/javascript.mjs"),
  jsx: () => import("shiki/dist/langs/jsx.mjs"),
  tsx: () => import("shiki/dist/langs/tsx.mjs"),
  json: () => import("shiki/dist/langs/json.mjs"),
  bash: () => import("shiki/dist/langs/bash.mjs"),
  python: () => import("shiki/dist/langs/python.mjs"),
  go: () => import("shiki/dist/langs/go.mjs"),
  rust: () => import("shiki/dist/langs/rust.mjs"),
  vue: () => import("shiki/dist/langs/vue.mjs"),
  html: () => import("shiki/dist/langs/html.mjs"),
  css: () => import("shiki/dist/langs/css.mjs"),
  scss: () => import("shiki/dist/langs/scss.mjs"),
  markdown: () => import("shiki/dist/langs/markdown.mjs"),
  yaml: () => import("shiki/dist/langs/yaml.mjs"),
  toml: () => import("shiki/dist/langs/toml.mjs"),
  sql: () => import("shiki/dist/langs/sql.mjs"),
  java: () => import("shiki/dist/langs/java.mjs"),
  kotlin: () => import("shiki/dist/langs/kotlin.mjs"),
  swift: () => import("shiki/dist/langs/swift.mjs"),
  c: () => import("shiki/dist/langs/c.mjs"),
  cpp: () => import("shiki/dist/langs/cpp.mjs"),
  csharp: () => import("shiki/dist/langs/csharp.mjs"),
  ruby: () => import("shiki/dist/langs/ruby.mjs"),
  php: () => import("shiki/dist/langs/php.mjs"),
  diff: () => import("shiki/dist/langs/diff.mjs"),
  dockerfile: () => import("shiki/dist/langs/dockerfile.mjs"),
  xml: () => import("shiki/dist/langs/xml.mjs"),
  ini: () => import("shiki/dist/langs/ini.mjs"),
};

export const knownLanguage = (lang: string) => Boolean(loaders[aliases[lang] ?? lang]);

setupCodeHighlighter({
  loadLanguage: async (language) => {
    const loader = loaders[aliases[language] ?? language];
    return loader ? (await loader()).default : null;
  },
});

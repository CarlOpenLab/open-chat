import { defineConfig, presetUno } from "unocss";

export default defineConfig({
  presets: [presetUno()],
  theme: {
    fontFamily: {
      sans: "var(--font)",
      mono: "var(--mono)",
    },
    colors: {
      bg: "var(--bg)",
      sidebar: "var(--bg-sidebar)",
      surface: {
        DEFAULT: "var(--surface)",
        2: "var(--surface-2)",
        strong: "var(--surface-strong)",
      },
      modal: "var(--modal-bg)",
      hover: "var(--hover)",
      active: "var(--active)",
      line: {
        DEFAULT: "var(--border)",
        strong: "var(--border-strong)",
      },
      ink: {
        DEFAULT: "var(--text)",
        2: "var(--text-2)",
        3: "var(--text-3)",
        solid: "var(--ink)",
        inv: "var(--ink-inv)",
      },
      accent: {
        DEFAULT: "var(--accent)",
        soft: "var(--accent-soft)",
        text: "var(--accent-text)",
      },
      ok: {
        DEFAULT: "var(--ok)",
        soft: "var(--ok-soft)",
      },
      warn: {
        DEFAULT: "var(--warn)",
        soft: "var(--warn-soft)",
      },
      err: {
        DEFAULT: "var(--err)",
        soft: "var(--err-soft)",
      },
      bubble: {
        user: "var(--user-bubble)",
      },
      code: {
        bg: "var(--code-bg)",
      },
      term: "var(--term-bg)",
      diff: {
        add: "var(--diff-add)",
        "add-text": "var(--diff-add-text)",
        del: "var(--diff-del)",
        "del-text": "var(--diff-del-text)",
      },
      brand: {
        claude: "#d97757",
        codebuddy: "#00bc90",
        qoder: "#2adb5c",
        omp: "#38bdf8",
        deepseek: "#4d6bfe",
      },
    },
    boxShadow: {
      card: "var(--shadow-card)",
      composer: "var(--shadow-composer)",
      pop: "var(--shadow-pop)",
      rim: "var(--glass-rim)",
    },
  },
  rules: [
    ["h-titlebar", { height: "var(--titlebar)" }],
    ["max-w-content", { "max-width": "var(--content-width)" }],
    ["ease-oc", { "transition-timing-function": "var(--ease)" }],
    [
      "glass",
      {
        "backdrop-filter": "var(--glass-blur)",
        "-webkit-backdrop-filter": "var(--glass-blur)",
      },
    ],
    [
      "glass-sm",
      {
        "backdrop-filter": "var(--glass-blur-sm)",
        "-webkit-backdrop-filter": "var(--glass-blur-sm)",
      },
    ],
    ["animate-oc-pulse", { animation: "oc-pulse 1.6s ease-in-out infinite" }],
    ["animate-oc-pulse-fast", { animation: "oc-pulse 1.4s ease-in-out infinite" }],
    ["animate-oc-rise", { animation: "oc-rise 0.22s var(--ease) both" }],
    ["animate-oc-spin", { animation: "oc-spin 0.8s linear infinite" }],
    ["animate-oc-bubble-in", { animation: "oc-bubble-fade-in 0.26s var(--ease) both" }],
    [/^fw-(\d+)$/, ([, d]) => ({ "font-weight": d })],
  ],
  shortcuts: {
    "icon-btn":
      "inline-grid place-items-center w-7 h-7 border-0 rounded-[7px] bg-transparent text-ink-3 cursor-pointer transition-colors duration-130 hover:bg-hover hover:text-ink",
    "collapse-grid":
      "grid grid-rows-[0fr] opacity-0 transition-[grid-template-rows,opacity] duration-240 ease-oc",
    "collapse-grid-open": "grid-rows-[1fr] opacity-100",
  },
});

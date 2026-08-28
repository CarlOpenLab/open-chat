import { defineConfig, presetIcons, presetTypography, presetUno } from "unocss";

// 主题 token 全部映射到 style.css 中的 CSS 变量，
// 亮/暗主题通过 html[data-theme] 切换变量值即可生效。
export default defineConfig({
  presets: [
    presetUno(),
    presetIcons({
      scale: 1.2,
      warn: true,
    }),
    presetTypography(),
  ],
  theme: {
    // 对齐既有媒体查询：lt-md => max-width 820px，lt-sm => max-width 560px
    breakpoints: {
      sm: "561px",
      md: "821px",
      lg: "1025px",
    },
    colors: {
      background: "var(--background)",
      foreground: "var(--foreground)",
      card: {
        DEFAULT: "var(--card)",
        foreground: "var(--card-foreground)",
      },
      subtle: "var(--subtle)",
      muted: {
        DEFAULT: "var(--muted)",
        foreground: "var(--muted-foreground)",
      },
      border: {
        DEFAULT: "var(--border)",
        strong: "var(--border-strong)",
      },
      input: "var(--input)",
      success: {
        DEFAULT: "var(--success)",
        subtle: "var(--success-subtle)",
      },
      danger: {
        DEFAULT: "var(--danger)",
        subtle: "var(--danger-subtle)",
      },
      brand: {
        background: "var(--brand-background)",
        surface: {
          DEFAULT: "var(--brand-surface)",
          muted: "var(--brand-surface-muted)",
          subtle: "var(--brand-surface-subtle)",
        },
        workspace: "var(--brand-workspace)",
        sidebar: {
          DEFAULT: "var(--brand-sidebar)",
          muted: "var(--brand-sidebar-muted)",
          foreground: "var(--brand-sidebar-foreground)",
          hover: "var(--brand-sidebar-hover)",
          active: "var(--brand-sidebar-active)",
        },
        foreground: "var(--brand-foreground)",
        muted: {
          DEFAULT: "var(--brand-muted)",
          strong: "var(--brand-muted-strong)",
        },
        border: {
          DEFAULT: "var(--brand-border)",
          strong: "var(--brand-border-strong)",
        },
        primary: {
          DEFAULT: "var(--brand-primary)",
          hover: "var(--brand-primary-hover)",
          foreground: "var(--brand-primary-foreground)",
        },
        danger: {
          DEFAULT: "var(--brand-danger)",
          subtle: "var(--brand-danger-subtle)",
        },
        success: "var(--brand-success)",
        ring: "var(--brand-ring)",
        accent: "var(--brand-accent)",
        resize: "var(--brand-resize)",
        gauge: "var(--brand-gauge)",
      },
    },
    boxShadow: {
      sm: "var(--shadow-sm)",
      lg: "var(--shadow-lg)",
      xl: "var(--shadow-xl)",
      "brand-xs": "var(--brand-shadow-xs)",
      "brand-sm": "var(--brand-shadow-sm)",
      "brand-float": "var(--brand-shadow-float)",
    },
    zIndex: {
      backdrop: "var(--z-backdrop)",
      sidebar: "var(--z-sidebar)",
      popover: "var(--z-popover)",
      modal: "var(--z-modal)",
    },
  },
});

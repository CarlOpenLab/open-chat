// Design tokens: Beacon-inspired Acrylic (frosted glass) palette shared between
// antdv-next tokens and CSS custom properties in styles.css.
import { theme as antdTheme } from "antdv-next";

const font =
  '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", "PingFang SC", "Hiragino Sans GB", "Segoe UI", "Microsoft YaHei", sans-serif';
export const mono = '"SF Mono", "JetBrains Mono", "Cascadia Code", Menlo, Consolas, "Liberation Mono", monospace';

export function antdThemeFor(dark: boolean) {
  return {
    algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
    token: {
      colorPrimary: dark ? "#f4f6fb" : "#14161c",
      colorInfo: dark ? "#7dd3fc" : "#2563eb",
      colorSuccess: dark ? "#34d399" : "#16a34a",
      colorWarning: dark ? "#fbbf24" : "#d97706",
      colorError: dark ? "#f87171" : "#dc2626",
      colorBgBase: dark ? "#0e1016" : "#f4f6fa",
      colorBgLayout: "transparent",
      colorBgContainer: dark ? "rgba(24, 27, 36, 0.72)" : "rgba(255, 255, 255, 0.76)",
      colorBgElevated: dark ? "rgba(26, 30, 40, 0.84)" : "rgba(255, 255, 255, 0.86)",
      colorBorder: dark ? "rgba(255, 255, 255, 0.11)" : "rgba(15, 23, 42, 0.09)",
      colorBorderSecondary: dark ? "rgba(255, 255, 255, 0.07)" : "rgba(15, 23, 42, 0.06)",
      colorText: dark ? "#f1f4f9" : "#111318",
      colorTextSecondary: dark ? "#9ca3b5" : "#4b5563",
      colorTextTertiary: dark ? "#687083" : "#7c8596",
      colorFillTertiary: dark ? "rgba(255, 255, 255, 0.06)" : "rgba(15, 23, 42, 0.045)",
      colorFillSecondary: dark ? "rgba(255, 255, 255, 0.095)" : "rgba(15, 23, 42, 0.07)",
      fontFamily: font,
      fontFamilyCode: mono,
      fontSize: 13.5,
      borderRadius: 11,
      borderRadiusSM: 8,
      borderRadiusLG: 16,
      controlHeight: 32,
      controlHeightSM: 26,
      boxShadowSecondary: dark
        ? "0 18px 48px rgba(0, 0, 0, 0.55), inset 0 1px 0 rgba(255, 255, 255, 0.1)"
        : "0 14px 40px rgba(15, 23, 42, 0.1), inset 0 1px 0 rgba(255, 255, 255, 0.9)",
      motionDurationMid: "0.18s",
    },
    components: {
      Button: {
        fontWeight: 520,
        primaryShadow: "none",
        defaultShadow: "none",
        dangerShadow: "none",
        primaryColor: dark ? "#0e1016" : "#ffffff",
      },
      Select: { optionSelectedFontWeight: 520 },
      Input: {
        hoverBorderColor: dark ? "rgba(255, 255, 255, 0.22)" : "rgba(15, 23, 42, 0.22)",
        activeBorderColor: dark ? "rgba(255, 255, 255, 0.34)" : "rgba(15, 23, 42, 0.34)",
        activeShadow: dark ? "0 0 0 3px rgba(255, 255, 255, 0.08)" : "0 0 0 3px rgba(15, 23, 42, 0.07)",
        activeBg: dark ? "rgba(30, 34, 46, 0.92)" : "#ffffff",
      },
      Modal: {
        titleFontSize: 15,
        contentBg: dark ? "#161922" : "#ffffff",
        headerBg: "transparent",
        footerBg: "transparent",
      },
      Tooltip: { colorBgSpotlight: dark ? "rgba(28, 32, 42, 0.92)" : "rgba(17, 19, 24, 0.9)" },
    },
  };
}

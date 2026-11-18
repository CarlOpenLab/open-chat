// Design tokens: one palette, used both by antdv-next (token) and by our CSS
// (custom properties set on <html> in styles.css).
import { theme as antdTheme } from "antdv-next";

const font =
  '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", "PingFang SC", "Hiragino Sans GB", "Segoe UI", "Microsoft YaHei", sans-serif';
export const mono = '"SF Mono", "JetBrains Mono", "Cascadia Code", Menlo, Consolas, "Liberation Mono", monospace';

export function antdThemeFor(dark: boolean) {
  return {
    algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
    token: {
      colorPrimary: dark ? "#8b8cff" : "#5b5bd6",
      colorInfo: dark ? "#8b8cff" : "#5b5bd6",
      colorSuccess: dark ? "#3fb27f" : "#1f9d63",
      colorWarning: dark ? "#e0a34a" : "#c98219",
      colorError: dark ? "#ef6b6b" : "#d9473f",
      colorBgBase: dark ? "#161617" : "#ffffff",
      colorBgLayout: dark ? "#161617" : "#fbfbfa",
      colorBgContainer: dark ? "#1d1d1f" : "#ffffff",
      colorBgElevated: dark ? "#232326" : "#ffffff",
      colorBorder: dark ? "rgba(255,255,255,0.12)" : "rgba(15,15,20,0.12)",
      colorBorderSecondary: dark ? "rgba(255,255,255,0.08)" : "rgba(15,15,20,0.07)",
      colorText: dark ? "#ececee" : "#1d1d1f",
      colorTextSecondary: dark ? "#a1a1a6" : "#5f5f66",
      colorTextTertiary: dark ? "#76767c" : "#8e8e94",
      colorFillTertiary: dark ? "rgba(255,255,255,0.06)" : "rgba(15,15,20,0.045)",
      colorFillSecondary: dark ? "rgba(255,255,255,0.09)" : "rgba(15,15,20,0.065)",
      fontFamily: font,
      fontFamilyCode: mono,
      fontSize: 14,
      borderRadius: 10,
      borderRadiusSM: 7,
      borderRadiusLG: 14,
      controlHeight: 34,
      controlHeightSM: 28,
      boxShadowSecondary: dark
        ? "0 10px 32px rgba(0,0,0,0.5), 0 1px 0 rgba(255,255,255,0.04) inset"
        : "0 12px 32px rgba(20,20,40,0.12), 0 2px 6px rgba(20,20,40,0.05)",
      motionDurationMid: "0.18s",
    },
    components: {
      Button: { fontWeight: 500, primaryShadow: "none", defaultShadow: "none", dangerShadow: "none" },
      Select: { optionSelectedFontWeight: 500 },
      Modal: { titleFontSize: 16 },
      Tooltip: { colorBgSpotlight: dark ? "#3a3a3f" : "#1d1d1f" },
    },
  };
}
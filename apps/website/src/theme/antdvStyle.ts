/**
 * antdv-style 统一入口
 * 复用 antdv-next 的 token 体系（500+ token），自动跟随 shadcnTheme 的 ConfigProvider
 * 无需手写 hex，组件样式通过 token 消费 CSS 变量，保持亮/暗一致
 */
import { createStyles as _createStyles } from "antdv-style";

/**
 * 业务层 createStyles 封装，便于后续统一扩展（如注入 brand 变量）
 * 用法： const { styles, cx } = useStyles()
 */
export const createStyles = _createStyles;

/**
 * 快捷：把 brand CSS 变量映射为 token 语义
 * 在组件内可通过 token.colorBgContainer / token.colorBorder 等直接消费，无需 var(--border)
 */
export const brandCssVars = {
  bg: "var(--background)",
  card: "var(--card)",
  border: "var(--border)",
  muted: "var(--muted)",
  mutedFg: "var(--muted-foreground)",
  primary: "var(--brand-primary)",
} as const;

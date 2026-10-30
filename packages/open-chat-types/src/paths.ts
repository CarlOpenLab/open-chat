/**
 * 项目目录路径归一化：去掉首尾空白与尾部分隔符，保留根目录（`/`、`C:\`）。
 * 网关持久化项目历史与前端展示共用，保证同一目录只记一条。
 */

/**
 * @description 归一化单个目录路径。
 * @param {unknown} value - 原始路径（非字符串视为空）
 * @returns {string} 归一化后的路径；无效输入返回空串
 */
export const normalizeDirectoryPath = (value: unknown): string => {
  if (typeof value !== "string") return "";
  const path = value.trim();
  if (!path) return "";
  if (/^\/+$/u.test(path)) return "/";
  if (/^\\+$/u.test(path)) return "\\";

  const driveRoot = path.match(/^([A-Za-z]:)([\\/]+)$/u);
  if (driveRoot) return `${driveRoot[1]}${driveRoot[2]?.[0] ?? "\\"}`;
  return path.replace(/[\\/]+$/u, "");
};

/**
 * @description 归一化并去重目录列表，保持首次出现的顺序。
 * @param {readonly unknown[]} values - 原始路径列表
 * @returns {string[]} 去重后的非空路径
 */
export const uniqueDirectoryPaths = (values: readonly unknown[]): string[] => {
  const paths: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const path = normalizeDirectoryPath(value);
    if (!path || seen.has(path)) continue;
    seen.add(path);
    paths.push(path);
  }
  return paths;
};

import { normalizeDirectoryPath } from "@cc-heart/open-chat-types";

/** 目录路径归一化：实现位于共享包，网关持久化与前端展示共用同一规则。 */
export { normalizeDirectoryPath, uniqueDirectoryPaths } from "@cc-heart/open-chat-types";

/** 取路径最后一级作为文件夹名称 */
export const projectPathName = (path: string): string => {
  const normalized = normalizeDirectoryPath(path);
  return normalized.split(/[\\/]/).filter(Boolean).pop() || normalized;
};

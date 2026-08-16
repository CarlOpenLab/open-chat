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

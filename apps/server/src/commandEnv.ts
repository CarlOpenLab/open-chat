import { accessSync, constants } from "node:fs";
import { delimiter, dirname, isAbsolute, join } from "node:path";

const COMMON_EXECUTABLE_DIRECTORIES = [
  ".local/bin",
  ".bun/bin",
  ".cargo/bin",
  ".local/share/mise/shims",
  ".volta/bin",
];

function executableSearchPaths(): string[] {
  const paths = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  const userHome = process.env.HOME;
  if (userHome) paths.push(...COMMON_EXECUTABLE_DIRECTORIES.map((path) => join(userHome, path)));
  paths.push("/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin");
  return [...new Set(paths)];
}

export function resolveExecutable(command: string): string | null {
  const value = command.trim();
  if (!value) return null;
  const candidates =
    isAbsolute(value) || value.includes("/")
      ? [value]
      : executableSearchPaths().map((directory) => join(directory, value));
  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Continue through the same PATH candidates a terminal would use.
    }
  }
  return null;
}

export function cliProcessEnv(executable: string): NodeJS.ProcessEnv {
  const directories = [dirname(executable), ...executableSearchPaths()];
  return { ...process.env, PATH: [...new Set(directories)].join(delimiter) };
}

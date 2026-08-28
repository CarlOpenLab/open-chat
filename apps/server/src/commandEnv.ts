import type { SpawnOptions } from "node:child_process";
import { accessSync, constants, realpathSync } from "node:fs";
import { delimiter, dirname, extname, isAbsolute, join } from "node:path";

const IS_WINDOWS = process.platform === "win32";

const COMMON_EXECUTABLE_DIRECTORIES = [
  ".local/bin",
  ".bun/bin",
  ".cargo/bin",
  ".local/share/mise/shims",
  ".volta/bin",
];

/**
 * cmd.exe 用 PATHEXT 为无扩展名的命令补全可执行扩展名；Node 的 spawn 不会做
 * 这一步。npm 全局安装的 CLI（codex / claude / pi 等）在 Windows 上只提供
 * `codex.cmd`（需要经 cmd.exe 启动）和无扩展名的 POSIX 脚本（CreateProcess
 * 无法直接执行），所以必须按 PATHEXT 顺序探测。
 */
const PATHEXT_EXTENSIONS = (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD")
  .split(";")
  .map((entry) => entry.trim())
  .filter(Boolean);

function executableSearchPaths(): string[] {
  const paths = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  const userHome = process.env.HOME || (IS_WINDOWS ? process.env.USERPROFILE : undefined);
  if (userHome) paths.push(...COMMON_EXECUTABLE_DIRECTORIES.map((path) => join(userHome, path)));
  if (IS_WINDOWS) {
    // npm 全局安装的 CLI shim 默认落在 %APPDATA%\npm。
    if (process.env.APPDATA) paths.push(join(process.env.APPDATA, "npm"));
    if (process.env.USERPROFILE) paths.push(join(process.env.USERPROFILE, ".codex", "bin"));
  } else {
    paths.push("/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin");
  }
  return [...new Set(paths)];
}

export function resolveExecutable(command: string): string | null {
  const value = command.trim();
  if (!value) return null;
  const bases =
    isAbsolute(value) || value.includes("/") || (IS_WINDOWS && value.includes("\\"))
      ? [value]
      : executableSearchPaths().map((directory) => join(directory, value));
  for (const base of bases) {
    // Windows 下无扩展名的命令：npm 安装的 CLI 只提供 `codex.cmd`（可 spawn）
    // 和无扩展名的 POSIX 脚本（CreateProcess 无法执行），按 PATHEXT 顺序探测，
    // 最后兜底裸名（可能是 junction 指向真实 PE）。
    const names =
      !IS_WINDOWS || extname(base)
        ? [base]
        : [...PATHEXT_EXTENSIONS.map((extension) => base + extension), base];
    for (const candidate of names) {
      try {
        accessSync(candidate, constants.X_OK);
        if (IS_WINDOWS) {
          // fnm_multishells\<pid>_<ts> 是每个 shell 的临时 junction 目录，
          // shell 退出即被删除。解析到真实路径，避免缓存路径随后 spawn 时
          // 已失效（ENOENT）。
          try {
            return realpathSync(candidate);
          } catch {
            return candidate;
          }
        }
        return candidate;
      } catch {
        // Continue through the same PATH candidates a terminal would use.
      }
    }
  }
  return null;
}

export function cliProcessEnv(executable: string): NodeJS.ProcessEnv {
  const directories = [dirname(executable), ...executableSearchPaths()];
  return { ...process.env, PATH: [...new Set(directories)].join(delimiter) };
}

/**
 * Windows 的 npm CLI shim 是 .cmd / .bat，不能被 CreateProcess 直接执行。
 * 通过 shell 交给 cmd.exe 执行，避免 spawn(EINVAL)。
 */
export function cliSpawnOptions(executable: string): Pick<SpawnOptions, "env" | "shell"> {
  const extension = extname(executable).toLowerCase();
  return {
    env: cliProcessEnv(executable),
    shell: IS_WINDOWS && (extension === ".cmd" || extension === ".bat"),
  };
}

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { platform } from "node:os";

const execFileAsync = promisify(execFile);
const PICKER_TIMEOUT_MS = 2 * 60 * 1000;

/** Open a directory chooser on the gateway host. This only works in a local desktop session. */
export async function pickProjectDirectory(): Promise<string | undefined> {
  switch (platform()) {
    case "darwin":
      return pickMacDirectory();
    case "win32":
      return pickWindowsDirectory();
    default:
      return pickLinuxDirectory();
  }
}

async function pickMacDirectory(): Promise<string | undefined> {
  const script = [
    "try",
    '  POSIX path of (choose folder with prompt "选择项目目录")',
    "on error number -128",
    '  return ""',
    "end try",
  ].join("\n");
  const { stdout } = await execFileAsync("osascript", ["-e", script], {
    timeout: PICKER_TIMEOUT_MS,
    maxBuffer: 16 * 1024,
  });
  return normalizePickerOutput(stdout);
}

async function pickWindowsDirectory(): Promise<string | undefined> {
  const script = [
    "Add-Type -AssemblyName System.Windows.Forms",
    "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
    '$dialog.Description = "选择项目目录"',
    "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { $dialog.SelectedPath }",
  ].join("; ");
  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    { timeout: PICKER_TIMEOUT_MS, maxBuffer: 16 * 1024 },
  );
  return normalizePickerOutput(stdout);
}

async function pickLinuxDirectory(): Promise<string | undefined> {
  const candidates = [
    ["zenity", ["--file-selection", "--directory", "--title=选择项目目录"]],
    ["kdialog", ["--getexistingdirectory", ".", "选择项目目录"]],
    ["yad", ["--file-selection", "--directory", "--title=选择项目目录"]],
  ] as const;
  let lastError: unknown;
  for (const [command, args] of candidates) {
    try {
      const { stdout } = await execFileAsync(command, args, {
        timeout: PICKER_TIMEOUT_MS,
        maxBuffer: 16 * 1024,
      });
      return normalizePickerOutput(stdout);
    } catch (error) {
      lastError = error;
      if (isPickerCancelled(error)) return undefined;
    }
  }
  throw new Error(
    lastError instanceof Error
      ? `未找到可用的系统目录选择器（需要 zenity、kdialog 或 yad）：${lastError.message}`
      : "未找到可用的系统目录选择器（需要 zenity、kdialog 或 yad）",
  );
}

function normalizePickerOutput(output: string): string | undefined {
  const value = output.trim();
  return value || undefined;
}

function isPickerCancelled(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === 1 || code === 130;
}

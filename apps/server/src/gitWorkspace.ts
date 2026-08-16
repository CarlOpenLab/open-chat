import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 15_000;

export interface GitWorkspaceInfo {
  isRepository: boolean;
  root?: string;
  currentBranch?: string;
  branches: string[];
  dirty: boolean;
  detached: boolean;
}

export async function readGitWorkspace(directory: string): Promise<GitWorkspaceInfo> {
  const inside = await runGit(directory, ["rev-parse", "--is-inside-work-tree"]).catch(() => "");
  if (inside !== "true") {
    return { isRepository: false, branches: [], dirty: false, detached: false };
  }

  const [root, currentBranch, branchOutput, status] = await Promise.all([
    runGit(directory, ["rev-parse", "--show-toplevel"]),
    runGit(directory, ["branch", "--show-current"]),
    runGit(directory, ["branch", "--format=%(refname:short)"]),
    runGit(directory, ["status", "--porcelain", "--untracked-files=normal"]),
  ]);
  const branches = branchOutput
    .split("\n")
    .map((branch) => branch.trim())
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));

  return {
    isRepository: true,
    root,
    currentBranch,
    branches,
    dirty: Boolean(status),
    detached: !currentBranch,
  };
}

export async function switchGitBranch(
  directory: string,
  branch: string,
): Promise<GitWorkspaceInfo> {
  const workspace = await readGitWorkspace(directory);
  if (!workspace.isRepository) throw new Error("所选目录不是 Git 仓库");
  if (!workspace.branches.includes(branch)) throw new Error(`本地分支不存在：${branch}`);
  if (workspace.currentBranch !== branch) await runGit(directory, ["switch", branch]);
  return readGitWorkspace(directory);
}

async function runGit(directory: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd: directory,
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: 1024 * 1024,
  });
  return stdout.trim();
}

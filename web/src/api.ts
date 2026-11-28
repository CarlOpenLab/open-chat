// The page's way to the Go host: mygo bindings inside the desktop app,
// HTTP + server-sent events in a browser (open-chat serve).
import { call as mygoCall, isMyGo, on as mygoOn, onFileDrop } from "mygo-runtime";
import type {
  AgentInfo,
  AgentUpdateChannel,
  AgentUpdateOptions,
  AgentUpdateReport,
  AgentUpdateResult,
  Block,
  Bootstrap,
  BotFiles,
  ConfigOption,
  Conversation,
  DirListing,
  GitInfo,
  LiveState,
  Meta,
  Push,
  Settings,
  SkillInfo,
  TermInfo,
  WorkspaceFileInfo,
  WorkspaceNode,
  WorktreeInfo,
  WorktreeStatus,
} from "./types";

export const inApp = isMyGo();

async function call<T>(method: string, ...args: unknown[]): Promise<T> {
  if (inApp) return mygoCall<T>(`Host.${method}`, ...args);
  const res = await fetch(`api/call/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(args),
    credentials: "same-origin",
  });
  const body = (await res.json().catch(() => ({ error: `HTTP ${res.status}` }))) as { result?: T; error?: string };
  if (!res.ok || body.error) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body.result as T;
}

export const api = {
  bootstrap: () => call<Bootstrap>("Bootstrap"),
  agents: () => call<AgentInfo[]>("Agents"),
  inspectAgentUpdates: (opts: AgentUpdateOptions = {}) => call<AgentUpdateReport>("InspectAgentUpdates", opts),
  upgradeAgents: (opts: AgentUpdateOptions = {}) => call<AgentUpdateReport>("UpgradeAgents", opts),
  installAgent: (agentId: string, channel: AgentUpdateChannel) => call<AgentUpdateResult>("InstallAgent", agentId, channel),
  uninstallAgent: (agentId: string) => call<AgentUpdateResult>("UninstallAgent", agentId),
  checkUpdates: () => call<void>("CheckUpdates"),
  probeModels: (agentId: string, cwd: string) => call<ConfigOption[]>("ProbeModels", agentId, cwd),
  refreshModels: (agentId: string, cwd: string) => call<ConfigOption[]>("RefreshModels", agentId, cwd),
  create: (agentId: string, cwd: string) => call<Meta>("Create", agentId, cwd),
  createWorktree: (agentId: string, repoDir: string, baseBranch = "", branchName = "", detach = false) =>
    call<Meta>("CreateWorktree", agentId, repoDir, baseBranch, branchName, detach),
  attachWorktree: (agentId: string, wtPath: string) => call<Meta>("AttachWorktree", agentId, wtPath),
  listWorktrees: (repoDir: string) => call<WorktreeInfo[]>("ListWorktrees", repoDir),
  worktreeStatus: (id: string) => call<WorktreeStatus>("WorktreeStatus", id),
  mergeWorktree: (id: string, strategy: "merge" | "squash", commitMsg = "", cleanup = false) =>
    call<void>("MergeWorktree", id, strategy, commitMsg, cleanup),
  removeWorktree: (id: string, force = false, deleteBranch = false) =>
    call<void>("RemoveWorktree", id, force, deleteBranch),
  removeWorktreeByPath: (wtPath: string, deleteBranch = false) =>
    call<void>("RemoveWorktreeByPath", wtPath, deleteBranch),
  open: (id: string) => call<Conversation>("Open", id),
  connect: (id: string) => call<LiveState>("Connect", id),
  send: (id: string, blocks: Block[]) => call<void>("Send", id, blocks),
  cancel: (id: string) => call<void>("Cancel", id),
  respond: (id: string, requestId: string, optionId: string) => call<void>("Respond", id, requestId, optionId),
  setMode: (id: string, modeId: string) => call<void>("SetMode", id, modeId),
  setConfig: (id: string, configId: string, value: string | boolean) => call<void>("SetConfig", id, configId, value),
  rename: (id: string, title: string) => call<Meta>("Rename", id, title),
  pin: (id: string, pinned: boolean) => call<Meta>("Pin", id, pinned),
  archive: (id: string, archived: boolean) => call<Meta>("Archive", id, archived),
  remove: (id: string) => call<void>("Delete", id),
  saveSettings: (s: Settings) => call<Settings>("SaveSettings", s),
  startBot: (botId: string, promptOverride = "") => call<Meta>("StartBot", botId, promptOverride),
  openBotChat: (botId: string) => call<Meta>("OpenBotChat", botId),
  getBotFiles: (botId: string) => call<BotFiles>("GetBotFiles", botId),
  saveBotFiles: (botId: string, soul: string, memory: string) => call<BotFiles>("SaveBotFiles", botId, soul, memory),
  listDir: (path: string) => call<DirListing>("ListDir", path),
  listSkills: (cwd: string) => call<SkillInfo[]>("ListSkills", cwd),
  gitInfo: (path: string) => call<GitInfo>("GitInfo", path),
  gitCheckout: (path: string, branch: string) => call<GitInfo>("GitCheckout", path, branch),
  gitCreateBranch: (path: string, branch: string) => call<GitInfo>("GitCreateBranch", path, branch),
  gitDeleteBranch: (path: string, branch: string, force = false) => call<GitInfo>("GitDeleteBranch", path, branch, force),
  pickFolder: () => call<string>("PickFolder"),
  reveal: (path: string) => call<void>("Reveal", path),
  openLink: (target: string, cwd: string) => call<void>("OpenLink", target, cwd),
  notify: (conversationId: string, title: string, subtitle: string, body: string, sound: boolean) =>
    call<void>("Notify", conversationId, title, subtitle, body, sound),
  workspaceTree: (cwd: string) => call<WorkspaceNode[]>("WorkspaceTree", cwd),
  workspaceReadFile: (cwd: string, relPath: string) => call<string>("WorkspaceReadFile", cwd, relPath),
  workspaceWriteFile: (cwd: string, relPath: string, content: string) =>
    call<void>("WorkspaceWriteFile", cwd, relPath, content),
  workspaceFileInfo: (cwd: string, relPath: string) => call<WorkspaceFileInfo>("WorkspaceFileInfo", cwd, relPath),
  workspaceCreate: (cwd: string, relPath: string, isDir: boolean) =>
    call<void>("WorkspaceCreate", cwd, relPath, isDir),
  workspaceRename: (cwd: string, oldRelPath: string, newRelPath: string) =>
    call<void>("WorkspaceRename", cwd, oldRelPath, newRelPath),
  workspaceDelete: (cwd: string, relPath: string) => call<void>("WorkspaceDelete", cwd, relPath),
  termCreate: (cwd: string, cols: number, rows: number) => call<TermInfo>("TermCreate", cwd, cols, rows),
  termWrite: (id: string, data: string) => call<void>("TermWrite", id, data),
  termResize: (id: string, cols: number, rows: number) => call<void>("TermResize", id, cols, rows),
  termClose: (id: string) => call<void>("TermClose", id),
};

/** Subscribes to the host's pushes. `onReconnect` runs after a dropped stream comes back. */
export function subscribe(listener: (p: Push) => void, onReconnect: () => void): () => void {
  if (inApp) return mygoOn<Push>("push", listener);
  let source: EventSource | null = null;
  let closed = false;
  let retry = 500;
  let opened = false;
  const connect = () => {
    source = new EventSource("api/push", { withCredentials: true });
    source.onopen = () => {
      if (opened) onReconnect();
      opened = true;
      retry = 500;
    };
    source.onmessage = (e) => {
      try {
        listener(JSON.parse(e.data) as Push);
      } catch {
        /* a malformed frame is skipped */
      }
    };
    source.onerror = () => {
      source?.close();
      if (closed) return;
      setTimeout(connect, retry);
      retry = Math.min(retry * 2, 8000);
    };
  };
  connect();
  return () => {
    closed = true;
    source?.close();
  };
}

/** File paths dropped on the window (desktop only; browsers don't tell paths). */
export function onDroppedPaths(listener: (paths: string[]) => void): () => void {
  if (!inApp) return () => {};
  return onFileDrop(({ paths }) => listener(paths));
}
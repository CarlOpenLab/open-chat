// The page's way to the Go host: mygo bindings inside the desktop app,
// HTTP + server-sent events in a browser (open-chat serve).
import { call as mygoCall, isMyGo, on as mygoOn, onFileDrop } from "mygo-runtime";
import type {
  AgentInfo,
  Block,
  Bootstrap,
  ConfigOption,
  Conversation,
  DirListing,
  GitInfo,
  LiveState,
  Meta,
  Push,
  Settings,
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
  probeModels: (agentId: string, cwd: string) => call<ConfigOption[]>("ProbeModels", agentId, cwd),
  create: (agentId: string, cwd: string) => call<Meta>("Create", agentId, cwd),
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
  listDir: (path: string) => call<DirListing>("ListDir", path),
  gitInfo: (path: string) => call<GitInfo>("GitInfo", path),
  gitCheckout: (path: string, branch: string) => call<GitInfo>("GitCheckout", path, branch),
  pickFolder: () => call<string>("PickFolder"),
  reveal: (path: string) => call<void>("Reveal", path),
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
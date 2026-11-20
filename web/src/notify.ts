import { onWindowActive, windowActive } from "mygo-runtime";
import { api, inApp } from "./api";
import type { Meta, Settings } from "./types";

let winFocused = typeof document !== "undefined" ? !document.hidden && document.hasFocus() : true;
let initialized = false;

export function initNotifications() {
  if (initialized || !inApp) return;
  initialized = true;
  try {
    winFocused = windowActive();
    onWindowActive((active) => {
      winFocused = active;
    });
  } catch {
    /* ignore if runtime bridge is unavailable */
  }
}

export function isWindowFocused(): boolean {
  if (!inApp) return true;
  try {
    return windowActive();
  } catch {
    return winFocused;
  }
}

export interface NotifyContext {
  conversationId: string;
  activeId: string | null;
  meta: Meta | undefined;
  settings: Settings | null;
  onSelect: (conversationId: string) => void;
}

export function notifyNeedYou(ctx: NotifyContext, detail?: string) {
  if (!inApp) return;
  if (ctx.settings && ctx.settings.notifyNeedYou === false) return;
  if (isWindowFocused() && ctx.activeId === ctx.conversationId) return;

  const convTitle = ctx.meta?.title || "新对话";
  const agentName = ctx.meta?.agentName || "Agent";
  const subtitle = `${convTitle} (${agentName})`;
  const body = detail?.trim() || "Agent 正在等待你的确认";
  const sound = ctx.settings?.notifySound !== false;

  void api.notify(ctx.conversationId, "需要你的确认", subtitle, body, sound).catch(() => {});
}

export function notifyTurnDone(ctx: NotifyContext, outcome: "done" | "error", errorMsg?: string) {
  if (!inApp) return;
  if (ctx.settings && ctx.settings.notifyTurnDone === false) return;
  if (isWindowFocused() && ctx.activeId === ctx.conversationId) return;

  const convTitle = ctx.meta?.title || "新对话";
  const agentName = ctx.meta?.agentName || "Agent";
  const isError = outcome === "error";
  const title = isError ? "执行出错" : "会话已完成";
  const subtitle = `${convTitle} (${agentName})`;
  const body = isError
    ? (errorMsg?.trim() || `${agentName} 在「${convTitle}」中执行出错`)
    : `${agentName} 已完成「${convTitle}」的回复`;
  const sound = ctx.settings?.notifySound !== false;

  void api.notify(ctx.conversationId, title, subtitle, body, sound).catch(() => {});
}

export async function sendTestNotification(sound: boolean) {
  if (!inApp) return;
  await api.notify("", "测试通知", "open-chat", "待确认（Need You）与会话完成提醒已就绪", sound);
}

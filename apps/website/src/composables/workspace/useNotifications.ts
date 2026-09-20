import { Notification as XNotification } from "@antdv-next/x";
import { message } from "antdv-next";
import { ref, type Ref } from "vue";
import type { OpenChatConversation } from "../useChatPersistence";

const TASK_COMPLETION_NOTIFICATIONS_KEY = "open-chat-task-completion-notifications";

/** 任务完成通知载荷：会话 key 用于去重 tag。 */
export interface TaskCompletionNotice {
  key: string;
  agentId: string;
  conversationKey: string;
}

export interface UseNotificationsDeps {
  conversationList: Ref<OpenChatConversation[]>;
}

/**
 * 浏览器系统通知：开关持久化、权限申请、测试通知与任务完成提醒。
 */
export function useNotifications(deps: UseNotificationsDeps) {
  const browserNotificationsSupported =
    typeof window !== "undefined" && typeof window.Notification !== "undefined";

  const readTaskCompletionNotificationsEnabled = () => {
    if (!browserNotificationsSupported) return false;
    try {
      return (
        localStorage.getItem(TASK_COMPLETION_NOTIFICATIONS_KEY) === "true" &&
        XNotification.permission === "granted"
      );
    } catch {
      return false;
    }
  };

  const taskCompletionNotificationsEnabled = ref(readTaskCompletionNotificationsEnabled());

  const persistTaskCompletionNotificationsEnabled = (enabled: boolean) => {
    try {
      localStorage.setItem(TASK_COMPLETION_NOTIFICATIONS_KEY, String(enabled));
    } catch {
      // Local storage may be unavailable in private browsing; keep the current session setting.
    }
  };

  const handleTaskCompletionNotificationsChange = async (enabled: boolean) => {
    if (!enabled) {
      taskCompletionNotificationsEnabled.value = false;
      persistTaskCompletionNotificationsEnabled(false);
      return;
    }

    if (!browserNotificationsSupported) {
      message.warning("当前浏览器不支持系统通知");
      return;
    }

    try {
      const permission = await XNotification.requestPermission();
      const granted = permission === "granted";
      taskCompletionNotificationsEnabled.value = granted;
      persistTaskCompletionNotificationsEnabled(granted);
      if (granted) {
        message.success("已开启任务完成通知");
      } else {
        message.warning("浏览器未允许通知，请在网站权限设置中开启");
      }
    } catch (error) {
      console.error("Failed to request browser notification permission:", error);
      taskCompletionNotificationsEnabled.value = false;
      persistTaskCompletionNotificationsEnabled(false);
      message.warning("无法请求浏览器通知权限");
    }
  };

  const handleTestTaskCompletionNotification = () => {
    if (
      !taskCompletionNotificationsEnabled.value ||
      !browserNotificationsSupported ||
      XNotification.permission !== "granted"
    ) {
      message.warning("请先开启任务完成通知并允许浏览器通知权限");
      return;
    }

    XNotification.open({
      title: "Open Chat · 测试通知",
      body: "如果你能看到这条系统通知，任务完成提醒已可以正常使用。",
      tag: "open-chat-task-completion-test",
      duration: 8,
      onClick: () => window.focus(),
    });
  };

  const showTaskCompletionNotification = (notice: TaskCompletionNotice) => {
    if (
      !taskCompletionNotificationsEnabled.value ||
      !browserNotificationsSupported ||
      XNotification.permission !== "granted"
    ) {
      return;
    }
    const conversation = deps.conversationList.value.find(
      (item) =>
        (item.agentId || "api") === notice.agentId && String(item.key) === notice.conversationKey,
    );
    const conversationTitle = String(conversation?.label ?? "").trim();
    XNotification.open({
      title: "Open Chat · 任务已完成",
      body:
        conversationTitle && conversationTitle !== "新对话"
          ? `${conversationTitle} 已完成，可以查看结果。`
          : "Agent 任务已完成，可以查看结果。",
      tag: notice.key,
      duration: 8,
      onClick: () => window.focus(),
    });
  };

  const notifyTaskCompletion = (notice: TaskCompletionNotice) => {
    showTaskCompletionNotification(notice);
  };

  return {
    browserNotificationsSupported,
    taskCompletionNotificationsEnabled,
    handleTaskCompletionNotificationsChange,
    handleTestTaskCompletionNotification,
    notifyTaskCompletion,
  };
}

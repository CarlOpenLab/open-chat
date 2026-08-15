/**
 * 会话日期分组：按时间把会话归入「今天 / 昨天 / 本周 / 本月 / 今年 / 更早」。
 */

type SessionDateGroup = "今天" | "昨天" | "本周" | "本月" | "今年" | "更早";

/** 分组展示顺序（置顶在前，由调用方单独处理） */
const DATE_GROUP_ORDER: SessionDateGroup[] = ["今天", "昨天", "本周", "本月", "今年", "更早"];

const DAY_MS = 24 * 60 * 60 * 1000;

const startOfDay = (date: Date) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
};

const startOfWeek = (date: Date) => {
  const d = startOfDay(date);
  const day = d.getDay(); // 0 = Sunday
  const diff = (day + 6) % 7; // Monday-first
  d.setDate(d.getDate() - diff);
  return d;
};

const startOfMonth = (date: Date) => {
  const d = startOfDay(date);
  d.setDate(1);
  return d;
};

const startOfYear = (date: Date) => {
  const d = startOfDay(date);
  d.setMonth(0, 1);
  return d;
};

function sessionDateGroupForDate(date: Date, today: Date = new Date()): SessionDateGroup {
  const target = startOfDay(date);
  const todayStart = startOfDay(today);

  if (target.getTime() === todayStart.getTime()) return "今天";
  if (target.getTime() === todayStart.getTime() - DAY_MS) return "昨天";
  if (target.getTime() >= startOfWeek(todayStart).getTime()) return "本周";
  if (target.getTime() >= startOfMonth(todayStart).getTime()) return "本月";
  if (target.getTime() >= startOfYear(todayStart).getTime()) return "今年";
  return "更早";
}

/**
 * 根据会话时间戳计算分组。无时间戳时回退到持久化的 group 字段
 * （旧数据可能是「今天」「置顶」等）。
 */
export function resolveConversationGroup(updatedAt?: number, storedGroup?: string): string {
  // 置顶优先于日期分组
  if (storedGroup === "置顶") return "置顶";
  if (updatedAt) {
    return sessionDateGroupForDate(new Date(updatedAt));
  }
  if (storedGroup && (DATE_GROUP_ORDER as string[]).includes(storedGroup)) {
    return storedGroup;
  }
  return "今天";
}

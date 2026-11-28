// Standard 5-field Unix Cron + legacy ("daily HH:MM" / "every 30m") schedule utilities
// for BotSchedulePicker and Bot card human-readable previews.

export interface ParsedCron {
  min: Set<number>;
  hour: Set<number>;
  dom: Set<number>;
  month: Set<number>;
  dow: Set<number>;
  raw: string;
}

const WEEKDAY_NAMES = ["日", "一", "二", "三", "四", "五", "六"];

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function parseField(expr: string, minVal: number, maxVal: number, allowSunday7 = false): Set<number> | null {
  const trimmed = expr.trim();
  if (!trimmed) return null;
  const out = new Set<number>();
  for (const rawPart of trimmed.split(",")) {
    const part = rawPart.trim();
    if (!part) return null;
    let step = 1;
    let rangeExpr = part;
    if (part.includes("/")) {
      const pieces = part.split("/");
      if (pieces.length !== 2) return null;
      const s = Number(pieces[1]);
      if (!Number.isInteger(s) || s <= 0) return null;
      step = s;
      rangeExpr = pieces[0];
    }
    let lo: number;
    let hi: number;
    if (rangeExpr === "*") {
      lo = minVal;
      hi = allowSunday7 && maxVal === 7 ? 6 : maxVal;
    } else if (rangeExpr.includes("-")) {
      const bounds = rangeExpr.split("-");
      if (bounds.length !== 2) return null;
      const a = Number(bounds[0]);
      const b = Number(bounds[1]);
      if (!Number.isInteger(a) || !Number.isInteger(b) || a < minVal || b > maxVal || a > b) return null;
      lo = a;
      hi = b;
    } else {
      const v = Number(rangeExpr);
      if (!Number.isInteger(v) || v < minVal || v > maxVal) return null;
      if (part.includes("/")) {
        lo = v;
        hi = allowSunday7 && maxVal === 7 ? 6 : maxVal;
      } else {
        lo = v;
        hi = v;
      }
    }
    for (let v = lo; v <= hi; v += step) {
      out.add(allowSunday7 && v === 7 ? 0 : v);
    }
  }
  return out.size > 0 ? out : null;
}

/** Converts legacy "daily HH:MM" / "every Xm/Xh" strings into 5-field Unix Cron where representable. */
export function normalizeToCron(spec?: string): string {
  const s = (spec ?? "").trim();
  if (!s) return "";
  const parts = s.split(/\s+/);
  if (parts.length === 5) return parts.join(" ");
  if (parts.length === 2) {
    const kind = parts[0].toLowerCase();
    const arg = parts[1];
    if (kind === "daily") {
      const hm = arg.split(":");
      if (hm.length === 2) {
        const hh = Number(hm[0]);
        const mm = Number(hm[1]);
        if (Number.isInteger(hh) && Number.isInteger(mm) && hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) {
          return `${mm} ${hh} * * *`;
        }
      }
    }
    if (kind === "every") {
      const mMatch = /^(\d+)m$/i.exec(arg);
      if (mMatch) {
        const mins = Number(mMatch[1]);
        if (mins >= 1 && mins <= 59) return `*/${mins} * * * *`;
      }
      const hMatch = /^(\d+)h$/i.exec(arg);
      if (hMatch) {
        const hrs = Number(hMatch[1]);
        if (hrs >= 1 && hrs <= 23) return `0 */${hrs} * * *`;
      }
    }
  }
  return s;
}

export function parseCron(spec?: string): ParsedCron | null {
  const norm = normalizeToCron(spec);
  if (!norm) return null;
  const fields = norm.split(/\s+/);
  if (fields.length !== 5) return null;
  const min = parseField(fields[0], 0, 59, false);
  const hour = parseField(fields[1], 0, 23, false);
  const dom = parseField(fields[2], 1, 31, false);
  const month = parseField(fields[3], 1, 12, false);
  const dow = parseField(fields[4], 0, 7, true);
  if (!min || !hour || !dom || !month || !dow) return null;
  return { min, hour, dom, month, dow, raw: norm };
}

export function validateSchedule(spec?: string): { valid: boolean; error?: string } {
  const s = (spec ?? "").trim();
  if (!s) return { valid: true };
  if (parseCron(s)) return { valid: true };
  // Also allow legacy "every <duration>" like "every 90m" or "every 1h30m"
  if (/^every\s+(\d+h)?(\d+m)?$/i.test(s) && /\d/.test(s)) return { valid: true };
  return { valid: false, error: "请输入有效的 5 位 Cron 表达式（分 时 日 月 周），如 0 9 * * *" };
}

function formatWeekdays(dows: number[]): string {
  const sorted = [...new Set(dows)].sort((a, b) => a - b);
  if (sorted.length === 7) return "每天";
  const key = sorted.join(",");
  if (key === "1,2,3,4,5") return "工作日";
  if (key === "0,6") return "周末";
  // Order Mon..Sat, Sun for natural Chinese reading
  const ordered = [...sorted.filter((d) => d !== 0), ...(sorted.includes(0) ? [0] : [])];
  return `每周${ordered.map((d) => WEEKDAY_NAMES[d]).join("、")}`;
}

export function describeSchedule(spec?: string): string {
  const s = (spec ?? "").trim();
  if (!s) return "";
  const norm = normalizeToCron(s);
  const fields = norm.split(/\s+/);
  if (fields.length !== 5) {
    if (s.toLowerCase().startsWith("every ")) return `每 ${s.slice(6).trim()}`;
    return s;
  }
  const [fMin, fHour, fDom, fMonth, fDow] = fields;
  const parsed = parseCron(norm);
  if (!parsed) return s;

  // Every N minutes: "*/N * * * *"
  const everyMin = /^\*\/(\d+)$/.exec(fMin);
  if (everyMin && fHour === "*" && fDom === "*" && fMonth === "*" && fDow === "*") {
    return `每 ${everyMin[1]} 分钟`;
  }
  if (fMin === "*" && fHour === "*" && fDom === "*" && fMonth === "*" && fDow === "*") {
    return "每分钟";
  }

  // Every N hours: "0 */N * * *" or "M */N * * *"
  const everyHour = /^\*\/(\d+)$/.exec(fHour);
  if (everyHour && /^\d+$/.test(fMin) && fDom === "*" && fMonth === "*" && fDow === "*") {
    return fMin === "0" ? `每 ${everyHour[1]} 小时` : `每 ${everyHour[1]} 小时（第 ${fMin} 分）`;
  }

  // Fixed HH:MM daily or weekly
  if (/^\d+$/.test(fMin) && /^\d+$/.test(fHour) && fDom === "*" && fMonth === "*") {
    const hm = `${pad2(Number(fHour))}:${pad2(Number(fMin))}`;
    if (fDow === "*") return `每天 ${hm}`;
    return `${formatWeekdays([...parsed.dow])} ${hm}`;
  }

  // Monthly fixed day
  if (/^\d+$/.test(fMin) && /^\d+$/.test(fHour) && /^\d+$/.test(fDom) && fMonth === "*" && fDow === "*") {
    return `每月 ${fDom} 日 ${pad2(Number(fHour))}:${pad2(Number(fMin))}`;
  }

  return `Cron: ${norm}`;
}

/** Computes the next matching local Date strictly after `from` (searches up to 366 days). */
export function nextRunDate(spec?: string, from = new Date()): Date | null {
  const parsed = parseCron(spec);
  if (!parsed) return null;
  const d = new Date(from.getTime());
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1);

  const maxMinutes = 366 * 24 * 60;
  for (let i = 0; i < maxMinutes; i++) {
    if (!parsed.month.has(d.getMonth() + 1)) {
      d.setMonth(d.getMonth() + 1, 1);
      d.setHours(0, 0, 0, 0);
      continue;
    }
    if (!parsed.dom.has(d.getDate()) || !parsed.dow.has(d.getDay())) {
      d.setDate(d.getDate() + 1);
      d.setHours(0, 0, 0, 0);
      continue;
    }
    if (!parsed.hour.has(d.getHours())) {
      d.setHours(d.getHours() + 1, 0, 0, 0);
      continue;
    }
    if (!parsed.min.has(d.getMinutes())) {
      d.setMinutes(d.getMinutes() + 1, 0, 0);
      continue;
    }
    return d;
  }
  return null;
}

export function formatNextRun(spec?: string, now = new Date()): string {
  const next = nextRunDate(spec, now);
  if (!next) return "";
  const hm = `${pad2(next.getHours())}:${pad2(next.getMinutes())}`;
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startNext = new Date(next.getFullYear(), next.getMonth(), next.getDate()).getTime();
  const diffDays = Math.round((startNext - startToday) / 86_400_000);
  if (diffDays === 0) return `今天 ${hm}`;
  if (diffDays === 1) return `明天 ${hm}`;
  if (diffDays === 2) return `后天 ${hm}`;
  if (diffDays < 7) return `周${WEEKDAY_NAMES[next.getDay()]} ${hm}`;
  return `${next.getMonth() + 1}月${next.getDate()}日 ${hm}`;
}

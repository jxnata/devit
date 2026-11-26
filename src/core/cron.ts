import { DevitError } from "./errors.ts";

/**
 * Five-field cron (minute hour day-of-month month day-of-week) in the machine's local time
 * (set TZ to change it). Supports `*`, lists, ranges, steps, month and day names, and the
 * aliases @hourly, @daily, @weekly, @monthly, @yearly. Like Vixie cron, when both day fields
 * are restricted a time matches either of them.
 */
export interface Cron {
  source: string;
  minutes: Set<number>;
  hours: Set<number>;
  days: Set<number>;
  months: Set<number>;
  weekdays: Set<number>;
  /** Day-of-month / day-of-week were restricted (not `*`). */
  daysRestricted: boolean;
  weekdaysRestricted: boolean;
}

const ALIASES: Record<string, string> = {
  "@hourly": "0 * * * *",
  "@daily": "0 0 * * *",
  "@midnight": "0 0 * * *",
  "@weekly": "0 0 * * 0",
  "@monthly": "0 0 1 * *",
  "@yearly": "0 0 1 1 *",
  "@annually": "0 0 1 1 *",
};
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

const FIELDS = [
  { name: "minute", min: 0, max: 59 },
  { name: "hour", min: 0, max: 23 },
  { name: "day of month", min: 1, max: 31 },
  { name: "month", min: 1, max: 12, names: MONTHS, offset: 1 },
  { name: "day of week", min: 0, max: 7, names: WEEKDAYS, offset: 0 },
] as const;

function parseField(text: string, index: number, source: string): Set<number> {
  const field = FIELDS[index]!;
  const bad = (why: string) =>
    new DevitError(`invalid cron "${source}": ${field.name} "${text}" ${why}`, 'e.g. "0 9 * * 1" is Mondays at 09:00');
  const value = (v: string): number => {
    const names = "names" in field ? field.names : null;
    const named = names ? (names as readonly string[]).indexOf(v.toLowerCase()) : -1;
    const n = named >= 0 ? named + ("offset" in field ? field.offset : 0) : /^\d+$/.test(v) ? Number(v) : NaN;
    if (!Number.isInteger(n) || n < field.min || n > field.max) throw bad(`is out of range ${field.min}-${field.max}`);
    return n;
  };
  const out = new Set<number>();
  for (const part of text.split(",")) {
    const [range, stepText, extra] = part.split("/");
    if (extra !== undefined || !range) throw bad("is malformed");
    const step = stepText === undefined ? 1 : Number(stepText);
    if (!Number.isInteger(step) || step < 1) throw bad("has a bad step");
    let lo: number;
    let hi: number;
    if (range === "*") {
      lo = field.min;
      hi = index === 4 ? 6 : field.max;
    } else if (range.includes("-")) {
      const [a, b] = range.split("-");
      lo = value(a ?? "");
      hi = value(b ?? "");
      if (lo > hi) throw bad("has a backwards range");
    } else {
      lo = value(range);
      hi = stepText === undefined ? lo : field.max;
    }
    for (let n = lo; n <= hi; n += step) out.add(index === 4 && n === 7 ? 0 : n);
  }
  return out;
}

export function parseCron(source: string): Cron {
  const text = source.trim();
  const expanded = ALIASES[text.toLowerCase()] ?? text;
  const parts = expanded.split(/\s+/);
  if (parts.length !== 5) {
    throw new DevitError(`invalid cron "${source}": expected 5 fields, got ${parts.length}`, "minute hour day-of-month month day-of-week, e.g. \"0 9 * * 1\"");
  }
  const sets = parts.map((p, i) => parseField(p, i, source));
  return {
    source: text,
    minutes: sets[0]!,
    hours: sets[1]!,
    days: sets[2]!,
    months: sets[3]!,
    weekdays: sets[4]!,
    daysRestricted: parts[2] !== "*",
    weekdaysRestricted: parts[4] !== "*",
  };
}

function dayMatches(cron: Cron, d: Date): boolean {
  const dom = cron.days.has(d.getDate());
  const dow = cron.weekdays.has(d.getDay());
  if (cron.daysRestricted && cron.weekdaysRestricted) return dom || dow;
  return dom && dow;
}

/** The first matching minute strictly after `after`. */
export function nextRun(cron: Cron, after: Date): Date {
  const d = new Date(after.getTime());
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1);
  const limit = after.getTime() + 5 * 366 * 86_400_000;
  while (d.getTime() <= limit) {
    if (!cron.months.has(d.getMonth() + 1)) {
      d.setMonth(d.getMonth() + 1, 1);
      d.setHours(0, 0, 0, 0);
      continue;
    }
    if (!dayMatches(cron, d)) {
      d.setDate(d.getDate() + 1);
      d.setHours(0, 0, 0, 0);
      continue;
    }
    if (!cron.hours.has(d.getHours())) {
      d.setHours(d.getHours() + 1, 0, 0, 0);
      continue;
    }
    if (!cron.minutes.has(d.getMinutes())) {
      d.setMinutes(d.getMinutes() + 1, 0, 0);
      continue;
    }
    return d;
  }
  throw new DevitError(`cron "${cron.source}" never matches`);
}

/** A short English reading of common schedules, falling back to the expression. */
export function describeCron(cron: Cron): string {
  const [m, h, dom, mon, dow] = (ALIASES[cron.source.toLowerCase()] ?? cron.source).split(/\s+/);
  const time = /^\d+$/.test(m!) && /^\d+$/.test(h!) ? `${h!.padStart(2, "0")}:${m!.padStart(2, "0")}` : null;
  if (!time || mon !== "*") return cron.source;
  const names = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];
  if (dom === "*" && dow === "*") return `daily at ${time}`;
  if (dom === "*" && dow === "1-5") return `weekdays at ${time}`;
  if (dom === "*" && cron.weekdays.size === 1) return `${names[[...cron.weekdays][0]!]} at ${time}`;
  if (dow === "*" && /^\d+$/.test(dom!)) return `day ${dom} of each month at ${time}`;
  return cron.source;
}

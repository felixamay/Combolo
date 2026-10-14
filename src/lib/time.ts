/**
 * Timezone-aware calendar helpers (no external dependency, DST-safe via Intl).
 * The combo window is "now .. end of the last calendar day of the window" in the user's timezone
 * (today = day 1, tomorrow = day 2, day after = day 3). Combos are same-day: the window is today only.
 */

export const WINDOW_DAYS: 1 | 2 | 3 = 1;

/** How the window reads in copy: "Only 5 eligible matches today", "Sports today". */
export const WINDOW_PHRASE = WINDOW_DAYS === 1 ? "today" : `in the next ${WINDOW_DAYS} days`;

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function resolveTimeZone(tz: string | undefined | null, fallback: string): string {
  return tz && isValidTimeZone(tz) ? tz : fallback;
}

interface Parts {
  y: number;
  m: number;
  d: number;
  h: number;
  mi: number;
  s: number;
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    fmtCache.set(tz, f);
  }
  return f;
}

export function zonedParts(date: Date, tz: string): Parts {
  const out: Record<string, number> = {};
  for (const p of formatter(tz).formatToParts(date)) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return { y: out.year, m: out.month, d: out.day, h: out.hour % 24, mi: out.minute, s: out.second };
}

/** Offset (ms) such that localWallClock = utc + offset. */
function tzOffsetMs(utcMs: number, tz: string): number {
  const p = zonedParts(new Date(utcMs), tz);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/** Convert a wall-clock time in `tz` to the UTC instant. Handles DST gaps/overlaps deterministically. */
export function zonedTimeToUtc(y: number, m: number, d: number, h: number, mi: number, s: number, tz: string): Date {
  const guess = Date.UTC(y, m - 1, d, h, mi, s);
  let utc = guess - tzOffsetMs(guess, tz);
  const off2 = tzOffsetMs(utc, tz);
  utc = guess - off2;
  return new Date(utc);
}

/** Start (00:00 local) of the calendar day `offsetDays` after the local day containing `date`. */
export function startOfLocalDay(date: Date, tz: string, offsetDays = 0): Date {
  const p = zonedParts(date, tz);
  const base = new Date(Date.UTC(p.y, p.m - 1, p.d + offsetDays));
  return zonedTimeToUtc(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate(), 0, 0, 0, tz);
}

export function localDateKey(date: Date, tz: string): string {
  const p = zonedParts(date, tz);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

export interface DayWindow {
  day: 1 | 2 | 3;
  /** Inclusive start (for day 1 this is "now"). */
  start: Date;
  /** Exclusive end (local midnight). */
  end: Date;
  dateKey: string;
}

export interface ComboWindow {
  tz: string;
  now: Date;
  /** Exclusive end of the window's last calendar day. */
  end: Date;
  days: DayWindow[];
}

export function getComboWindow(now: Date, tz: string, windowDays: 1 | 2 | 3 = WINDOW_DAYS): ComboWindow {
  const days: DayWindow[] = [];
  for (let i = 0; i < windowDays; i++) {
    const dayStart = startOfLocalDay(now, tz, i);
    const dayEnd = startOfLocalDay(now, tz, i + 1);
    days.push({
      day: (i + 1) as 1 | 2 | 3,
      start: i === 0 ? now : dayStart,
      end: dayEnd,
      dateKey: localDateKey(dayStart, tz),
    });
  }
  return { tz, now, end: days[windowDays - 1].end, days };
}

/** True when the match is still to start and starts before the end of the window (local). */
export function isInWindow(startsAt: Date, window: ComboWindow): boolean {
  return startsAt.getTime() > window.now.getTime() && startsAt.getTime() < window.end.getTime();
}

/** 1, 2 or 3 when the kick-off falls on that local calendar day inside the window, otherwise null. */
export function dayIndexOf(startsAt: Date, window: ComboWindow): 1 | 2 | 3 | null {
  if (!isInWindow(startsAt, window)) return null;
  for (const d of window.days) {
    if (startsAt.getTime() >= d.start.getTime() && startsAt.getTime() < d.end.getTime()) return d.day;
  }
  return null;
}

/** UTC calendar dates (YYYY-MM-DD) that must be queried to cover the window in *any* timezone. */
export function utcDatesCoveringWindow(now: Date, extraDaysBack = 0): string[] {
  const out: string[] = [];
  for (let i = -extraDaysBack; i <= WINDOW_DAYS; i++) {
    out.push(new Date(now.getTime() + i * 86400000).toISOString().slice(0, 10));
  }
  return out;
}

export function formatInTz(date: Date, tz: string, opts: Intl.DateTimeFormatOptions = {}): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    ...opts,
  }).format(date);
}

export function timeAgo(date: Date | null | undefined, now = new Date()): string {
  if (!date) return "never";
  const s = Math.max(0, Math.round((now.getTime() - date.getTime()) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60 ? `${m % 60}m ` : ""}ago`.replace("  ", " ");
  return `${Math.floor(h / 24)}d ago`;
}

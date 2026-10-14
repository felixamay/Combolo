export function num(x: unknown): number | null {
  if (typeof x === "number" && Number.isFinite(x)) return x;
  if (typeof x === "string" && x.trim() !== "" && Number.isFinite(Number(x))) return Number(x);
  return null;
}

export function obj(x: unknown): Record<string, unknown> | null {
  return x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : null;
}

export function str(x: unknown): string | null {
  return typeof x === "string" && x.trim() !== "" ? x.trim() : null;
}

/** Score that may be a plain number or an object with `total`. */
export function scoreOf(x: unknown): number | null {
  const direct = num(x);
  if (direct !== null) return direct;
  const o = obj(x);
  if (!o) return null;
  return num(o.total) ?? num(o.current) ?? num(o.final);
}

export function parseDate(s: unknown): Date | null {
  if (typeof s !== "string" && typeof s !== "number") return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "2 - 1" style score strings. */
export function parseScoreString(s: unknown): { home: number; away: number } | null {
  if (typeof s !== "string") return null;
  const m = s.match(/^\s*(\d+)\s*[-:–]\s*(\d+)\s*$/);
  return m ? { home: Number(m[1]), away: Number(m[2]) } : null;
}

export function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

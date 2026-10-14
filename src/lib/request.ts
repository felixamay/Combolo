import { cookies } from "next/headers";
import { getEnv } from "./env";
import { resolveTimeZone } from "./time";

export const TZ_COOKIE = "combolo_tz";
export const AGE_COOKIE = "combolo_age_ok";

/** The viewer's timezone (cookie) or the configured default. Invalid values fall back safely. */
export async function getTz(): Promise<string> {
  const store = await cookies();
  return resolveTimeZone(store.get(TZ_COOKIE)?.value, getEnv().DEFAULT_TIMEZONE);
}

export async function ageGateRequired(): Promise<boolean> {
  if (!getEnv().AGE_GATE_ENABLED) return false;
  const store = await cookies();
  return store.get(AGE_COOKIE)?.value !== "1";
}

export function single(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export function list(v: string | string[] | undefined): string[] {
  const raw = Array.isArray(v) ? v : v ? [v] : [];
  return raw.flatMap((x) => x.split(",")).filter(Boolean);
}

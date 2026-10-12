import type { ZodType } from "zod";
import { prisma } from "../db";
import { log } from "../log";
import type { QuotaBucket } from "../quota/manager";
import { getQuotaManager, bucketsFor, type ProviderId } from "../quota/rules";

export class QuotaDeniedError extends Error {
  constructor(
    message: string,
    public readonly reason: string,
    public readonly retryAfterMs: number | null,
  ) {
    super(message);
    this.name = "QuotaDeniedError";
  }
}

export class ProviderHttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body?: string,
  ) {
    super(message);
    this.name = "ProviderHttpError";
  }
}

export class ProviderValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderValidationError";
  }
}

export interface RemainingInfo {
  day?: { remaining: number; limit?: number };
  month?: { remaining: number; limit?: number };
  minuteRemaining?: number;
}

export interface CallOptions<T> {
  provider: ProviderId;
  scope: string;
  url: string;
  endpoint: string;
  query?: Record<string, string | number | undefined>;
  headers?: Record<string, string>;
  schema: ZodType<T>;
  cost?: number;
  /** Max time (ms) to sleep when only the rolling per-minute window blocks the call. */
  maxWaitMs?: number;
  parseRemaining?: (headers: Headers) => RemainingInfo;
  /** Provider-level error detection on an HTTP 200 body (e.g. API-Sports `errors`). */
  detectError?: (json: unknown) => string | null;
  timeoutMs?: number;
  /** Query keys that must never be written to the log. */
  secretQueryKeys?: string[];
}

export interface CallResult<T> {
  data: T;
  status: number;
  headers: Headers;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function redact(query: Record<string, string | number | undefined>, secrets: string[]): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined) continue;
    parts.push(`${k}=${secrets.includes(k) ? "***" : v}`);
  }
  return parts.join("&");
}

async function writeLog(entry: {
  provider: string;
  scope: string;
  endpoint: string;
  params?: string;
  httpStatus?: number;
  ok: boolean;
  durationMs: number;
  error?: string;
  remainingDay?: number;
  remainingMinute?: number;
}) {
  try {
    await prisma.apiCallLog.create({ data: { ...entry, error: entry.error?.slice(0, 1000) } });
  } catch (e) {
    log.error("failed to write ApiCallLog", e);
  }
}

/**
 * The single entry point for every outbound provider request:
 * quota reservation -> HTTP -> header sync -> Zod validation -> audit log.
 */
export async function callProvider<T>(opts: CallOptions<T>): Promise<CallResult<T>> {
  const buckets: QuotaBucket[] = bucketsFor(opts.provider, opts.scope);
  const quota = getQuotaManager();
  const secrets = opts.secretQueryKeys ?? ["apiKey", "APIkey", "APIKey", "key"];
  const paramsForLog = opts.query ? redact(opts.query, secrets) : undefined;
  const cost = opts.cost ?? 1;
  const deadline = Date.now() + (opts.maxWaitMs ?? 0);

  for (;;) {
    const res = await quota.acquire(buckets, cost);
    if (res.ok) break;
    const canWait = res.reason === "minute" && res.retryAfterMs != null && Date.now() + res.retryAfterMs <= deadline;
    if (canWait) {
      await sleep(res.retryAfterMs!);
      continue;
    }
    await writeLog({ provider: opts.provider, scope: opts.scope, endpoint: opts.endpoint, params: paramsForLog, ok: false, durationMs: 0, error: `quota refused: ${res.message}` });
    throw new QuotaDeniedError(res.message, res.reason, res.retryAfterMs);
  }

  const url = new URL(opts.url);
  for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));

  const started = Date.now();
  let status: number | undefined;
  let remainingDay: number | undefined;
  let remainingMinute: number | undefined;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 25000);
    let response: Response;
    try {
      response = await fetch(url, { headers: { accept: "application/json", ...opts.headers }, signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
    status = response.status;

    const info = opts.parseRemaining?.(response.headers);
    if (info) {
      remainingDay = info.day?.remaining ?? info.month?.remaining;
      remainingMinute = info.minuteRemaining;
      if (info.day) await quota.reportRemaining(buckets[0], "day", info.day.remaining, info.day.limit);
      if (info.month) await quota.reportRemaining(buckets[0], "month", info.month.remaining, info.month.limit);
      if (info.minuteRemaining === 0) {
        const minuteBucket = buckets.find((b) => b.rules.some((r) => r.window === "minute"));
        if (minuteBucket) await quota.exhaust(minuteBucket, "minute");
      }
    }

    if (response.status === 429) {
      const dayBucket = buckets.find((b) => b.rules.some((r) => r.window === "day"));
      const minuteBucket = buckets.find((b) => b.rules.some((r) => r.window === "minute"));
      const body = await response.text();
      if (/day|daily|quota/i.test(body) && dayBucket) await quota.exhaust(dayBucket, "day");
      else if (minuteBucket) await quota.exhaust(minuteBucket, "minute");
      throw new ProviderHttpError(`${opts.provider} rate limited (429)`, 429, body.slice(0, 300));
    }

    const text = await response.text();
    if (!response.ok) throw new ProviderHttpError(`${opts.provider} HTTP ${response.status}: ${text.slice(0, 200)}`, response.status, text.slice(0, 500));

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new ProviderValidationError(`${opts.provider} returned non-JSON body`);
    }

    const providerError = opts.detectError?.(json);
    if (providerError) {
      if (/limit|quota|too many/i.test(providerError)) {
        const dayBucket = buckets.find((b) => b.rules.some((r) => r.window === "day"));
        if (dayBucket && /day|daily|quota|request limit/i.test(providerError)) await quota.exhaust(dayBucket, "day");
      }
      throw new ProviderHttpError(`${opts.provider} error: ${providerError}`, response.status, text.slice(0, 500));
    }

    const parsed = opts.schema.safeParse(json);
    if (!parsed.success) {
      const issues = parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      throw new ProviderValidationError(`${opts.provider} ${opts.endpoint} malformed response rejected: ${issues}`);
    }

    await writeLog({ provider: opts.provider, scope: opts.scope, endpoint: opts.endpoint, params: paramsForLog, httpStatus: status, ok: true, durationMs: Date.now() - started, remainingDay, remainingMinute });
    return { data: parsed.data, status, headers: response.headers };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await writeLog({ provider: opts.provider, scope: opts.scope, endpoint: opts.endpoint, params: paramsForLog, httpStatus: status, ok: false, durationMs: Date.now() - started, error: message, remainingDay, remainingMinute });
    throw err;
  }
}

export function headerInt(h: Headers, name: string): number | undefined {
  const v = h.get(name);
  if (v == null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Validate an array of rows individually: malformed rows are rejected and logged, the valid ones
 * are returned (a single bad row never discards a whole day of fixtures).
 */
export async function validateRows<T>(provider: string, endpoint: string, rows: unknown[], schema: ZodType<T>): Promise<T[]> {
  const out: T[] = [];
  let rejected = 0;
  let firstIssue = "";
  for (const row of rows) {
    const r = schema.safeParse(row);
    if (r.success) out.push(r.data);
    else {
      rejected++;
      if (!firstIssue) firstIssue = r.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    }
  }
  if (rejected > 0) {
    log.warn(`${provider} ${endpoint}: rejected ${rejected}/${rows.length} malformed rows (${firstIssue})`);
    await writeLog({ provider, scope: "validation", endpoint, ok: false, durationMs: 0, error: `rejected ${rejected}/${rows.length} malformed rows: ${firstIssue}` });
  }
  return out;
}

import { prisma } from "../lib/db";
import { log } from "../lib/log";
import { QuotaDeniedError } from "../lib/providers/http";

export interface JobContext {
  now: Date;
  /** Extra per-run knobs (e.g. bootstrap raises backfill budgets on first setup). */
  bootstrap?: boolean;
  /** Absolute deadline (ms epoch) so serverless invocations can stop gracefully. */
  deadline?: number;
}

export interface JobResult {
  summary: Record<string, unknown>;
  errors: string[];
}

export function outOfTime(ctx: JobContext): boolean {
  return ctx.deadline !== undefined && Date.now() > ctx.deadline;
}

export function startOfUtcDay(d = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Number of real provider requests made today (UTC) matching a provider / scope / endpoint fragment. */
export async function usedToday(provider: string, scope: string | null, endpointContains?: string): Promise<number> {
  return prisma.apiCallLog.count({
    where: {
      provider,
      ...(scope ? { scope } : {}),
      ...(endpointContains ? { endpoint: { contains: endpointContains } } : {}),
      httpStatus: { not: null },
      calledAt: { gte: startOfUtcDay() },
    },
  });
}

/** Run a provider task; quota refusals and API errors are collected, never thrown, so one failure does not abort the job. */
export async function attempt<T>(label: string, errors: string[], fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    errors.push(`${label}: ${msg}`);
    if (e instanceof QuotaDeniedError) log.warn(`${label}: ${msg}`);
    else log.error(`${label}: ${msg}`);
    return undefined;
  }
}

export function isQuotaDenied(e: unknown): boolean {
  return e instanceof QuotaDeniedError;
}

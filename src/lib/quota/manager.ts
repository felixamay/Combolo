/**
 * Central quota manager. Every outbound provider call must go through `acquire()`, which refuses
 * (never queues silently) when the call would exceed any configured limit.
 *
 *  - minute windows are ROLLING (timestamps of the last 60 s) so a burst across a clock-minute
 *    boundary can never exceed the provider's per-minute limit;
 *  - day / month windows are fixed UTC windows (providers reset at 00:00 UTC / 1st of month);
 *  - limits reported by the provider in response headers can only ever *tighten* the local count.
 */

import { AsyncLocalStorage } from "node:async_hooks";

export type WindowType = "minute" | "day" | "month";

export interface QuotaRule {
  window: WindowType;
  limit: number;
  /** Calls always kept unused in this window (safety margin). Ignored for minute windows. */
  reserve?: number;
}

export interface QuotaBucket {
  key: string;
  rules: QuotaRule[];
}

export interface QuotaState {
  windowStart: Date;
  used: number;
  limit: number;
  stamps: number[];
  reportedRemaining: number | null;
}

export interface QuotaTx {
  get(window: WindowType): Promise<QuotaState | null>;
  set(window: WindowType, state: QuotaState): Promise<void>;
}

export interface QuotaStore {
  withLock<T>(key: string, fn: (tx: QuotaTx) => Promise<T>): Promise<T>;
}

export type AcquireResult =
  | { ok: true }
  | { ok: false; reason: WindowType; bucket: string; retryAfterMs: number | null; message: string };

const MINUTE_MS = 60_000;

export function windowStartFor(window: WindowType, now: Date): Date {
  const d = new Date(now);
  if (window === "minute") return new Date(Math.floor(d.getTime() / MINUTE_MS) * MINUTE_MS);
  if (window === "day") return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function windowEndFor(window: WindowType, start: Date): Date {
  if (window === "minute") return new Date(start.getTime() + MINUTE_MS);
  if (window === "day") return new Date(start.getTime() + 86_400_000);
  return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
}

function freshState(window: WindowType, limit: number, now: Date): QuotaState {
  return { windowStart: windowStartFor(window, now), used: 0, limit, stamps: [], reportedRemaining: null };
}

function normalise(state: QuotaState | null, rule: QuotaRule, now: Date): QuotaState {
  if (!state) return freshState(rule.window, rule.limit, now);
  const s: QuotaState = { ...state, limit: rule.limit, stamps: [...state.stamps] };
  if (rule.window === "minute") {
    s.stamps = s.stamps.filter((t) => t > now.getTime() - MINUTE_MS);
    s.used = s.stamps.length;
    return s;
  }
  if (windowStartFor(rule.window, now).getTime() > s.windowStart.getTime()) return freshState(rule.window, rule.limit, now);
  return s;
}

export class QuotaManager {
  constructor(
    private readonly store: QuotaStore,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /**
   * Atomically reserve `cost` calls in every bucket. Either all rules pass and the usage is
   * recorded, or nothing is recorded and the first violated rule is returned.
   */
  async acquire(buckets: QuotaBucket[], cost = 1): Promise<AcquireResult> {
    const locked: QuotaBucket[] = [...buckets].sort((a, b) => a.key.localeCompare(b.key));
    return this.lockAll(locked, 0, async (txs) => {
      const now = this.clock();
      const pending: Array<{ tx: QuotaTx; rule: QuotaRule; next: QuotaState }> = [];
      for (const bucket of buckets) {
        const tx = txs.get(bucket.key)!;
        for (const rule of bucket.rules) {
          const state = normalise(await tx.get(rule.window), rule, now);
          if (rule.window === "minute") {
            if (cost > rule.limit) {
              return { ok: false, reason: "minute", bucket: bucket.key, retryAfterMs: null, message: `${bucket.key}: cost ${cost} exceeds per-minute limit ${rule.limit}` } as AcquireResult;
            }
            if (state.stamps.length + cost > rule.limit) {
              const drop = state.stamps.length + cost - rule.limit;
              const sorted = [...state.stamps].sort((a, b) => a - b);
              const retryAt = sorted[drop - 1] + MINUTE_MS;
              return { ok: false, reason: "minute", bucket: bucket.key, retryAfterMs: Math.max(1, retryAt - now.getTime()) + 25, message: `${bucket.key}: per-minute limit ${rule.limit} reached` } as AcquireResult;
            }
            const stamps = [...state.stamps, ...Array(cost).fill(now.getTime())];
            pending.push({ tx, rule, next: { ...state, stamps, used: stamps.length } });
          } else {
            const reserve = rule.reserve ?? 0;
            if (state.used + cost > rule.limit - reserve) {
              const end = windowEndFor(rule.window, state.windowStart);
              return { ok: false, reason: rule.window, bucket: bucket.key, retryAfterMs: Math.max(0, end.getTime() - now.getTime()), message: `${bucket.key}: ${rule.window} budget ${rule.limit - reserve} exhausted (used ${state.used})` } as AcquireResult;
            }
            pending.push({ tx, rule, next: { ...state, used: state.used + cost } });
          }
        }
      }
      for (const p of pending) await p.tx.set(p.rule.window, p.next);
      return { ok: true } as AcquireResult;
    });
  }

  /** Tighten the local count with a value reported by the provider (headers). Never loosens. */
  async reportRemaining(bucket: QuotaBucket, window: Exclude<WindowType, "minute">, remaining: number, reportedLimit?: number): Promise<void> {
    const rule = bucket.rules.find((r) => r.window === window);
    if (!rule) return;
    await this.store.withLock(bucket.key, async (tx) => {
      const now = this.clock();
      const state = normalise(await tx.get(window), rule, now);
      const limit = Math.min(rule.limit, reportedLimit ?? rule.limit);
      const impliedUsed = Math.max(0, limit - remaining) + Math.max(0, rule.limit - limit);
      await tx.set(window, { ...state, used: Math.max(state.used, impliedUsed), reportedRemaining: remaining });
    });
  }

  /** Block the bucket until the end of its window (e.g. after an HTTP 429). */
  async exhaust(bucket: QuotaBucket, window: WindowType): Promise<void> {
    const rule = bucket.rules.find((r) => r.window === window);
    if (!rule) return;
    await this.store.withLock(bucket.key, async (tx) => {
      const now = this.clock();
      const state = normalise(await tx.get(window), rule, now);
      if (window === "minute") {
        const stamps = Array(rule.limit).fill(now.getTime());
        await tx.set(window, { ...state, stamps, used: rule.limit });
      } else {
        await tx.set(window, { ...state, used: Math.max(state.used, rule.limit) });
      }
    });
  }

  async remaining(bucket: QuotaBucket, window: WindowType): Promise<number | null> {
    const rule = bucket.rules.find((r) => r.window === window);
    if (!rule) return null;
    return this.store.withLock(bucket.key, async (tx) => {
      const state = normalise(await tx.get(window), rule, this.clock());
      return Math.max(0, rule.limit - (rule.reserve ?? 0) - state.used);
    });
  }

  async usage(bucket: QuotaBucket): Promise<Array<{ window: WindowType; used: number; limit: number; reserve: number; remaining: number }>> {
    const out: Array<{ window: WindowType; used: number; limit: number; reserve: number; remaining: number }> = [];
    for (const rule of bucket.rules) {
      const used = await this.store.withLock(bucket.key, async (tx) => normalise(await tx.get(rule.window), rule, this.clock()).used);
      const reserve = rule.reserve ?? 0;
      out.push({ window: rule.window, used, limit: rule.limit, reserve, remaining: Math.max(0, rule.limit - reserve - used) });
    }
    return out;
  }

  private async lockAll<T>(buckets: QuotaBucket[], i: number, fn: (txs: Map<string, QuotaTx>) => Promise<T>, acc = new Map<string, QuotaTx>()): Promise<T> {
    if (i >= buckets.length) return fn(acc);
    return this.store.withLock(buckets[i].key, async (tx) => {
      acc.set(buckets[i].key, tx);
      return this.lockAll(buckets, i + 1, fn, acc);
    });
  }
}

/** In-process store used by unit tests and by single-process tooling. */
export class MemoryQuotaStore implements QuotaStore {
  private data = new Map<string, QuotaState>();
  private chain: Promise<unknown> = Promise.resolve();
  private readonly reentrant = new AsyncLocalStorage<true>();

  async withLock<T>(key: string, fn: (tx: QuotaTx) => Promise<T>): Promise<T> {
    const tx: QuotaTx = {
      get: async (w) => {
        const s = this.data.get(`${key}|${w}`);
        return s ? { ...s, stamps: [...s.stamps] } : null;
      },
      set: async (w, s) => {
        this.data.set(`${key}|${w}`, { ...s, stamps: [...s.stamps] });
      },
    };
    if (this.reentrant.getStore()) return fn(tx);
    const run = this.chain.then(() => this.reentrant.run(true, () => fn(tx)));
    this.chain = run.catch(() => undefined);
    return run;
  }
}

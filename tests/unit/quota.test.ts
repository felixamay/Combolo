import { describe, expect, it } from "vitest";
import { MemoryQuotaStore, QuotaManager, type QuotaBucket } from "@/lib/quota/manager";

function setup(start = "2026-10-12T10:00:00.000Z") {
  let now = new Date(start);
  const clock = () => now;
  const mgr = new QuotaManager(new MemoryQuotaStore(), clock);
  return {
    mgr,
    advance: (ms: number) => {
      now = new Date(now.getTime() + ms);
    },
    set: (iso: string) => {
      now = new Date(iso);
    },
  };
}

const day = (limit: number, reserve = 0): QuotaBucket => ({ key: "p:day", rules: [{ window: "day", limit, reserve }] });

describe("QuotaManager", () => {
  it("never exceeds the daily limit, even under concurrent callers", async () => {
    const { mgr } = setup();
    const results = await Promise.all(Array.from({ length: 500 }, () => mgr.acquire([day(100)])));
    expect(results.filter((r) => r.ok).length).toBe(100);
    expect(results.filter((r) => !r.ok).length).toBe(400);
  });

  it("keeps the safety reserve unused", async () => {
    const { mgr } = setup();
    const results = await Promise.all(Array.from({ length: 20 }, () => mgr.acquire([day(10, 3)])));
    expect(results.filter((r) => r.ok).length).toBe(7);
    expect(await mgr.remaining(day(10, 3), "day")).toBe(0);
  });

  it("resets the day window at 00:00 UTC", async () => {
    const { mgr, set } = setup("2026-10-12T23:59:00.000Z");
    for (let i = 0; i < 5; i++) expect((await mgr.acquire([day(5)])).ok).toBe(true);
    expect((await mgr.acquire([day(5)])).ok).toBe(false);
    set("2026-10-13T00:00:01.000Z");
    expect((await mgr.acquire([day(5)])).ok).toBe(true);
  });

  it("enforces a ROLLING per-minute window (no burst across the clock-minute boundary)", async () => {
    const { mgr, set } = setup("2026-10-12T10:00:59.000Z");
    const bucket: QuotaBucket = { key: "p:min", rules: [{ window: "minute", limit: 10 }] };
    const results = [];
    for (let i = 0; i < 10; i++) results.push(await mgr.acquire([bucket]));
    expect(results.every((r) => r.ok)).toBe(true);
    set("2026-10-12T10:01:01.000Z"); // new wall-clock minute but only 2 s later
    const denied = await mgr.acquire([bucket]);
    expect(denied.ok).toBe(false);
    if (!denied.ok) {
      expect(denied.reason).toBe("minute");
      expect(denied.retryAfterMs).toBeGreaterThan(55_000);
      expect(denied.retryAfterMs).toBeLessThan(60_100);
    }
    set("2026-10-12T10:01:59.100Z");
    expect((await mgr.acquire([bucket])).ok).toBe(true);
  });

  it("is all-or-nothing across buckets (a denied minute rule does not burn daily budget)", async () => {
    const { mgr } = setup();
    const dayB: QuotaBucket = { key: "a:day", rules: [{ window: "day", limit: 100 }] };
    const minB: QuotaBucket = { key: "a:min", rules: [{ window: "minute", limit: 2 }] };
    expect((await mgr.acquire([dayB, minB])).ok).toBe(true);
    expect((await mgr.acquire([dayB, minB])).ok).toBe(true);
    expect((await mgr.acquire([dayB, minB])).ok).toBe(false);
    expect(await mgr.remaining(dayB, "day")).toBe(98);
  });

  it("supports monthly limits", async () => {
    const { mgr, set } = setup("2026-10-30T10:00:00.000Z");
    const month: QuotaBucket = { key: "t:month", rules: [{ window: "month", limit: 3 }] };
    for (let i = 0; i < 3; i++) expect((await mgr.acquire([month])).ok).toBe(true);
    expect((await mgr.acquire([month])).ok).toBe(false);
    set("2026-11-01T00:00:01.000Z");
    expect((await mgr.acquire([month])).ok).toBe(true);
  });

  it("reportRemaining tightens the local count but never loosens it", async () => {
    const { mgr } = setup();
    const b = day(100);
    await mgr.acquire([b]);
    await mgr.reportRemaining(b, "day", 40); // provider says only 40 left -> used = 60
    expect(await mgr.remaining(b, "day")).toBe(40);
    await mgr.reportRemaining(b, "day", 95); // provider reports more left than we believe -> ignored
    expect(await mgr.remaining(b, "day")).toBe(40);
  });

  it("exhaust() blocks the bucket until the window resets", async () => {
    const { mgr } = setup();
    const b = day(100);
    await mgr.exhaust(b, "day");
    const r = await mgr.acquire([b]);
    expect(r.ok).toBe(false);
  });

  it("refuses a request whose cost alone exceeds the remaining budget", async () => {
    const { mgr } = setup();
    const b = day(5);
    expect((await mgr.acquire([b], 6)).ok).toBe(false);
    expect((await mgr.acquire([b], 5)).ok).toBe(true);
    expect((await mgr.acquire([b], 1)).ok).toBe(false);
  });

  it("reports usage per window", async () => {
    const { mgr } = setup();
    const b: QuotaBucket = { key: "u", rules: [{ window: "day", limit: 10, reserve: 2 }, { window: "minute", limit: 5 }] };
    await mgr.acquire([b]);
    await mgr.acquire([b]);
    const usage = await mgr.usage(b);
    expect(usage.find((u) => u.window === "day")).toMatchObject({ used: 2, remaining: 6 });
    expect(usage.find((u) => u.window === "minute")).toMatchObject({ used: 2, remaining: 3 });
  });
});

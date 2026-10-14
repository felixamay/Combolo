import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../src/lib/db";
import { Resolver } from "../../src/lib/ingest/resolve";
import { upsertFixtures } from "../../src/lib/ingest/upsert";
import { bulkInsertHistorical } from "../../src/jobs/tennis";
import { MemoryQuotaStore, QuotaManager } from "../../src/lib/quota/manager";
import { PrismaQuotaStore } from "../../src/lib/quota/prisma-store";
import type { NormFixture } from "../../src/lib/providers/types";
import { ensureSports } from "../../src/lib/seed";
import { resetDatabase } from "../support/seed";

const T0 = new Date("2026-10-14T18:00:00Z");

function football(provider: "footballdata" | "thesportsdb", id: string, over: Partial<NormFixture> = {}): NormFixture {
  return {
    provider,
    scope: provider === "footballdata" ? "v4" : "football",
    externalId: id,
    sport: "football",
    league: { externalId: provider === "footballdata" ? "2021" : "4328", name: provider === "footballdata" ? "Premier League" : "English Premier League", country: "England" },
    startsAt: T0,
    status: "SCHEDULED",
    home: { externalId: provider === "footballdata" ? "57" : "133604", name: provider === "footballdata" ? "Arsenal FC" : "Arsenal" },
    away: { externalId: provider === "footballdata" ? "61" : "133610", name: provider === "footballdata" ? "Chelsea FC" : "Chelsea" },
    ...over,
  };
}

describe("cross-provider ingestion", () => {
  beforeAll(async () => {
    await resetDatabase();
    await ensureSports();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("merges the same fixture from two providers into one match, team and league", async () => {
    const resolver = new Resolver();
    await upsertFixtures([football("footballdata", "1")], resolver);
    await upsertFixtures([football("thesportsdb", "9", { startsAt: new Date(T0.getTime() + 30 * 60_000) })], resolver);
    expect(await prisma.match.count()).toBe(1);
    expect(await prisma.team.count()).toBe(2);
    expect(await prisma.league.count()).toBe(1);
    expect(await prisma.externalId.count({ where: { entityType: "MATCH" } })).toBe(2);
  });

  it("never regresses a finished match back to scheduled and flags the pair's H2H for refresh", async () => {
    const resolver = new Resolver();
    await upsertFixtures([football("footballdata", "1", { status: "FINISHED", homeScore: 2, awayScore: 1, winner: "HOME" })], resolver);
    const m = await prisma.match.findFirstOrThrow();
    expect(m.status).toBe("FINISHED");
    expect(m.winner).toBe("HOME");
    await upsertFixtures([football("thesportsdb", "9", { status: "SCHEDULED" })], resolver);
    const after = await prisma.match.findFirstOrThrow();
    expect(after.status).toBe("FINISHED");
    expect(after.homeScore).toBe(2);
  });

  it("keeps matches of different days apart (home and away fixtures)", async () => {
    const resolver = new Resolver();
    await upsertFixtures([football("footballdata", "2", { startsAt: new Date(T0.getTime() + 40 * 86400_000), home: { externalId: "61", name: "Chelsea FC" }, away: { externalId: "57", name: "Arsenal FC" } })], resolver);
    expect(await prisma.match.count()).toBe(2);
  });

  it("matches a time-accurate tennis result to the approximate Sackmann row instead of duplicating it", async () => {
    await resetDatabase();
    await ensureSports();
    const base = (provider: "sackmann" | "apitennis", id: string, at: Date): NormFixture => ({
      provider,
      scope: provider === "sackmann" ? "atp" : "tennis",
      externalId: id,
      sport: "tennis",
      league: { externalId: "x", name: "Test Open", tour: "ATP" },
      startsAt: at,
      status: "FINISHED",
      home: { externalId: provider === "sackmann" ? "1" : "11", name: "Adrian Vale" },
      away: { externalId: provider === "sackmann" ? "2" : "12", name: "Bruno Keller" },
      homeScore: 2,
      awayScore: 0,
      winner: "HOME",
      individual: true,
      neutralVenue: true,
      historical: true,
    });
    const first = await bulkInsertHistorical([base("sackmann", "s-1", new Date("2026-03-02T12:00:00Z"))]);
    expect(first.created).toBe(1);
    const again = await bulkInsertHistorical([base("sackmann", "s-1", new Date("2026-03-02T12:00:00Z"))]);
    expect(again).toEqual({ created: 0, skipped: 1 });
    await upsertFixtures([base("apitennis", "a-1", new Date("2026-03-05T16:30:00Z"))]);
    expect(await prisma.match.count({ where: { sportId: "tennis" } })).toBe(1);
    const m = await prisma.match.findFirstOrThrow();
    expect(m.startsAt.toISOString()).toBe("2026-03-05T16:30:00.000Z");
    expect(await prisma.player.count()).toBe(2);
  });
});

describe("Postgres-backed quota store", () => {
  beforeAll(async () => {
    await resetDatabase();
  });

  it("never exceeds the limit with many concurrent callers (advisory lock)", async () => {
    const mgr = new QuotaManager(new PrismaQuotaStore());
    const bucket = { key: "test:day", rules: [{ window: "day" as const, limit: 8 }] };
    const results = await Promise.all(Array.from({ length: 40 }, () => mgr.acquire([bucket])));
    expect(results.filter((r) => r.ok).length).toBe(8);
    expect(await mgr.remaining(bucket, "day")).toBe(0);
  });

  it("behaves identically to the in-memory store used by the unit tests", async () => {
    const mem = new QuotaManager(new MemoryQuotaStore());
    const bucket = { key: "test:cmp", rules: [{ window: "day" as const, limit: 3, reserve: 1 }] };
    const pg = new QuotaManager(new PrismaQuotaStore());
    const a = await Promise.all(Array.from({ length: 6 }, () => mem.acquire([bucket])));
    const b = await Promise.all(Array.from({ length: 6 }, () => pg.acquire([bucket])));
    expect(a.filter((r) => r.ok).length).toBe(b.filter((r) => r.ok).length);
    await prisma.$disconnect();
  });
});

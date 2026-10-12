import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/db";
import { getEnv } from "../lib/env";
import { entityKey } from "../lib/ingest/keys";
import { Resolver } from "../lib/ingest/resolve";
import { upsertFixtures } from "../lib/ingest/upsert";
import * as apitennis from "../lib/providers/apitennis";
import * as sackmann from "../lib/providers/sackmann";
import type { NormFixture } from "../lib/providers/types";
import { attempt, outOfTime, type JobContext, type JobResult } from "./helpers";

const DAY = 86400_000;

/**
 * Fast bulk path for large historical datasets (Sackmann CSVs): batched creates instead of per-row upserts.
 * Idempotent through the ExternalId table, and skips rows that duplicate a match we already hold from another source.
 */
export async function bulkInsertHistorical(fixtures: NormFixture[], resolver = new Resolver()): Promise<{ created: number; skipped: number }> {
  if (fixtures.length === 0) return { created: 0, skipped: 0 };
  const provider = fixtures[0].provider;
  const scope = fixtures[0].scope;

  const leagueIds = new Map<string, string>();
  for (const f of fixtures) {
    const k = `${f.league.externalId}|${f.league.name}`;
    if (!leagueIds.has(k)) leagueIds.set(k, await resolver.league(f.provider, f.scope, f.sport, f.league));
  }
  const playerIds = new Map<string, string>();
  for (const f of fixtures) {
    for (const p of [f.home, f.away]) if (!playerIds.has(p.externalId)) playerIds.set(p.externalId, await resolver.player(f.provider, f.scope, f.league.tour, p));
  }

  const existingExt = new Set<string>();
  const extIds = fixtures.map((f) => f.externalId);
  for (let i = 0; i < extIds.length; i += 5000) {
    const rows = await prisma.externalId.findMany({ where: { provider, scope, entityType: "MATCH", externalId: { in: extIds.slice(i, i + 5000) } }, select: { externalId: true } });
    for (const r of rows) existingExt.add(r.externalId);
  }

  const minT = Math.min(...fixtures.map((f) => f.startsAt.getTime())) - 16 * DAY;
  const maxT = Math.max(...fixtures.map((f) => f.startsAt.getTime())) + 16 * DAY;
  const others = await prisma.match.findMany({
    where: { sportId: "tennis", status: "FINISHED", primarySource: { not: provider }, startsAt: { gte: new Date(minT), lte: new Date(maxT) } },
    select: { homePlayerId: true, awayPlayerId: true, startsAt: true },
  });
  const otherByPair = new Map<string, number[]>();
  for (const o of others) {
    if (!o.homePlayerId || !o.awayPlayerId) continue;
    const k = [o.homePlayerId, o.awayPlayerId].sort().join("|");
    otherByPair.set(k, [...(otherByPair.get(k) ?? []), o.startsAt.getTime()]);
  }

  const matchRows: Prisma.MatchCreateManyInput[] = [];
  const extRows: Prisma.ExternalIdCreateManyInput[] = [];
  let skipped = 0;
  for (const f of fixtures) {
    if (existingExt.has(f.externalId)) {
      skipped++;
      continue;
    }
    const home = playerIds.get(f.home.externalId)!;
    const away = playerIds.get(f.away.externalId)!;
    const pair = [home, away].sort().join("|");
    if ((otherByPair.get(pair) ?? []).some((t) => Math.abs(t - f.startsAt.getTime()) <= 16 * DAY)) {
      skipped++;
      continue;
    }
    const id = randomUUID();
    matchRows.push({
      id,
      sportId: "tennis",
      leagueId: leagueIds.get(`${f.league.externalId}|${f.league.name}`)!,
      season: f.league.season ?? null,
      round: f.round ?? null,
      startsAt: f.startsAt,
      status: "FINISHED",
      homePlayerId: home,
      awayPlayerId: away,
      homeName: f.home.name,
      awayName: f.away.name,
      homeScore: f.homeScore ?? null,
      awayScore: f.awayScore ?? null,
      winner: f.winner ?? null,
      surface: f.surface ?? null,
      bestOf: f.bestOf ?? null,
      neutralVenue: true,
      primarySource: f.provider,
      isHistorical: true,
    });
    extRows.push({ provider, scope, entityType: "MATCH", externalId: f.externalId, entityId: id });
  }
  for (let i = 0; i < matchRows.length; i += 2000) {
    await prisma.match.createMany({ data: matchRows.slice(i, i + 2000) });
    await prisma.externalId.createMany({ data: extRows.slice(i, i + 2000), skipDuplicates: true });
  }
  if (matchRows.length) await prisma.h2HRecord.updateMany({ where: { sportId: "tennis" }, data: { stale: true } });
  return { created: matchRows.length, skipped };
}

/** Sackmann yearly CSVs (non-commercial licence; skipped entirely in commercial mode). */
export async function loadSackmannHistory(ctx: JobContext): Promise<JobResult> {
  const errors: string[] = [];
  if (!sackmann.sackmannEnabled()) return { summary: { skipped: "TENNIS_COMMERCIAL_MODE=true – Sackmann data disabled" }, errors };
  const env = getEnv();
  const thisYear = ctx.now.getUTCFullYear();
  const resolver = new Resolver();
  const summary: Record<string, unknown> = {};
  for (const tour of ["atp", "wta"] as const) {
    for (let year = thisYear - env.SACKMANN_HISTORY_YEARS + 1; year <= thisYear; year++) {
      if (outOfTime(ctx)) break;
      const res = await attempt(`sackmann ${tour} ${year}`, errors, () => sackmann.loadSeason(tour, year));
      if (!res) continue;
      if (res.status === "ok") {
        const r = await bulkInsertHistorical(res.fixtures, resolver);
        summary[`${tour}${year}`] = r;
      } else {
        summary[`${tour}${year}`] = res.status;
      }
    }
  }
  return { summary, errors };
}

/**
 * Accumulate tennis results history from API-Tennis `get_fixtures` (small date chunks because each match carries
 * inline point-by-point data). Walks backwards from yesterday, resumable across runs, bounded by call budget.
 */
export async function backfillApiTennis(ctx: JobContext): Promise<JobResult> {
  const errors: string[] = [];
  const env = getEnv();
  if (!apitennis.apiTennisEnabled() || env.TENNIS_BACKFILL_DAYS === 0) return { summary: { skipped: "API-Tennis disabled or backfill days = 0" }, errors };
  const resolver = new Resolver();
  const calls = ctx.bootstrap ? Math.max(env.TENNIS_BACKFILL_CALLS_PER_RUN, 24) : env.TENNIS_BACKFILL_CALLS_PER_RUN;
  const chunkDays = 4;
  const target = new Date(ctx.now.getTime() - env.TENNIS_BACKFILL_DAYS * DAY);
  const key = "apitennis:backfill";
  const kv = await prisma.keyValue.findUnique({ where: { key } });
  let oldest = kv ? new Date((kv.value as { oldest: string }).oldest) : new Date(ctx.now.getTime() - 0 * DAY);
  let used = 0;
  let loaded = 0;
  while (used + 2 <= calls && oldest.getTime() > target.getTime() && !outOfTime(ctx)) {
    const stop = new Date(oldest.getTime() - DAY);
    const start = new Date(stop.getTime() - (chunkDays - 1) * DAY);
    const dateStart = start.toISOString().slice(0, 10);
    const dateStop = stop.toISOString().slice(0, 10);
    let chunkOk = true;
    for (const [tour, typeKey] of Object.entries(apitennis.EVENT_TYPES)) {
      used++;
      const fx = await attempt(`apitennis backfill ${tour} ${dateStart}..${dateStop}`, errors, () => apitennis.fetchFixtures(dateStart, dateStop, typeKey));
      if (!fx) {
        chunkOk = false;
        break;
      }
      const finished = fx.filter((f) => f.status === "FINISHED").map((f) => ({ ...f, historical: true }));
      await upsertFixtures(finished, resolver);
      loaded += finished.length;
    }
    if (!chunkOk) break;
    oldest = start;
    await prisma.keyValue.upsert({ where: { key }, create: { key, value: { oldest: oldest.toISOString() } }, update: { value: { oldest: oldest.toISOString() } } });
  }
  return { summary: { callsUsed: used, matchesLoaded: loaded, oldestLoaded: oldest.toISOString().slice(0, 10), target: target.toISOString().slice(0, 10) }, errors };
}

import { APISPORTS_PRODUCTS, FOOTBALL_DATA_FREE_COMPETITIONS, HIGHLIGHTLY_PRODUCTS } from "../../config/admin";
import { prisma } from "../lib/db";
import { getEnv } from "../lib/env";
import { entityKey } from "../lib/ingest/keys";
import { Resolver } from "../lib/ingest/resolve";
import { upsertStandings } from "../lib/ingest/upsert";
import * as apisports from "../lib/providers/apisports";
import * as apitennis from "../lib/providers/apitennis";
import * as footballdata from "../lib/providers/footballdata";
import * as highlightly from "../lib/providers/highlightly";
import * as livetennis from "../lib/providers/livetennis";
import * as sackmann from "../lib/providers/sackmann";
import { attempt, isQuotaDenied, outOfTime, startOfUtcDay, usedToday, type JobContext, type JobResult } from "./helpers";

interface UpcomingLeague {
  leagueId: string;
  name: string;
  country: string | null;
  priority: number;
  season: string | null;
}

async function upcomingLeagues(ctx: JobContext, sportId: string): Promise<UpcomingLeague[]> {
  const rows = await prisma.match.groupBy({
    by: ["leagueId", "season"],
    where: { sportId, status: "SCHEDULED", startsAt: { gt: ctx.now, lt: new Date(ctx.now.getTime() + 4 * 86400_000) } },
    _count: { _all: true },
  });
  if (rows.length === 0) return [];
  const leagues = await prisma.league.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.leagueId))] } } });
  const byId = new Map(leagues.map((l) => [l.id, l]));
  const out = new Map<string, UpcomingLeague>();
  for (const r of rows) {
    const l = byId.get(r.leagueId);
    if (!l) continue;
    if (!out.has(l.id) || (r.season && !out.get(l.id)!.season)) out.set(l.id, { leagueId: l.id, name: l.name, country: l.country, priority: l.priority, season: r.season });
  }
  return [...out.values()].sort((a, b) => b.priority - a.priority);
}

async function hasSnapshotToday(scopeKey: string): Promise<boolean> {
  return (await prisma.rankingSnapshot.count({ where: { scopeKey, snapshotDate: startOfUtcDay() } })) > 0;
}

async function externalFor(provider: string, scope: string, leagueId: string): Promise<string | null> {
  const row = await prisma.externalId.findFirst({ where: { provider, scope, entityType: "LEAGUE", entityId: leagueId } });
  return row?.externalId ?? null;
}

/** Standings refresh: once per UTC day per league, highest-priority leagues first, capped by per-product budgets. */
export async function refreshStandings(ctx: JobContext): Promise<JobResult> {
  const errors: string[] = [];
  const resolver = new Resolver();
  const counts: Record<string, number> = {};

  if (footballdata.footballDataEnabled()) {
    for (const code of FOOTBALL_DATA_FREE_COMPETITIONS) {
      if (outOfTime(ctx)) break;
      const done = await prisma.keyValue.findUnique({ where: { key: `standings:footballdata:${code}` } });
      if (done && new Date((done.value as { at: string }).at).getTime() >= startOfUtcDay().getTime()) continue;
      const s = await attempt(`footballdata standings ${code}`, errors, () => footballdata.fetchStandings(code));
      if (s) {
        counts[`footballdata:${code}`] = await upsertStandings(s, undefined, resolver);
        await prisma.keyValue.upsert({ where: { key: `standings:footballdata:${code}` }, create: { key: `standings:footballdata:${code}`, value: { at: new Date().toISOString() } }, update: { value: { at: new Date().toISOString() } } });
      }
    }
  }

  if (apisports.apiSportsEnabled()) {
    for (const product of APISPORTS_PRODUCTS) {
      const leagues = await upcomingLeagues(ctx, product.sport);
      let used = await usedToday("apisports", product.scope, "/standings");
      for (const lg of leagues) {
        if (outOfTime(ctx) || used >= product.standingsBudget) break;
        if (await hasSnapshotToday(`league:${lg.leagueId}`)) continue;
        const ext = await externalFor("apisports", product.scope, lg.leagueId);
        if (!ext || !lg.season) continue;
        used++;
        let denied = false;
        const s = await attempt(`apisports standings ${product.scope}/${lg.name}`, errors, async () => {
          try {
            return await apisports.fetchStandings(product, ext, lg.season!);
          } catch (e) {
            denied = isQuotaDenied(e);
            throw e;
          }
        });
        if (denied) break;
        if (s) counts[`apisports:${product.scope}`] = (counts[`apisports:${product.scope}`] ?? 0) + (await upsertStandings(s, lg.name, resolver));
      }
    }
  }

  if (highlightly.highlightlyEnabled()) {
    for (const product of HIGHLIGHTLY_PRODUCTS) {
      if (!highlightly.standingsSupported(product)) continue;
      const leagues = await upcomingLeagues(ctx, product.sport);
      let used = await usedToday("highlightly", product.scope, "/standings");
      for (const lg of leagues) {
        if (outOfTime(ctx) || used >= product.standingsBudget) break;
        if (await hasSnapshotToday(`league:${lg.leagueId}`)) continue;
        const ext = await externalFor("highlightly", product.scope, lg.leagueId);
        if (!ext || ext.startsWith("name:") || !lg.season) continue;
        used++;
        const s = await attempt(`highlightly standings ${product.scope}/${lg.name}`, errors, () => highlightly.fetchStandings(product, ext, lg.season!));
        if (s) counts[`highlightly:${product.scope}`] = (counts[`highlightly:${product.scope}`] ?? 0) + (await upsertStandings(s, lg.name, resolver));
      }
    }
  }

  const tennis = await refreshTennisRankings(ctx, errors, resolver);
  Object.assign(counts, tennis);
  return { summary: { snapshots: counts }, errors };
}

/** Tennis rankings refresh weekly (API-Tennis 2 calls; Sackmann CSV fallback; Live Tennis per-player gap fill). */
export async function refreshTennisRankings(ctx: JobContext, errors: string[], resolver = new Resolver()): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  const weekAgo = new Date(startOfUtcDay().getTime() - 6 * 86400_000);
  for (const tour of ["ATP", "WTA"] as const) {
    const fresh = await prisma.rankingSnapshot.count({ where: { scopeKey: `tennis:${tour}`, snapshotDate: { gte: weekAgo }, source: { not: "livetennis" } } });
    if (fresh > 0 && !ctx.bootstrap) continue;
    if (fresh > 0) continue;
    if (apitennis.apiTennisEnabled()) {
      const s = await attempt(`apitennis rankings ${tour}`, errors, () => apitennis.fetchRankings(tour));
      if (s) {
        counts[`apitennis:${tour}`] = await upsertStandings(s, undefined, resolver);
        continue;
      }
    }
    if (sackmann.sackmannEnabled()) {
      const r = await attempt(`sackmann rankings ${tour}`, errors, () => sackmann.loadRankings(tour.toLowerCase() as "atp" | "wta"));
      if (r && r.rows.length) {
        const rows = r.rows.map((x) => ({ participant: { externalId: x.externalId, name: x.name, country: x.country }, position: x.position, points: x.points }));
        counts[`sackmann:${tour}`] = await upsertStandings({ provider: "sackmann", scope: tour.toLowerCase(), sport: "tennis", league: { externalId: tour, name: `${tour} Rankings`, tour }, rows, individual: true }, undefined, resolver);
      }
    }
  }

  // Players in upcoming matches that still have no ranking: ask Live Tennis API (free /players/{id}), small daily budget.
  if (livetennis.liveTennisEnabled()) {
    const budget = Math.max(0, 40 - (await usedToday("livetennis", "v1", "/players")));
    if (budget > 0) {
      const matches = await prisma.match.findMany({
        where: { sportId: "tennis", status: "SCHEDULED", startsAt: { gt: ctx.now, lt: new Date(ctx.now.getTime() + 4 * 86400_000) } },
        include: { league: true },
        orderBy: [{ league: { priority: "desc" } }, { startsAt: "asc" }],
        take: 200,
      });
      const ids = new Set<string>();
      for (const m of matches) {
        if (m.homePlayerId) ids.add(m.homePlayerId);
        if (m.awayPlayerId) ids.add(m.awayPlayerId);
      }
      const ranked = new Set((await prisma.rankingSnapshot.findMany({ where: { entityKey: { in: [...ids].map((i) => entityKey("PLAYER", i)) }, scopeKey: { startsWith: "tennis:" } }, select: { entityKey: true } })).map((r) => r.entityKey));
      let used = 0;
      for (const pid of ids) {
        if (used >= budget || outOfTime(ctx)) break;
        if (ranked.has(entityKey("PLAYER", pid))) continue;
        const ext = await prisma.externalId.findFirst({ where: { provider: "livetennis", entityType: "PLAYER", entityId: pid } });
        if (!ext) continue;
        used++;
        const p = await attempt(`livetennis player ${ext.externalId}`, errors, () => livetennis.fetchPlayer(ext.externalId));
        if (p && p.ranking) {
          const player = await prisma.player.findUnique({ where: { id: pid } });
          const tour = (p.tour ?? player?.tour ?? "ATP").toUpperCase().startsWith("W") ? "WTA" : "ATP";
          await prisma.rankingSnapshot.upsert({
            where: { scopeKey_entityKey_snapshotDate: { scopeKey: `tennis:${tour}`, entityKey: entityKey("PLAYER", pid), snapshotDate: startOfUtcDay() } },
            create: { sportId: "tennis", scopeKey: `tennis:${tour}`, entityType: "PLAYER", entityKey: entityKey("PLAYER", pid), name: player?.name ?? p.name, position: p.ranking, points: p.rankingPoints, source: "livetennis", snapshotDate: startOfUtcDay() },
            update: { position: p.ranking, points: p.rankingPoints, capturedAt: new Date() },
          });
          counts["livetennis:players"] = (counts["livetennis:players"] ?? 0) + 1;
        }
      }
    }
  }
  void getEnv;
  return counts;
}

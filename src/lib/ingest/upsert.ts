import { MatchStatus, Side, type Match, type Prisma } from "@prisma/client";
import { prisma } from "../db";
import { log } from "../log";
import type { NormFixture, NormStandings } from "../providers/types";
import { decideWinner } from "../providers/types";
import { SPORTS } from "../sports";
import { entityKey, pairKeys, sidesOf } from "./keys";
import { Resolver } from "./resolve";

export interface UpsertStats {
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
}

const HOUR = 3600_000;

function tourFromLeague(f: NormFixture): string | null {
  if (f.league.tour) return f.league.tour.toUpperCase();
  const n = f.league.name.toLowerCase();
  if (/\bwta\b/.test(n)) return "WTA";
  if (/\batp\b/.test(n)) return "ATP";
  return null;
}

async function markH2HStale(sportId: string, a: string, b: string) {
  const { keyLow, keyHigh } = pairKeys(a, b);
  await prisma.h2HRecord.updateMany({ where: { sportId, keyLow, keyHigh }, data: { stale: true } });
}

export async function findExistingMatch(resolver: Resolver, f: NormFixture, ids: { home: string; away: string; individual: boolean }): Promise<Match | null> {
  const direct = await resolver.lookupExternal(f.provider, f.scope, "MATCH", f.externalId);
  if (direct) {
    const m = await prisma.match.findUnique({ where: { id: direct } });
    if (m) return m;
  }
  for (const alt of f.altIds ?? []) {
    const id = await resolver.lookupExternal(alt.provider, alt.scope, "MATCH", alt.externalId);
    if (id) {
      const m = await prisma.match.findUnique({ where: { id } });
      if (m) return m;
    }
  }
  const window = ids.individual ? 18 * HOUR : 4 * HOUR;
  const homeField = ids.individual ? "homePlayerId" : "homeTeamId";
  const awayField = ids.individual ? "awayPlayerId" : "awayTeamId";
  return prisma.match.findFirst({
    where: {
      sportId: f.sport,
      startsAt: { gte: new Date(f.startsAt.getTime() - window), lte: new Date(f.startsAt.getTime() + window) },
      OR: [
        { [homeField]: ids.home, [awayField]: ids.away },
        { [homeField]: ids.away, [awayField]: ids.home },
      ],
    },
    orderBy: { startsAt: "asc" },
  });
}

/**
 * Persist normalised fixtures. Idempotent; merges the same fixture coming from several providers.
 * Results are never regressed (a FINISHED match is never turned back into SCHEDULED/LIVE).
 */
export async function upsertFixtures(fixtures: NormFixture[], resolver = new Resolver()): Promise<UpsertStats> {
  const stats: UpsertStats = { created: 0, updated: 0, unchanged: 0, skipped: 0 };
  for (const f of fixtures) {
    try {
      const individual = SPORTS[f.sport].individual;
      let tour: string | null = null;
      if (individual) {
        tour = tourFromLeague(f);
        if (!tour) {
          stats.skipped++;
          continue;
        }
      }
      const leagueId = await resolver.league(f.provider, f.scope, f.sport, { ...f.league, tour: individual ? tour : f.league.tour });
      const [homeId, awayId] = individual
        ? [await resolver.player(f.provider, f.scope, tour, f.home), await resolver.player(f.provider, f.scope, tour, f.away)]
        : [await resolver.team(f.provider, f.scope, f.sport, f.home), await resolver.team(f.provider, f.scope, f.sport, f.away)];
      if (homeId === awayId) {
        stats.skipped++;
        continue;
      }
      const existing = await findExistingMatch(resolver, f, { home: homeId, away: awayId, individual });
      const kind = individual ? "PLAYER" : "TEAM";
      const hasDraw = SPORTS[f.sport].hasDraw;
      const winner: Side | null = f.status === "FINISHED" ? ((f.winner ?? decideWinner(f.homeScore, f.awayScore, hasDraw)) as Side | null) : null;

      if (!existing) {
        const m = await prisma.match.create({
          data: {
            sportId: f.sport,
            leagueId,
            season: f.league.season ?? null,
            round: f.round ?? null,
            startsAt: f.startsAt,
            status: f.status as MatchStatus,
            statusDetail: f.statusDetail ?? null,
            homeTeamId: individual ? null : homeId,
            awayTeamId: individual ? null : awayId,
            homePlayerId: individual ? homeId : null,
            awayPlayerId: individual ? awayId : null,
            homeName: f.home.name,
            awayName: f.away.name,
            homeLogo: f.home.logo ?? null,
            awayLogo: f.away.logo ?? null,
            homeScore: f.homeScore ?? null,
            awayScore: f.awayScore ?? null,
            winner,
            surface: f.surface ?? null,
            bestOf: f.bestOf ?? null,
            neutralVenue: f.neutralVenue ?? false,
            primarySource: f.provider,
            isHistorical: !!f.historical,
          },
        });
        await resolver.linkExternal(f.provider, f.scope, "MATCH", f.externalId, m.id);
        for (const alt of f.altIds ?? []) await resolver.linkExternal(alt.provider, alt.scope, "MATCH", alt.externalId, m.id);
        if (f.status === "FINISHED") await markH2HStale(f.sport, entityKey(kind, homeId), entityKey(kind, awayId));
        stats.created++;
        continue;
      }

      await resolver.linkExternal(f.provider, f.scope, "MATCH", f.externalId, existing.id);
      for (const alt of f.altIds ?? []) await resolver.linkExternal(alt.provider, alt.scope, "MATCH", alt.externalId, existing.id);

      const sides = sidesOf(existing);
      const swapped = sides ? (individual ? existing.homePlayerId === awayId : existing.homeTeamId === awayId) : false;
      const inHome = swapped ? f.awayScore : f.homeScore;
      const inAway = swapped ? f.homeScore : f.awayScore;
      const inWinner: Side | null = winner && swapped ? (winner === "HOME" ? "AWAY" : winner === "AWAY" ? "HOME" : "DRAW") : winner;

      const data: Prisma.MatchUpdateInput = { lastSyncedAt: new Date() };
      const wasFinished = existing.status === "FINISHED";
      if (!wasFinished) {
        data.status = f.status as MatchStatus;
        data.statusDetail = f.statusDetail ?? null;
        if (f.status === "FINISHED" || f.status === "LIVE") {
          data.homeScore = inHome ?? null;
          data.awayScore = inAway ?? null;
        }
        if (f.status === "FINISHED") data.winner = inWinner;
        if (f.status === "SCHEDULED" && existing.status === "SCHEDULED" && existing.startsAt.getTime() !== f.startsAt.getTime()) data.startsAt = f.startsAt;
        if (f.status === "POSTPONED" || f.status === "CANCELLED") data.status = f.status as MatchStatus;
      } else if (f.status === "FINISHED" && existing.winner == null && inWinner) {
        data.winner = inWinner;
        data.homeScore = inHome ?? existing.homeScore;
        data.awayScore = inAway ?? existing.awayScore;
      }
      if (!existing.surface && f.surface) data.surface = f.surface;
      if (!existing.homeLogo && f.home.logo) data.homeLogo = swapped ? undefined : f.home.logo;
      if (!existing.awayLogo && f.away.logo) data.awayLogo = swapped ? undefined : f.away.logo;
      if (existing.bestOf == null && f.bestOf) data.bestOf = f.bestOf;

      const changed = Object.keys(data).length > 1;
      if (changed) {
        await prisma.match.update({ where: { id: existing.id }, data });
        if (!wasFinished && f.status === "FINISHED") await markH2HStale(f.sport, entityKey(kind, homeId), entityKey(kind, awayId));
        stats.updated++;
      } else {
        stats.unchanged++;
      }
    } catch (e) {
      stats.skipped++;
      log.error(`upsertFixtures failed for ${f.provider}:${f.externalId} (${f.home.name} v ${f.away.name})`, e instanceof Error ? e.message : e);
    }
  }
  return stats;
}

export async function upsertStandings(s: NormStandings, leagueNameHint?: string, resolver = new Resolver()): Promise<number> {
  const individual = !!s.individual;
  const tour = individual ? (s.league.tour ?? s.league.externalId).toUpperCase() : null;
  const leagueId = individual ? null : await resolver.league(s.provider, s.scope, s.sport, { ...s.league, name: s.league.name || leagueNameHint || "Unknown league" });
  const scopeKey = individual ? `tennis:${tour}` : `league:${leagueId}`;
  const snapshotDate = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));
  let n = 0;
  for (const r of s.rows) {
    const id = individual ? await resolver.player(s.provider, s.scope, tour, r.participant) : await resolver.team(s.provider, s.scope, s.sport, r.participant);
    const key = entityKey(individual ? "PLAYER" : "TEAM", id);
    const data = {
      sportId: s.sport,
      leagueId,
      entityType: individual ? ("PLAYER" as const) : ("TEAM" as const),
      name: r.participant.name,
      logo: r.participant.logo ?? null,
      groupName: r.group ?? null,
      position: r.position,
      points: r.points ?? null,
      played: r.played ?? null,
      wins: r.wins ?? null,
      draws: r.draws ?? null,
      losses: r.losses ?? null,
      goalsFor: r.goalsFor ?? null,
      goalsAgainst: r.goalsAgainst ?? null,
      homeRecord: (r.home ?? undefined) as Prisma.InputJsonValue | undefined,
      awayRecord: (r.away ?? undefined) as Prisma.InputJsonValue | undefined,
      form: r.form ?? null,
      season: s.league.season ?? null,
      source: s.provider,
      capturedAt: new Date(),
    };
    await prisma.rankingSnapshot.upsert({
      where: { scopeKey_entityKey_snapshotDate: { scopeKey, entityKey: key, snapshotDate } },
      create: { scopeKey, entityKey: key, snapshotDate, ...data },
      update: data,
    });
    n++;
  }
  await prisma.rankingSnapshot.deleteMany({ where: { scopeKey, snapshotDate: { lt: new Date(snapshotDate.getTime() - 45 * 86400000) } } });
  return n;
}

import { prisma } from "../lib/db";
import { getEnv } from "../lib/env";
import { Resolver } from "../lib/ingest/resolve";
import { matchOddsEvent, type OddsTarget } from "../lib/ingest/odds-match";
import * as apitennis from "../lib/providers/apitennis";
import * as oddsapi from "../lib/providers/oddsapi";
import { SPORT_IDS } from "../lib/sports";
import { utcDatesCoveringWindow } from "../lib/time";
import { FIRST_PLAYERS_KEY } from "./fixtures";
import { attempt, outOfTime, type JobContext, type JobResult } from "./helpers";

interface Row {
  matchId: string;
  provider: string;
  bookmaker: string;
  home: number | null;
  draw: number | null;
  away: number | null;
}

async function save(rows: Row[]) {
  const now = new Date();
  for (const r of rows) {
    await prisma.matchOdds.upsert({
      where: { matchId_provider_bookmaker: { matchId: r.matchId, provider: r.provider, bookmaker: r.bookmaker } },
      create: { ...r, fetchedAt: now },
      update: { home: r.home, draw: r.draw, away: r.away, fetchedAt: now },
    });
  }
}

/**
 * Real bookmaker prices only, and only when FEATURE_ODDS is on. Prices are attached to a match only on an
 * unambiguous name + kick-off match; anything else is dropped. Without prices the UI shows probabilities only.
 */
export async function refreshOdds(ctx: JobContext): Promise<JobResult> {
  const env = getEnv();
  const errors: string[] = [];
  if (!env.FEATURE_ODDS) return { summary: { skipped: "FEATURE_ODDS is off" }, errors };

  const upcoming = await prisma.match.findMany({
    where: { status: "SCHEDULED", startsAt: { gt: ctx.now, lt: new Date(ctx.now.getTime() + 4 * 86400_000) } },
    include: { league: { select: { tour: true } } },
  });
  const targets: OddsTarget[] = upcoming.map((m) => ({ id: m.id, sport: m.sportId, startsAt: m.startsAt, homeName: m.homeName, awayName: m.awayName, tour: m.league.tour }));
  const sportsWithMatches = new Set(upcoming.map((m) => m.sportId));
  let stored = 0;
  let unmatched = 0;
  let creditsKeys = 0;

  if (oddsapi.oddsEnabled()) {
    const keys = await attempt("oddsapi /sports", errors, () => oddsapi.listActiveSportKeys());
    for (const { key, sport } of keys ?? []) {
      if (outOfTime(ctx)) break;
      if (!sportsWithMatches.has(sport)) continue;
      const tour = key.startsWith("tennis_wta") ? "WTA" : key.startsWith("tennis_atp") ? "ATP" : null;
      const events = await attempt(`oddsapi odds ${key}`, errors, () => oddsapi.fetchOdds(key));
      if (!events) continue;
      creditsKeys++;
      const rows: Row[] = [];
      for (const ev of events) {
        const hit = matchOddsEvent(targets, ev, sport, tour);
        if (!hit) {
          unmatched++;
          continue;
        }
        for (const b of ev.books) {
          rows.push({
            matchId: hit.matchId,
            provider: "oddsapi",
            bookmaker: b.bookmaker,
            home: hit.swapped ? b.away : b.home,
            draw: b.draw,
            away: hit.swapped ? b.home : b.away,
          });
        }
      }
      await save(rows);
      stored += rows.length;
    }
  }

  if (apitennis.apiTennisEnabled() && sportsWithMatches.has("tennis")) {
    const resolver = new Resolver();
    const kv = await prisma.keyValue.findUnique({ where: { key: FIRST_PLAYERS_KEY } });
    const first = (kv?.value ?? {}) as Record<string, { first: string }>;
    const dates = utcDatesCoveringWindow(ctx.now, 0);
    for (const [tour, typeKey] of Object.entries(apitennis.EVENT_TYPES)) {
      const odds = await attempt(`apitennis get_odds ${tour}`, errors, () => apitennis.fetchOdds(dates[0], dates[dates.length - 1], typeKey));
      for (const o of odds ?? []) {
        const matchId = await resolver.lookupExternal("apitennis", "tennis", "MATCH", o.eventKey);
        const firstKey = first[o.eventKey]?.first;
        if (!matchId || !firstKey) {
          unmatched++;
          continue;
        }
        const m = upcoming.find((x) => x.id === matchId);
        const firstPlayerId = await resolver.lookupExternal("apitennis", "tennis", "PLAYER", firstKey);
        if (!m || !firstPlayerId) {
          unmatched++;
          continue;
        }
        const swapped = m.homePlayerId !== firstPlayerId;
        await save(o.bookmakers.map((b) => ({ matchId, provider: "apitennis", bookmaker: b.name, home: swapped ? b.away : b.home, draw: null, away: swapped ? b.home : b.away })));
        stored += o.bookmakers.length;
      }
    }
  }

  const cutoff = new Date(ctx.now.getTime() - 6 * 3600_000);
  const removed = await prisma.matchOdds.deleteMany({ where: { match: { startsAt: { lt: cutoff } } } });
  return { summary: { stored, unmatched, sportKeysFetched: creditsKeys, removedStale: removed.count, sports: SPORT_IDS.filter((s) => sportsWithMatches.has(s)) }, errors };
}

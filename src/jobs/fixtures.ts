import { APISPORTS_PRODUCTS, HIGHLIGHTLY_PRODUCTS } from "../../config/admin";
import { prisma } from "../lib/db";
import { upsertFixtures, type UpsertStats } from "../lib/ingest/upsert";
import { Resolver } from "../lib/ingest/resolve";
import * as apisports from "../lib/providers/apisports";
import * as apitennis from "../lib/providers/apitennis";
import * as footballdata from "../lib/providers/footballdata";
import * as highlightly from "../lib/providers/highlightly";
import * as livetennis from "../lib/providers/livetennis";
import * as sportsdb from "../lib/providers/thesportsdb";
import type { NormFixture } from "../lib/providers/types";
import { SPORT_IDS } from "../lib/sports";
import { utcDatesCoveringWindow } from "../lib/time";
import { attempt, outOfTime, type JobContext, type JobResult } from "./helpers";

function add(total: UpsertStats, s: UpsertStats) {
  total.created += s.created;
  total.updated += s.updated;
  total.unchanged += s.unchanged;
  total.skipped += s.skipped;
}

export const FIRST_PLAYERS_KEY = "apitennis:firstPlayers";

/**
 * API-Tennis odds are keyed by event only ("Home" = first player). Remember which player was first so the odds
 * job can orient prices correctly even when the stored match came from another provider with sides swapped.
 */
async function rememberFirstPlayers(fx: NormFixture[]) {
  const row = await prisma.keyValue.findUnique({ where: { key: FIRST_PLAYERS_KEY } });
  const map = (row?.value ?? {}) as Record<string, { first: string; at: number }>;
  const cutoff = Date.now() - 14 * 86400_000;
  for (const k of Object.keys(map)) if (map[k].at < cutoff) delete map[k];
  for (const f of fx) map[f.externalId] = { first: f.home.externalId, at: f.startsAt.getTime() };
  await prisma.keyValue.upsert({ where: { key: FIRST_PLAYERS_KEY }, create: { key: FIRST_PLAYERS_KEY, value: map }, update: { value: map } });
}

/**
 * Fixtures (and results) for UTC dates covering the 3-calendar-day window in any timezone.
 * Order of preference per sport: football-data (football, one call) -> API-Sports (by date) ->
 * Highlightly (fallback when API-Sports is absent or fails) -> TheSportsDB (schedule gap filler).
 */
export async function refreshFixtures(ctx: JobContext, opts: { daysBack?: number; resultsOnly?: boolean } = {}): Promise<JobResult> {
  const errors: string[] = [];
  const resolver = new Resolver();
  const total: UpsertStats = { created: 0, updated: 0, unchanged: 0, skipped: 0 };
  const perSource: Record<string, number> = {};
  const dates = utcDatesCoveringWindow(ctx.now, opts.daysBack ?? 0);
  const save = async (source: string, fx: NormFixture[]) => {
    perSource[source] = (perSource[source] ?? 0) + fx.length;
    add(total, await upsertFixtures(fx, resolver));
  };

  if (footballdata.footballDataEnabled()) {
    // The free tier limits a range to 10 days; the window is at most 5 dates here.
    const fx = await attempt("footballdata /matches", errors, () => footballdata.fetchMatches(dates[0], dates[dates.length - 1]));
    if (fx) await save("footballdata", fx);
  }

  const apisportsFailed = new Set<string>();
  if (!opts.resultsOnly && apisports.apiSportsEnabled()) {
    for (const product of APISPORTS_PRODUCTS) {
      for (const date of dates) {
        if (outOfTime(ctx)) break;
        const fx = await attempt(`apisports ${product.scope} ${date}`, errors, () => apisports.fetchFixturesByDate(product, date));
        if (fx) await save(`apisports:${product.scope}`, fx);
        else apisportsFailed.add(`${product.sport}|${date}`);
      }
    }
  }

  if (!opts.resultsOnly && highlightly.highlightlyEnabled()) {
    for (const product of HIGHLIGHTLY_PRODUCTS) {
      for (const date of dates) {
        if (outOfTime(ctx)) break;
        const covered = apisports.apiSportsEnabled() && !apisportsFailed.has(`${product.sport}|${date}`);
        if (covered) continue;
        const fx = await attempt(`highlightly ${product.scope} ${date}`, errors, () => highlightly.fetchMatchesByDate(product, date));
        if (fx) await save(`highlightly:${product.scope}`, fx);
      }
    }
  }

  // Tennis: Live Tennis API gives surface + order of play, API-Tennis gives ids, results and odds keys.
  if (!opts.resultsOnly && livetennis.liveTennisEnabled()) {
    for (const tour of ["atp", "wta"] as const) {
      const fx = await attempt(`livetennis fixtures ${tour}`, errors, () => livetennis.fetchFixtures(tour));
      if (fx) await save("livetennis", fx.filter((f) => dates.includes(f.startsAt.toISOString().slice(0, 10))));
    }
  }
  if (apitennis.apiTennisEnabled()) {
    for (const [tour, key] of Object.entries(apitennis.EVENT_TYPES)) {
      const fx = await attempt(`apitennis get_fixtures ${tour}`, errors, () => apitennis.fetchFixtures(dates[0], dates[dates.length - 1], key));
      if (fx) {
        await save("apitennis", fx);
        await rememberFirstPlayers(fx);
      }
    }
  }

  // Schedules, names and badges from TheSportsDB for every sport (free key; quota is generous).
  for (const sport of opts.resultsOnly ? [] : SPORT_IDS) {
    for (const date of dates) {
      if (outOfTime(ctx)) break;
      const fx = await attempt(`thesportsdb ${sport} ${date}`, errors, () => sportsdb.fetchEventsDay(sport, date));
      if (fx) await save(`thesportsdb:${sport}`, fx);
    }
  }

  return { summary: { dates, ...total, perSource }, errors };
}

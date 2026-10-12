import { APISPORTS_PRODUCTS, HIGHLIGHTLY_PRODUCTS } from "../../config/admin";
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

/**
 * Fixtures (and results) for UTC dates covering the 3-calendar-day window in any timezone.
 * Order of preference per sport: football-data (football, one call) -> API-Sports (by date) ->
 * Highlightly (fallback when API-Sports is absent or fails) -> TheSportsDB (schedule gap filler).
 */
export async function refreshFixtures(ctx: JobContext, opts: { daysBack?: number } = {}): Promise<JobResult> {
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
  if (apisports.apiSportsEnabled()) {
    for (const product of APISPORTS_PRODUCTS) {
      for (const date of dates) {
        if (outOfTime(ctx)) break;
        const fx = await attempt(`apisports ${product.scope} ${date}`, errors, () => apisports.fetchFixturesByDate(product, date));
        if (fx) await save(`apisports:${product.scope}`, fx);
        else apisportsFailed.add(`${product.sport}|${date}`);
      }
    }
  }

  if (highlightly.highlightlyEnabled()) {
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
  if (livetennis.liveTennisEnabled()) {
    for (const tour of ["atp", "wta"] as const) {
      const fx = await attempt(`livetennis fixtures ${tour}`, errors, () => livetennis.fetchFixtures(tour));
      if (fx) await save("livetennis", fx.filter((f) => dates.includes(f.startsAt.toISOString().slice(0, 10))));
    }
  }
  if (apitennis.apiTennisEnabled()) {
    for (const [tour, key] of Object.entries(apitennis.EVENT_TYPES)) {
      const fx = await attempt(`apitennis get_fixtures ${tour}`, errors, () => apitennis.fetchFixtures(dates[0], dates[dates.length - 1], key));
      if (fx) await save("apitennis", fx);
    }
  }

  // Schedules, names and badges from TheSportsDB for every sport (free key; quota is generous).
  for (const sport of SPORT_IDS) {
    for (const date of dates) {
      if (outOfTime(ctx)) break;
      const fx = await attempt(`thesportsdb ${sport} ${date}`, errors, () => sportsdb.fetchEventsDay(sport, date));
      if (fx) await save(`thesportsdb:${sport}`, fx);
    }
  }

  return { summary: { dates, ...total, perSource }, errors };
}

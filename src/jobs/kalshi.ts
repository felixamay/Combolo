import { KALSHI_SERIES } from "../../config/admin";
import { prisma } from "../lib/db";
import { matchKalshiGame, type KalshiSide } from "../lib/ingest/kalshi-match";
import type { OddsTarget } from "../lib/ingest/odds-match";
import * as kalshi from "../lib/providers/kalshi";
import { attempt, outOfTime, type JobContext, type JobResult } from "./helpers";

/**
 * Link Kalshi game-winner markets to our upcoming matches and store their current prices.
 * Only events that belong to the sports combo collection are kept, so every stored market can be a combo leg.
 * Links are replaced on every run: a market that disappears from Kalshi (closed, settled) disappears here too.
 */
export async function refreshKalshi(ctx: JobContext): Promise<JobResult> {
  const errors: string[] = [];
  if (!kalshi.kalshiEnabled()) return { summary: { skipped: "FEATURE_KALSHI is off" }, errors };

  const collection = await attempt("kalshi collection", errors, () => kalshi.fetchCollection());
  if (!collection) return { summary: { skipped: "combo collection unavailable" }, errors };

  const upcoming = await prisma.match.findMany({
    where: { status: "SCHEDULED", startsAt: { gt: ctx.now, lt: new Date(ctx.now.getTime() + 4 * 86400_000) } },
    include: { league: { select: { tour: true } } },
  });
  const targets: OddsTarget[] = upcoming.map((m) => ({ id: m.id, sport: m.sportId, startsAt: m.startsAt, homeName: m.homeName, awayName: m.awayName, tour: m.league.tour }));
  const sportsWithMatches = new Set(upcoming.map((m) => m.sportId));
  const inCollection = (eventTicker: string) => collection.eventTickers.has(eventTicker);
  const seriesInCollection = new Set([...collection.eventTickers].map((t) => t.split("-")[0]));

  const rows: Array<{ matchId: string; side: KalshiSide; seriesTicker: string; eventTicker: string; marketTicker: string; eventTitle: string; marketTitle: string; yesAsk: number | null; yesBid: number | null }> = [];
  let games = 0;
  let unmatched = 0;
  let notComboEligible = 0;
  let seriesFetched = 0;
  const failedSports = new Set<string>();
  for (const { series, sport, tour } of KALSHI_SERIES) {
    if (outOfTime(ctx)) break;
    if (!sportsWithMatches.has(sport) || !seriesInCollection.has(series)) continue;
    const list = await attempt(`kalshi events ${series}`, errors, () => kalshi.fetchGames(series));
    if (!list) {
      failedSports.add(sport);
      continue;
    }
    seriesFetched++;
    for (const g of list) {
      games++;
      if (!inCollection(g.eventTicker)) {
        notComboEligible++;
        continue;
      }
      const hit = matchKalshiGame(targets, g, sport, tour);
      if (!hit) {
        unmatched++;
        continue;
      }
      for (const [side, o] of Object.entries(hit.sides) as Array<[KalshiSide, kalshi.KalshiOutcome]>) {
        rows.push({ matchId: hit.matchId, side, seriesTicker: g.seriesTicker, eventTicker: g.eventTicker, marketTicker: o.ticker, eventTitle: g.title, marketTitle: o.name, yesAsk: o.yesAsk, yesBid: o.yesBid });
      }
    }
  }

  // Two Kalshi events resolving to one match would be a matching error: keep neither.
  const eventsPerMatch = new Map<string, Set<string>>();
  for (const r of rows) (eventsPerMatch.get(r.matchId) ?? eventsPerMatch.set(r.matchId, new Set()).get(r.matchId)!).add(r.eventTicker);
  const conflicts = [...eventsPerMatch.values()].filter((s) => s.size > 1).length;
  // A sport whose fetch failed (or was cut short by the deadline) keeps its previous links until the next run.
  const sportOf = new Map(upcoming.map((m) => [m.id, m.sportId]));
  const replaceable = upcoming.filter((m) => !failedSports.has(m.sportId) && !outOfTime(ctx)).map((m) => m.id);
  const replace = new Set(replaceable);
  const clean = rows.filter((r) => eventsPerMatch.get(r.matchId)!.size === 1 && replace.has(r.matchId) && !failedSports.has(sportOf.get(r.matchId)!));

  const now = new Date();
  await prisma.$transaction([
    prisma.kalshiMarket.deleteMany({ where: { matchId: { in: replaceable } } }),
    prisma.kalshiMarket.deleteMany({ where: { match: { startsAt: { lt: ctx.now } } } }),
    prisma.kalshiMarket.createMany({ data: clean.map((r) => ({ ...r, fetchedAt: now })) }),
  ]);
  const linkedMatches = new Set(clean.map((r) => r.matchId)).size;
  return { summary: { seriesFetched, games, linkedMatches, markets: clean.length, unmatched, notComboEligible, conflicts }, errors };
}

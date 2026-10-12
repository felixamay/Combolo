import { prisma } from "../lib/db";
import { predictUpcoming, refreshRatings, runBacktests } from "../lib/model/service";
import { SPORT_IDS } from "../lib/sports";
import { type JobContext, type JobResult } from "./helpers";

/** Recompute Elo + form from stored results, then (re)predict every upcoming match. Pure DB work, no API calls. */
export async function refreshModel(ctx: JobContext): Promise<JobResult> {
  const errors: string[] = [];
  const perSport: Record<string, { matches: number; entities: number }> = {};
  for (const sport of SPORT_IDS) {
    try {
      perSport[sport] = await refreshRatings(sport);
    } catch (e) {
      errors.push(`ratings ${sport}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const pred = await predictUpcoming(ctx.now, 5);
  // Predictions for matches that are over/cancelled are dead weight; the history lives on the combo legs.
  const pruned = await prisma.prediction.deleteMany({ where: { match: { startsAt: { lt: new Date(ctx.now.getTime() - 7 * 86400_000) } } } });
  return { summary: { ...pred, perSport, prunedPredictions: pruned.count }, errors };
}

export async function backtestJob(): Promise<JobResult> {
  const res = await runBacktests();
  return { summary: { results: res }, errors: [] };
}

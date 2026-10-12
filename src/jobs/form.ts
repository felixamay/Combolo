import { HIGHLIGHTLY_PRODUCTS } from "../../config/admin";
import { prisma } from "../lib/db";
import { upsertFixtures } from "../lib/ingest/upsert";
import { Resolver } from "../lib/ingest/resolve";
import * as highlightly from "../lib/providers/highlightly";
import { SPORTS } from "../lib/sports";
import { attempt, isQuotaDenied, outOfTime, usedToday, type JobContext, type JobResult } from "./helpers";

const MIN_FINISHED = 3;
const DAILY_CAP_PER_PRODUCT = 20;

/**
 * Form gap filler: for upcoming teams with fewer than 3 stored results, fetch Highlightly's last-five games once.
 * The games are stored as ordinary historical matches, so Elo/form/H2H all benefit from them.
 */
export async function refreshForm(ctx: JobContext): Promise<JobResult> {
  const errors: string[] = [];
  if (!highlightly.highlightlyEnabled()) return { summary: { skipped: "HIGHLIGHTLY_KEY not set" }, errors };
  const resolver = new Resolver();
  const upcoming = await prisma.match.findMany({
    where: { status: "SCHEDULED", startsAt: { gt: ctx.now, lt: new Date(ctx.now.getTime() + 4 * 86400_000) }, homeTeamId: { not: null } },
    include: { league: { select: { priority: true } } },
  });
  upcoming.sort((a, b) => b.league.priority - a.league.priority || a.startsAt.getTime() - b.startsAt.getTime());

  const teamIds: string[] = [];
  for (const m of upcoming) for (const id of [m.homeTeamId, m.awayTeamId]) if (id && !teamIds.includes(id) && !SPORTS[m.sportId as keyof typeof SPORTS].individual) teamIds.push(id);

  const used = new Map<string, number>();
  let fetched = 0;
  let stored = 0;
  let skipped = 0;
  for (const teamId of teamIds) {
    if (outOfTime(ctx)) break;
    const finished = await prisma.match.count({ where: { status: "FINISHED", OR: [{ homeTeamId: teamId }, { awayTeamId: teamId }] } });
    if (finished >= MIN_FINISHED) continue;
    const extRows = await prisma.externalId.findMany({ where: { provider: "highlightly", entityType: "TEAM", entityId: teamId } });
    const row = extRows.find((r) => HIGHLIGHTLY_PRODUCTS.some((p) => p.scope === r.scope));
    if (!row) {
      skipped++;
      continue;
    }
    const product = highlightly.highlightlyProduct(row.scope);
    if (!used.has(product.scope)) used.set(product.scope, await usedToday("highlightly", product.scope, "last-five"));
    if ((used.get(product.scope) ?? 0) >= DAILY_CAP_PER_PRODUCT) continue;
    used.set(product.scope, (used.get(product.scope) ?? 0) + 1);
    let denied = false;
    const fx = await attempt(`highlightly last-five ${product.scope} ${teamId}`, errors, async () => {
      try {
        return await highlightly.fetchLastFive(product, row.externalId);
      } catch (e) {
        denied = isQuotaDenied(e);
        throw e;
      }
    });
    if (denied) continue;
    if (!fx) continue;
    fetched++;
    stored += (await upsertFixtures(fx.filter((f) => f.status === "FINISHED"), resolver)).created;
  }
  return { summary: { teamsConsidered: teamIds.length, fetched, gamesStored: stored, noHighlightlyId: skipped }, errors };
}

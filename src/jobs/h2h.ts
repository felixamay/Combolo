import type { Match } from "@prisma/client";
import { APISPORTS_PRODUCTS, HIGHLIGHTLY_PRODUCTS, type ApiSportsProduct, type HighlightlyProduct } from "../../config/admin";
import { prisma } from "../lib/db";
import { storeH2H } from "../lib/ingest/h2h";
import { entityKey, pairKeys, sidesOf } from "../lib/ingest/keys";
import { Resolver } from "../lib/ingest/resolve";
import { upsertFixtures } from "../lib/ingest/upsert";
import * as apisports from "../lib/providers/apisports";
import * as apitennis from "../lib/providers/apitennis";
import * as footballdata from "../lib/providers/footballdata";
import * as highlightly from "../lib/providers/highlightly";
import type { NormFixture } from "../lib/providers/types";
import { SPORTS } from "../lib/sports";
import { attempt, isQuotaDenied, outOfTime, usedToday, type JobContext, type JobResult } from "./helpers";

type MatchWithLeague = Match & { league: { priority: number; name: string } };

async function needsH2H(m: Match): Promise<boolean> {
  const s = sidesOf(m);
  if (!s) return false;
  const { keyLow, keyHigh } = pairKeys(s.home, s.away);
  const rec = await prisma.h2HRecord.findUnique({ where: { sportId_keyLow_keyHigh: { sportId: m.sportId, keyLow, keyHigh } } });
  return !rec || rec.stale;
}

async function ext(provider: string, scope: string, type: "TEAM" | "PLAYER" | "MATCH", entityId: string): Promise<string | null> {
  const row = await prisma.externalId.findFirst({ where: { provider, scope, entityType: type, entityId } });
  return row?.externalId ?? null;
}

/**
 * Head-to-head: fetched ONCE per pair and re-fetched only when the pair plays a new match (record flagged stale
 * by the ingest layer). Highest-priority leagues first; per-provider daily budgets are respected.
 */
export async function refreshH2H(ctx: JobContext): Promise<JobResult> {
  const errors: string[] = [];
  const resolver = new Resolver();
  const horizon = new Date(ctx.now.getTime() + 4 * 86400_000);
  const matches = (await prisma.match.findMany({
    where: { status: "SCHEDULED", startsAt: { gt: ctx.now, lt: horizon } },
    include: { league: true },
    orderBy: [{ startsAt: "asc" }],
  })) as MatchWithLeague[];
  matches.sort((a, b) => b.league.priority - a.league.priority || a.startsAt.getTime() - b.startsAt.getTime());

  const stats = { considered: matches.length, fetched: 0, local: 0, skippedFresh: 0, noProvider: 0 };
  const done = new Set<string>();
  const productBudgetUsed = new Map<string, number>();
  const budgetLeft = async (provider: string, scope: string, cap: number) => {
    const k = `${provider}:${scope}`;
    if (!productBudgetUsed.has(k)) productBudgetUsed.set(k, await usedToday(provider, scope, "h2h"));
    return cap - productBudgetUsed.get(k)!;
  };
  const spend = (provider: string, scope: string) => productBudgetUsed.set(`${provider}:${scope}`, (productBudgetUsed.get(`${provider}:${scope}`) ?? 0) + 1);

  for (const m of matches) {
    if (outOfTime(ctx)) break;
    const s = sidesOf(m);
    if (!s) continue;
    const pairId = pairKeys(s.home, s.away).keyLow + pairKeys(s.home, s.away).keyHigh;
    if (done.has(pairId)) continue;
    if (!(await needsH2H(m))) {
      stats.skippedFresh++;
      continue;
    }
    done.add(pairId);
    const a = s.kind === "TEAM" ? m.homeTeamId! : m.homePlayerId!;
    const b = s.kind === "TEAM" ? m.awayTeamId! : m.awayPlayerId!;
    const meta = SPORTS[m.sportId as keyof typeof SPORTS];

    let fixtures: NormFixture[] | undefined;
    let source = "local";

    if (meta.individual) {
      const [ka, kb] = [await ext("apitennis", "tennis", "PLAYER", a), await ext("apitennis", "tennis", "PLAYER", b)];
      const local = await prisma.match.count({ where: { sportId: "tennis", status: "FINISHED", OR: [{ homePlayerId: a, awayPlayerId: b }, { homePlayerId: b, awayPlayerId: a }] } });
      if (apitennis.apiTennisEnabled() && ka && kb && local < 3 && (await budgetLeft("apitennis", "get_H2H", 18)) > 0) {
        spend("apitennis", "get_H2H");
        fixtures = await attempt(`apitennis H2H ${m.homeName} v ${m.awayName}`, errors, () => apitennis.fetchH2H(ka, kb));
        if (fixtures) source = "apitennis";
      }
    } else if (m.sportId === "football" && footballdata.footballDataEnabled() && (await ext("footballdata", "v4", "MATCH", m.id))) {
      const id = (await ext("footballdata", "v4", "MATCH", m.id))!;
      const res = await attempt(`footballdata H2H ${m.homeName} v ${m.awayName}`, errors, () => footballdata.fetchH2H(id, 10));
      if (res) {
        fixtures = res.fixtures;
        source = "footballdata";
      }
    }

    if (!fixtures && !meta.individual) {
      const product: ApiSportsProduct | undefined = APISPORTS_PRODUCTS.find((p) => p.sport === m.sportId);
      let tried = false;
      if (product && apisports.apiSportsEnabled() && (await budgetLeft("apisports", product.scope, product.h2hBudget)) > 0) {
        const [ta, tb] = [await ext("apisports", product.scope, "TEAM", a), await ext("apisports", product.scope, "TEAM", b)];
        if (ta && tb) {
          tried = true;
          spend("apisports", product.scope);
          let denied = false;
          fixtures = await attempt(`apisports H2H ${product.scope} ${m.homeName} v ${m.awayName}`, errors, async () => {
            try {
              return await apisports.fetchH2H(product, ta, tb);
            } catch (e) {
              denied = isQuotaDenied(e);
              throw e;
            }
          });
          if (fixtures) source = "apisports";
          void denied;
        }
      }
      if (!fixtures && highlightly.highlightlyEnabled()) {
        const hps: HighlightlyProduct[] = HIGHLIGHTLY_PRODUCTS.filter((p) => p.sport === m.sportId);
        for (const hp of hps) {
          if ((await budgetLeft("highlightly", hp.scope, hp.h2hBudget)) <= 0) continue;
          const [ta, tb] = [await ext("highlightly", hp.scope, "TEAM", a), await ext("highlightly", hp.scope, "TEAM", b)];
          if (!ta || !tb) continue;
          spend("highlightly", hp.scope);
          fixtures = await attempt(`highlightly H2H ${hp.scope} ${m.homeName} v ${m.awayName}`, errors, () => highlightly.fetchH2H(hp, ta, tb));
          if (fixtures) {
            source = "highlightly";
            break;
          }
        }
      }
      if (!fixtures && !tried) stats.noProvider++;
    }

    if (fixtures) {
      await upsertFixtures(fixtures, resolver);
      stats.fetched++;
    } else if (!meta.individual && source === "local") {
      // No provider could be asked (no ids / no budget): keep the pair stale so a later run retries.
      continue;
    } else {
      stats.local++;
    }
    await storeH2H(m.sportId, s.kind, a, b, source);
  }
  void entityKey;
  return { summary: stats, errors };
}

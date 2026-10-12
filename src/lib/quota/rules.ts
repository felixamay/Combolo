import { getEnv } from "../env";
import type { QuotaBucket } from "./manager";
import { QuotaManager } from "./manager";
import { PrismaQuotaStore } from "./prisma-store";

export type ProviderId = "apisports" | "footballdata" | "highlightly" | "thesportsdb" | "apitennis" | "livetennis" | "oddsapi" | "sackmann";

/** Buckets (and rules) governing one provider/product. Built from env so limits are configurable. */
export function bucketsFor(provider: ProviderId, scope: string): QuotaBucket[] {
  const env = getEnv();
  const reserve = env.QUOTA_SAFETY_RESERVE;
  switch (provider) {
    case "apisports":
      return [
        {
          key: env.APISPORTS_SHARED_QUOTA ? "apisports:shared" : `apisports:${scope}`,
          rules: [{ window: "day", limit: env.APISPORTS_DAILY_LIMIT, reserve }],
        },
        { key: "apisports:minute", rules: [{ window: "minute", limit: env.APISPORTS_MINUTE_LIMIT }] },
      ];
    case "footballdata":
      return [{ key: "footballdata", rules: [{ window: "minute", limit: env.FOOTBALL_DATA_MINUTE_LIMIT }] }];
    case "highlightly":
      return [
        { key: `highlightly:${scope}`, rules: [{ window: "day", limit: env.HIGHLIGHTLY_DAILY_LIMIT, reserve }] },
        { key: "highlightly:minute", rules: [{ window: "minute", limit: env.HIGHLIGHTLY_MINUTE_LIMIT }] },
      ];
    case "thesportsdb":
      return [{ key: "thesportsdb", rules: [{ window: "minute", limit: env.THESPORTSDB_MINUTE_LIMIT }, { window: "day", limit: 2000 }] }];
    case "apitennis":
      return [
        {
          key: "apitennis",
          rules: [
            { window: "month", limit: env.API_TENNIS_MONTHLY_LIMIT, reserve: Math.max(reserve, 20) },
            { window: "day", limit: env.API_TENNIS_DAILY_BUDGET },
            { window: "minute", limit: 20 },
          ],
        },
      ];
    case "livetennis":
      return [
        {
          key: "livetennis",
          rules: [
            { window: "day", limit: env.LIVE_TENNIS_DAILY_LIMIT, reserve },
            { window: "minute", limit: env.LIVE_TENNIS_MINUTE_LIMIT },
          ],
        },
      ];
    case "oddsapi":
      return [
        {
          key: "oddsapi",
          rules: [
            { window: "month", limit: env.ODDS_API_MONTHLY_LIMIT, reserve: Math.max(reserve, 10) },
            { window: "day", limit: env.ODDS_API_DAILY_BUDGET },
            { window: "minute", limit: 30 },
          ],
        },
      ];
    case "sackmann":
      return [{ key: "sackmann", rules: [{ window: "day", limit: 300 }, { window: "minute", limit: 30 }] }];
  }
}

let manager: QuotaManager | undefined;

export function getQuotaManager(): QuotaManager {
  if (!manager) manager = new QuotaManager(new PrismaQuotaStore());
  return manager;
}

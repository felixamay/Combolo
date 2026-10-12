import { z } from "zod";
import { ODDS_API_SPORT_KEYS } from "../../../config/admin";
import { getEnv } from "../env";
import type { SportId } from "../sports";
import { callProvider, headerInt, validateRows, type RemainingInfo } from "./http";
import { num, parseDate } from "./util";

/**
 * The Odds API v4 (optional, behind FEATURE_ODDS). `GET /sports` is free (no credits);
 * `GET /sports/{key}/odds` costs 1 credit per region per market. Free plan: 500 credits / month.
 */

const BASE = "https://api.the-odds-api.com/v4";

export function oddsEnabled(): boolean {
  const env = getEnv();
  return env.FEATURE_ODDS && !!env.ODDS_API_KEY;
}

function parseRemaining(h: Headers): RemainingInfo {
  const remaining = headerInt(h, "x-requests-remaining");
  const used = headerInt(h, "x-requests-used");
  return remaining !== undefined ? { month: { remaining, limit: used !== undefined ? remaining + used : undefined } } : {};
}

const sportsSchema = z.array(z.looseObject({ key: z.string(), active: z.boolean().optional(), title: z.string().optional() }));

export async function listActiveSportKeys(): Promise<Array<{ key: string; sport: SportId }>> {
  const key = getEnv().ODDS_API_KEY;
  if (!key) return [];
  const res = await callProvider({ provider: "oddsapi", scope: "sports", url: `${BASE}/sports`, endpoint: "/sports", query: { apiKey: key }, schema: sportsSchema, cost: 0, parseRemaining });
  const out: Array<{ key: string; sport: SportId }> = [];
  for (const s of res.data) {
    if (s.active === false) continue;
    for (const rule of ODDS_API_SPORT_KEYS) {
      if (new RegExp(rule.keyPattern).test(s.key)) {
        out.push({ key: s.key, sport: rule.sport });
        break;
      }
    }
  }
  return out;
}

const eventRow = z.looseObject({
  id: z.string(),
  commence_time: z.string(),
  home_team: z.string(),
  away_team: z.string(),
  bookmakers: z.array(
    z.looseObject({
      key: z.string(),
      title: z.string().optional(),
      markets: z.array(z.looseObject({ key: z.string(), outcomes: z.array(z.looseObject({ name: z.string(), price: z.number() })) })),
    }),
  ),
});

export interface OddsEvent {
  sportKey: string;
  homeName: string;
  awayName: string;
  startsAt: Date;
  books: Array<{ bookmaker: string; home: number | null; draw: number | null; away: number | null }>;
}

export async function fetchOdds(sportKey: string): Promise<OddsEvent[]> {
  const env = getEnv();
  const regions = env.ODDS_API_REGIONS;
  const cost = regions.split(",").filter(Boolean).length;
  const res = await callProvider({
    provider: "oddsapi",
    scope: sportKey,
    url: `${BASE}/sports/${sportKey}/odds`,
    endpoint: "/sports/{key}/odds",
    query: { apiKey: env.ODDS_API_KEY, regions, markets: "h2h", oddsFormat: "decimal", dateFormat: "iso" },
    schema: z.array(z.unknown()),
    cost,
    parseRemaining,
  });
  const rows = await validateRows("oddsapi", "odds", res.data, eventRow);
  const out: OddsEvent[] = [];
  for (const e of rows) {
    const startsAt = parseDate(e.commence_time);
    if (!startsAt) continue;
    const books: OddsEvent["books"] = [];
    for (const b of e.bookmakers) {
      const m = b.markets.find((x) => x.key === "h2h");
      if (!m) continue;
      const home = m.outcomes.find((o) => o.name === e.home_team)?.price ?? null;
      const away = m.outcomes.find((o) => o.name === e.away_team)?.price ?? null;
      const draw = m.outcomes.find((o) => o.name.toLowerCase() === "draw")?.price ?? null;
      if (home && away && num(home) && num(away)) books.push({ bookmaker: b.title ?? b.key, home, draw, away });
    }
    if (books.length) out.push({ sportKey, homeName: e.home_team, awayName: e.away_team, startsAt, books });
  }
  return out;
}

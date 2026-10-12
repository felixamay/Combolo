import { z } from "zod";
import { getEnv } from "../env";
import { callProvider, headerInt, validateRows, type RemainingInfo } from "./http";
import type { NormFixture } from "./types";
import { num, parseDate } from "./util";

/**
 * Live Tennis API – `https://api.livetennisapi.com/api/public/v1`, header `X-API-Key`.
 * Free tier: /fixtures, /players/{id}, /matches (upcoming/live). H2H, history and rankings listing are paid -> unused.
 */

const BASE = "https://api.livetennisapi.com/api/public/v1";

export function liveTennisEnabled(): boolean {
  return !!getEnv().LIVE_TENNIS_API_KEY;
}

function parseRemaining(h: Headers): RemainingInfo {
  const minute = headerInt(h, "x-ratelimit-remaining");
  return { minuteRemaining: minute };
}

async function get<T>(path: string, schema: z.ZodType<T>, query?: Record<string, string | number>, endpoint = path) {
  const key = getEnv().LIVE_TENNIS_API_KEY;
  if (!key) throw new Error("LIVE_TENNIS_API_KEY not configured");
  return callProvider({ provider: "livetennis", scope: "v1", url: `${BASE}${path}`, endpoint, query, headers: { "X-API-Key": key }, schema, parseRemaining, maxWaitMs: 60_000 });
}

const fixtureRow = z.looseObject({
  id: z.number(),
  event_date: z.string().nullish(),
  start_time: z.string().nullish(),
  player1_id: z.number().nullish(),
  player2_id: z.number().nullish(),
  tour: z.string().nullish(),
  tournament: z.string().nullish(),
  round: z.string().nullish(),
  surface: z.string().nullish(),
  player1_name: z.string().nullish(),
  player2_name: z.string().nullish(),
  status: z.string().nullish(),
});

const listEnvelope = z.looseObject({
  data: z.array(z.unknown()),
  meta: z.looseObject({ has_more: z.boolean().optional(), total: z.number().nullish() }).optional(),
});

/** Upcoming singles fixtures for one tour. Rows without a UTC start time are skipped (date-only fixtures cannot be placed in the window). */
export async function fetchFixtures(tour: "atp" | "wta", maxPages = 4): Promise<NormFixture[]> {
  const out: NormFixture[] = [];
  const limit = 200;
  for (let page = 0; page < maxPages; page++) {
    const res = await get("/fixtures", listEnvelope, { tour, draw: "singles", limit, offset: page * limit });
    const rows = await validateRows("livetennis", "/fixtures", res.data.data, fixtureRow);
    for (const r of rows) {
      const startsAt = parseDate(r.start_time);
      if (!startsAt || !r.player1_name || !r.player2_name || r.player1_id == null || r.player2_id == null) continue;
      out.push({
        provider: "livetennis",
        scope: "v1",
        externalId: String(r.id),
        sport: "tennis",
        league: { externalId: `name:${(r.tournament ?? "tennis").toLowerCase()}`, name: r.tournament ?? "Tennis", tour: tour.toUpperCase() },
        round: r.round ?? null,
        startsAt,
        status: "SCHEDULED",
        statusDetail: r.status ?? null,
        home: { externalId: String(r.player1_id), name: r.player1_name },
        away: { externalId: String(r.player2_id), name: r.player2_name },
        surface: r.surface ?? null,
        individual: true,
        neutralVenue: true,
      });
    }
    if (!res.data.meta?.has_more || res.data.data.length < limit) break;
  }
  return out;
}

const playerRow = z.looseObject({
  id: z.number(),
  name: z.string(),
  tour: z.string().nullish(),
  country: z.string().nullish(),
  ranking: z.number().nullish(),
  ranking_points: z.number().nullish(),
  hand: z.string().nullish(),
});

const playerEnvelope = z.union([z.looseObject({ data: playerRow }), playerRow]);

export interface LiveTennisPlayer {
  id: number;
  name: string;
  tour: string | null;
  country: string | null;
  ranking: number | null;
  rankingPoints: number | null;
  hand: string | null;
}

export async function fetchPlayer(id: string): Promise<LiveTennisPlayer> {
  const res = await get(`/players/${id}`, playerEnvelope, undefined, "/players/{id}");
  const p = "data" in res.data && res.data.data && typeof res.data.data === "object" && "name" in res.data.data ? (res.data.data as z.infer<typeof playerRow>) : (res.data as z.infer<typeof playerRow>);
  return { id: p.id, name: p.name, tour: p.tour ?? null, country: p.country ?? null, ranking: p.ranking ?? null, rankingPoints: p.ranking_points ?? null, hand: p.hand ?? null };
}

void num;

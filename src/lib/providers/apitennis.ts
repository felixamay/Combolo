import { z } from "zod";
import { getEnv } from "../env";
import { callProvider, validateRows } from "./http";
import type { NormFixture, NormStandings, NormStatus } from "./types";
import { num, obj, str } from "./util";

/**
 * API-Tennis.com – `https://api.api-tennis.com/tennis/?method=...&APIkey=...`.
 * Methods used: get_fixtures, get_standings, get_H2H, get_odds (documented, v2.9.5).
 * Event types: 265 = ATP Singles, 266 = WTA Singles.
 */

const ENDPOINT = "https://api.api-tennis.com/tennis/";
export const EVENT_TYPES = { ATP: "265", WTA: "266" } as const;

export function apiTennisEnabled(): boolean {
  return !!getEnv().API_TENNIS_KEY;
}

const envelope = z.looseObject({ success: z.union([z.number(), z.string(), z.boolean()]), result: z.unknown() });

async function call(method: string, query: Record<string, string | number | undefined>) {
  const key = getEnv().API_TENNIS_KEY;
  if (!key) throw new Error("API_TENNIS_KEY not configured");
  const res = await callProvider({
    provider: "apitennis",
    scope: method,
    url: ENDPOINT,
    endpoint: method,
    query: { method, APIkey: key, ...query },
    schema: envelope,
    secretQueryKeys: ["APIkey"],
    detectError: (j) => {
      const o = obj(j);
      if (!o) return null;
      const ok = o.success === 1 || o.success === "1" || o.success === true;
      return ok ? null : `API-Tennis error: ${JSON.stringify(o.result ?? o).slice(0, 200)}`;
    },
    maxWaitMs: 60_000,
    timeoutMs: 45_000,
  });
  return res.data.result;
}

const eventRow = z.looseObject({
  event_key: z.union([z.string(), z.number()]),
  event_date: z.string(),
  event_time: z.string(),
  event_first_player: z.string().min(1),
  first_player_key: z.union([z.string(), z.number()]),
  event_second_player: z.string().min(1),
  second_player_key: z.union([z.string(), z.number()]),
  event_final_result: z.string().nullish(),
  event_winner: z.string().nullish(),
  event_status: z.string().nullish(),
  event_type_type: z.string().nullish(),
  tournament_name: z.string().nullish(),
  tournament_key: z.union([z.string(), z.number()]).nullish(),
  tournament_round: z.string().nullish(),
  tournament_season: z.string().nullish(),
  event_live: z.union([z.string(), z.number()]).nullish(),
  event_first_player_logo: z.string().nullish(),
  event_second_player_logo: z.string().nullish(),
});

function mapStatus(r: z.infer<typeof eventRow>): NormStatus {
  const s = (r.event_status ?? "").toLowerCase();
  if (s.includes("cancel")) return "CANCELLED";
  if (s.includes("postpone")) return "POSTPONED";
  if (s.includes("walk") || s.includes("w.o") || s.includes("abandon")) return "ABANDONED";
  if (s.includes("retired") || s.includes("defaulted")) return r.event_winner ? "FINISHED" : "ABANDONED";
  if (s === "finished") return r.event_winner ? "FINISHED" : "ABANDONED";
  if (r.event_winner) return "FINISHED";
  if (String(r.event_live ?? "0") === "1" || /^set|tiebreak|live/.test(s)) return "LIVE";
  return "SCHEDULED";
}

export function tourOf(eventType: string | null | undefined): "ATP" | "WTA" | null {
  const t = (eventType ?? "").toLowerCase();
  if (t === "atp singles") return "ATP";
  if (t === "wta singles") return "WTA";
  return null;
}

export function normaliseEvent(r: z.infer<typeof eventRow>, historical: boolean): NormFixture | null {
  const tour = tourOf(r.event_type_type);
  if (!tour) return null;
  const startsAt = new Date(`${r.event_date}T${r.event_time.length === 5 ? `${r.event_time}:00` : r.event_time}Z`);
  if (Number.isNaN(startsAt.getTime())) return null;
  const status = mapStatus(r);
  const m = (r.event_final_result ?? "").match(/(\d+)\s*-\s*(\d+)/);
  const winner = status === "FINISHED" ? (r.event_winner === "First Player" ? "HOME" : r.event_winner === "Second Player" ? "AWAY" : null) : null;
  return {
    provider: "apitennis",
    scope: "tennis",
    externalId: String(r.event_key),
    sport: "tennis",
    league: {
      externalId: String(r.tournament_key ?? r.tournament_name ?? "unknown"),
      name: r.tournament_name ?? "Tennis",
      tour,
      season: r.tournament_season ?? null,
    },
    round: r.tournament_round ?? null,
    startsAt,
    status,
    statusDetail: r.event_status ?? null,
    home: { externalId: String(r.first_player_key), name: r.event_first_player, logo: r.event_first_player_logo ?? null },
    away: { externalId: String(r.second_player_key), name: r.event_second_player, logo: r.event_second_player_logo ?? null },
    homeScore: status === "FINISHED" && m ? Number(m[1]) : null,
    awayScore: status === "FINISHED" && m ? Number(m[2]) : null,
    winner,
    individual: true,
    neutralVenue: true,
    historical,
  };
}

export async function fetchFixtures(dateStart: string, dateStop: string, eventTypeKey: string): Promise<NormFixture[]> {
  const result = await call("get_fixtures", { date_start: dateStart, date_stop: dateStop, event_type_key: eventTypeKey, timezone: "UTC" });
  const rows = await validateRows("apitennis", "get_fixtures", Array.isArray(result) ? result : [], eventRow);
  return rows.map((r) => normaliseEvent(r, false)).filter((x): x is NormFixture => !!x);
}

const standingRow = z.looseObject({
  place: z.union([z.string(), z.number()]),
  player: z.string().min(1),
  player_key: z.union([z.string(), z.number()]),
  points: z.union([z.string(), z.number()]).nullish(),
  country: z.string().nullish(),
});

export async function fetchRankings(tour: "ATP" | "WTA"): Promise<NormStandings | null> {
  const result = await call("get_standings", { event_type: tour });
  const rows = await validateRows("apitennis", "get_standings", Array.isArray(result) ? result : [], standingRow);
  const out = rows
    .map((r) => ({
      participant: { externalId: String(r.player_key), name: r.player, country: r.country ?? null },
      position: Number(r.place),
      points: num(r.points),
    }))
    .filter((r) => Number.isFinite(r.position));
  if (out.length === 0) return null;
  return { provider: "apitennis", scope: "tennis", sport: "tennis", league: { externalId: tour, name: `${tour} Rankings`, tour }, rows: out, individual: true };
}

export async function fetchH2H(firstPlayerKey: string, secondPlayerKey: string): Promise<NormFixture[]> {
  const result = await call("get_H2H", { first_player_key: firstPlayerKey, second_player_key: secondPlayerKey });
  const o = obj(result);
  const list = Array.isArray(o?.H2H) ? (o!.H2H as unknown[]) : [];
  const rows = await validateRows("apitennis", "get_H2H", list, eventRow);
  return rows.map((r) => normaliseEvent(r, true)).filter((x): x is NormFixture => !!x);
}

export interface TennisOdds {
  eventKey: string;
  bookmakers: Array<{ name: string; home: number; away: number }>;
}

/** Bookmaker "Home/Away" match-winner odds per event. */
export async function fetchOdds(dateStart: string, dateStop: string, eventTypeKey: string): Promise<TennisOdds[]> {
  const result = await call("get_odds", { date_start: dateStart, date_stop: dateStop, event_type_key: eventTypeKey });
  const o = obj(result);
  if (!o) return [];
  const out: TennisOdds[] = [];
  for (const [eventKey, markets] of Object.entries(o)) {
    const ha = obj(obj(markets)?.["Home/Away"]);
    const home = obj(ha?.Home);
    const away = obj(ha?.Away);
    if (!home || !away) continue;
    const bookmakers: TennisOdds["bookmakers"] = [];
    for (const name of Object.keys(home)) {
      const h = num(home[name]);
      const a = num(away[name]);
      if (h !== null && a !== null && h > 1 && a > 1) bookmakers.push({ name, home: h, away: a });
    }
    if (bookmakers.length) out.push({ eventKey, bookmakers });
  }
  void str;
  return out;
}

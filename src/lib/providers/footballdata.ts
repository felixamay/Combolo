import { z } from "zod";
import { getEnv } from "../env";
import { callProvider, headerInt, validateRows, type RemainingInfo } from "./http";
import { decideWinner, type NormFixture, type NormStandingRow, type NormStandings, type NormStatus } from "./types";
import { num, obj, parseDate, str } from "./util";

/** football-data.org v4. Auth: `X-Auth-Token`. Free tier: 12 competitions, 10 requests/minute. */

const BASE = "https://api.football-data.org/v4";

export function footballDataEnabled(): boolean {
  return !!getEnv().FOOTBALL_DATA_KEY;
}

function parseRemaining(h: Headers): RemainingInfo {
  const r = headerInt(h, "x-requests-available-minute");
  return { minuteRemaining: r };
}

async function get<T>(path: string, schema: z.ZodType<T>, query?: Record<string, string | number>, endpoint = path) {
  const key = getEnv().FOOTBALL_DATA_KEY;
  if (!key) throw new Error("FOOTBALL_DATA_KEY not configured");
  return callProvider({
    provider: "footballdata",
    scope: "v4",
    url: `${BASE}${path}`,
    endpoint,
    query,
    headers: { "X-Auth-Token": key },
    schema,
    parseRemaining,
    detectError: (j) => {
      const o = obj(j);
      return o && typeof o.errorCode === "number" ? `${o.errorCode}: ${String(o.message)}` : null;
    },
    maxWaitMs: 70_000,
  });
}

const team = z.looseObject({ id: z.number(), name: z.string().min(1), shortName: z.string().nullish(), crest: z.string().nullish() });
const scoreSide = z.looseObject({ home: z.number().nullable(), away: z.number().nullable() });

const matchRow = z.looseObject({
  id: z.number(),
  utcDate: z.string(),
  status: z.string(),
  stage: z.string().nullish(),
  matchday: z.number().nullish(),
  competition: z.looseObject({ id: z.number(), name: z.string(), code: z.string().nullish(), emblem: z.string().nullish() }).optional(),
  area: z.looseObject({ name: z.string().nullish() }).nullish(),
  season: z.looseObject({ startDate: z.string().nullish() }).nullish(),
  homeTeam: team,
  awayTeam: team,
  score: z.looseObject({ winner: z.string().nullish(), duration: z.string().nullish(), fullTime: scoreSide.optional(), regularTime: scoreSide.optional() }).optional(),
});

const matchesEnvelope = z.looseObject({ matches: z.array(z.unknown()) });

function mapStatus(s: string): NormStatus {
  switch (s) {
    case "SCHEDULED":
    case "TIMED":
      return "SCHEDULED";
    case "IN_PLAY":
    case "PAUSED":
    case "LIVE":
    case "SUSPENDED":
      return "LIVE";
    case "FINISHED":
      return "FINISHED";
    case "POSTPONED":
      return "POSTPONED";
    case "CANCELLED":
      return "CANCELLED";
    default:
      return "ABANDONED"; // AWARDED (administrative result) and anything unknown are voided
  }
}

export function normaliseMatch(r: z.infer<typeof matchRow>, fallbackCompetition: { id: number; name: string; code?: string | null } | null, historical: boolean): NormFixture | null {
  const startsAt = parseDate(r.utcDate);
  const comp = r.competition ?? fallbackCompetition;
  if (!startsAt || !comp) return null;
  const status = mapStatus(r.status);
  let home: number | null = null;
  let away: number | null = null;
  const duration = r.score?.duration ?? "REGULAR";
  if (status === "FINISHED") {
    if (duration === "REGULAR") {
      home = r.score?.fullTime?.home ?? null;
      away = r.score?.fullTime?.away ?? null;
    } else if (r.score?.regularTime) {
      home = r.score.regularTime.home;
      away = r.score.regularTime.away;
    }
  } else if (status === "LIVE") {
    home = r.score?.fullTime?.home ?? null;
    away = r.score?.fullTime?.away ?? null;
  }
  const season = r.season?.startDate ? r.season.startDate.slice(0, 4) : null;
  return {
    provider: "footballdata",
    scope: "v4",
    externalId: String(r.id),
    sport: "football",
    league: { externalId: String(comp.id), name: comp.name, country: str(r.area?.name), logo: "emblem" in comp ? ((comp as { emblem?: string | null }).emblem ?? null) : null, season },
    round: r.matchday != null ? `Matchday ${r.matchday}` : (r.stage ?? null),
    startsAt,
    status,
    statusDetail: r.status,
    home: { externalId: String(r.homeTeam.id), name: r.homeTeam.name, logo: r.homeTeam.crest ?? null },
    away: { externalId: String(r.awayTeam.id), name: r.awayTeam.name, logo: r.awayTeam.crest ?? null },
    homeScore: home,
    awayScore: away,
    winner: status === "FINISHED" ? decideWinner(home, away, true) : null,
    historical,
  };
}

/** All fixtures for every competition on the token, in a single request (range <= 10 days on the free tier). */
export async function fetchMatches(dateFrom: string, dateTo: string): Promise<NormFixture[]> {
  const res = await get("/matches", matchesEnvelope, { dateFrom, dateTo }, "/matches");
  const rows = await validateRows("footballdata", "/matches", res.data.matches, matchRow);
  return rows.map((r) => normaliseMatch(r, null, false)).filter((x): x is NormFixture => !!x);
}

export interface FootballDataH2H {
  fixtures: NormFixture[];
}

export async function fetchH2H(matchId: string, limit = 10): Promise<FootballDataH2H> {
  const res = await get(`/matches/${matchId}/head2head`, matchesEnvelope, { limit }, "/matches/{id}/head2head");
  const rows = await validateRows("footballdata", "/matches/{id}/head2head", res.data.matches, matchRow);
  return { fixtures: rows.map((r) => normaliseMatch(r, { id: 0, name: "Head to head" }, true)).filter((x): x is NormFixture => !!x) };
}

const tableRow = z.looseObject({
  position: z.number(),
  team,
  playedGames: z.number().nullish(),
  form: z.string().nullish(),
  won: z.number().nullish(),
  draw: z.number().nullish(),
  lost: z.number().nullish(),
  points: z.number().nullish(),
  goalsFor: z.number().nullish(),
  goalsAgainst: z.number().nullish(),
});

const standingsEnvelope = z.looseObject({
  competition: z.looseObject({ id: z.number(), name: z.string(), code: z.string().nullish(), emblem: z.string().nullish() }),
  area: z.looseObject({ name: z.string().nullish() }).nullish(),
  season: z.looseObject({ startDate: z.string().nullish() }).nullish(),
  standings: z.array(z.looseObject({ type: z.string().nullish(), group: z.string().nullish(), table: z.array(z.unknown()) })),
});

export async function fetchStandings(code: string): Promise<NormStandings | null> {
  const res = await get(`/competitions/${code}/standings`, standingsEnvelope, undefined, "/competitions/{code}/standings");
  const d = res.data;
  const totals = d.standings.filter((s) => (s.type ?? "TOTAL") === "TOTAL");
  const homes = d.standings.find((s) => s.type === "HOME");
  const aways = d.standings.find((s) => s.type === "AWAY");
  const recordMap = async (s: typeof homes) => {
    const m = new Map<number, { played?: number; wins?: number; draws?: number; losses?: number }>();
    if (!s) return m;
    for (const r of await validateRows("footballdata", "standings.split", s.table, tableRow)) {
      m.set(r.team.id, { played: r.playedGames ?? undefined, wins: r.won ?? undefined, draws: r.draw ?? undefined, losses: r.lost ?? undefined });
    }
    return m;
  };
  const homeMap = await recordMap(homes);
  const awayMap = await recordMap(aways);
  const rows: NormStandingRow[] = [];
  for (const s of totals) {
    for (const r of await validateRows("footballdata", "standings.table", s.table, tableRow)) {
      rows.push({
        participant: { externalId: String(r.team.id), name: r.team.name, logo: r.team.crest ?? null },
        position: r.position,
        points: r.points ?? null,
        played: r.playedGames ?? null,
        wins: r.won ?? null,
        draws: r.draw ?? null,
        losses: r.lost ?? null,
        goalsFor: r.goalsFor ?? null,
        goalsAgainst: r.goalsAgainst ?? null,
        form: r.form ? r.form.replace(/,/g, "") : null,
        group: s.group ?? null,
        home: homeMap.get(r.team.id) ?? null,
        away: awayMap.get(r.team.id) ?? null,
      });
    }
  }
  if (rows.length === 0) return null;
  return {
    provider: "footballdata",
    scope: "v4",
    sport: "football",
    league: { externalId: String(d.competition.id), name: d.competition.name, country: str(d.area?.name), logo: d.competition.emblem ?? null, season: d.season?.startDate?.slice(0, 4) ?? null },
    rows,
  };
}

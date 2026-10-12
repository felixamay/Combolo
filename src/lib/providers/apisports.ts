import { z } from "zod";
import { APISPORTS_PRODUCTS, type ApiSportsProduct } from "../../../config/admin";
import { getEnv } from "../env";
import { SPORTS } from "../sports";
import { callProvider, headerInt, validateRows, type RemainingInfo } from "./http";
import { decideWinner, type NormFixture, type NormStandingRow, type NormStandings, type NormStatus } from "./types";
import { num, obj, parseDate, scoreOf, str } from "./util";

/**
 * API-Sports (api-football.com + sister APIs). Auth: header `x-apisports-key`.
 * Quota headers: x-ratelimit-requests-limit / -remaining (daily) and X-RateLimit-Limit / -Remaining (minute).
 */

export function apiSportsEnabled(): boolean {
  return !!getEnv().APISPORTS_KEY;
}

export function productFor(scope: string): ApiSportsProduct {
  const p = APISPORTS_PRODUCTS.find((x) => x.scope === scope);
  if (!p) throw new Error(`Unknown API-Sports product ${scope}`);
  return p;
}

const envelope = z.looseObject({
  errors: z.union([z.array(z.unknown()), z.record(z.string(), z.unknown())]).optional(),
  response: z.array(z.unknown()),
});

function detectError(json: unknown): string | null {
  const o = obj(json);
  if (!o) return null;
  const e = o.errors;
  if (Array.isArray(e) && e.length > 0) return e.map(String).join("; ");
  const eo = obj(e);
  if (eo && Object.keys(eo).length > 0) return Object.entries(eo).map(([k, v]) => `${k}: ${String(v)}`).join("; ");
  return null;
}

function parseRemaining(h: Headers): RemainingInfo {
  const dayRemaining = headerInt(h, "x-ratelimit-requests-remaining");
  const dayLimit = headerInt(h, "x-ratelimit-requests-limit");
  const minuteRemaining = headerInt(h, "x-ratelimit-remaining");
  return {
    day: dayRemaining !== undefined ? { remaining: dayRemaining, limit: dayLimit } : undefined,
    minuteRemaining,
  };
}

async function get(product: ApiSportsProduct, path: string, query: Record<string, string | number>) {
  const key = getEnv().APISPORTS_KEY;
  if (!key) throw new Error("APISPORTS_KEY not configured");
  const res = await callProvider({
    provider: "apisports",
    scope: product.scope,
    url: `https://${product.host}${path}`,
    endpoint: `${product.scope}${path}`,
    query,
    headers: { "x-apisports-key": key },
    schema: envelope,
    parseRemaining,
    detectError,
    maxWaitMs: 70_000,
  });
  return res.data.response;
}

/* ---------------------------------------------------------------- status */

const FINISHED = new Set(["FT", "AET", "PEN", "AOT", "AP", "FINAL"]);
const POSTPONED = new Set(["PST", "POST", "POSTPONED"]);
const CANCELLED = new Set(["CANC", "CANCELLED"]);
const VOIDISH = new Set(["ABD", "AWD", "WO"]);

export function mapStatus(short: string | null | undefined): NormStatus | "TBD" {
  const s = (short ?? "").toUpperCase();
  if (!s || s === "NS") return "SCHEDULED";
  if (s === "TBD") return "TBD";
  if (FINISHED.has(s)) return "FINISHED";
  if (POSTPONED.has(s)) return "POSTPONED";
  if (CANCELLED.has(s)) return "CANCELLED";
  if (VOIDISH.has(s)) return "ABANDONED";
  return "LIVE";
}

/* ------------------------------------------------------------ fixtures */

const teamRef = z.looseObject({ id: z.number(), name: z.string().min(1), logo: z.string().nullish() });

const footballRow = z.looseObject({
  fixture: z.looseObject({ id: z.number(), date: z.string(), status: z.looseObject({ short: z.string().nullish() }) }),
  league: z.looseObject({ id: z.number(), name: z.string(), country: z.string().nullish(), logo: z.string().nullish(), season: z.union([z.number(), z.string()]).nullish(), round: z.string().nullish() }),
  teams: z.looseObject({ home: teamRef, away: teamRef }),
  goals: z.looseObject({ home: z.number().nullable(), away: z.number().nullable() }).optional(),
  score: z.looseObject({ fulltime: z.looseObject({ home: z.number().nullable(), away: z.number().nullable() }).optional() }).optional(),
});

const gamesRow = z.looseObject({
  id: z.number(),
  date: z.string(),
  status: z.looseObject({ short: z.string().nullish() }),
  league: z.looseObject({ id: z.number(), name: z.string(), logo: z.string().nullish(), season: z.union([z.number(), z.string()]).nullish() }),
  country: z.looseObject({ name: z.string().nullish() }).nullish(),
  teams: z.looseObject({ home: teamRef, away: teamRef }),
  scores: z.looseObject({ home: z.unknown(), away: z.unknown() }).optional(),
});

function normaliseFootball(product: ApiSportsProduct, r: z.infer<typeof footballRow>, historical: boolean): NormFixture | null {
  const status = mapStatus(r.fixture.status.short);
  const startsAt = parseDate(r.fixture.date);
  if (status === "TBD" || !startsAt) return null;
  const ft = r.score?.fulltime;
  // 1X2 is settled on the 90-minute score; fall back to the final goals when fulltime is absent.
  const homeScore = ft && ft.home !== null && ft.away !== null ? ft.home : (r.goals?.home ?? null);
  const awayScore = ft && ft.home !== null && ft.away !== null ? ft.away : (r.goals?.away ?? null);
  return {
    provider: "apisports",
    scope: product.scope,
    externalId: String(r.fixture.id),
    sport: product.sport,
    league: { externalId: String(r.league.id), name: r.league.name, country: r.league.country ?? null, logo: r.league.logo ?? null, season: r.league.season != null ? String(r.league.season) : null },
    round: r.league.round ?? null,
    startsAt,
    status,
    statusDetail: r.fixture.status.short ?? null,
    home: { externalId: String(r.teams.home.id), name: r.teams.home.name, logo: r.teams.home.logo ?? null },
    away: { externalId: String(r.teams.away.id), name: r.teams.away.name, logo: r.teams.away.logo ?? null },
    homeScore: status === "FINISHED" || status === "LIVE" ? homeScore : null,
    awayScore: status === "FINISHED" || status === "LIVE" ? awayScore : null,
    winner: status === "FINISHED" ? decideWinner(homeScore, awayScore, true) : null,
    historical,
  };
}

function normaliseGame(product: ApiSportsProduct, r: z.infer<typeof gamesRow>, historical: boolean): NormFixture | null {
  const status = mapStatus(r.status.short);
  const startsAt = parseDate(r.date);
  if (status === "TBD" || !startsAt) return null;
  const homeScore = scoreOf(r.scores?.home);
  const awayScore = scoreOf(r.scores?.away);
  const hasDraw = SPORTS[product.sport].hasDraw;
  return {
    provider: "apisports",
    scope: product.scope,
    externalId: String(r.id),
    sport: product.sport,
    league: { externalId: String(r.league.id), name: r.league.name, country: str(r.country?.name), logo: r.league.logo ?? null, season: r.league.season != null ? String(r.league.season) : null },
    startsAt,
    status,
    statusDetail: r.status.short ?? null,
    home: { externalId: String(r.teams.home.id), name: r.teams.home.name, logo: r.teams.home.logo ?? null },
    away: { externalId: String(r.teams.away.id), name: r.teams.away.name, logo: r.teams.away.logo ?? null },
    homeScore: status === "FINISHED" || status === "LIVE" ? homeScore : null,
    awayScore: status === "FINISHED" || status === "LIVE" ? awayScore : null,
    winner: status === "FINISHED" ? decideWinner(homeScore, awayScore, hasDraw) : null,
    historical,
  };
}

async function normaliseRows(product: ApiSportsProduct, rows: unknown[], endpoint: string, historical: boolean): Promise<NormFixture[]> {
  if (product.listPath === "/fixtures") {
    const valid = await validateRows("apisports", endpoint, rows, footballRow);
    return valid.map((r) => normaliseFootball(product, r, historical)).filter((x): x is NormFixture => !!x);
  }
  const valid = await validateRows("apisports", endpoint, rows, gamesRow);
  return valid.map((r) => normaliseGame(product, r, historical)).filter((x): x is NormFixture => !!x);
}

export async function fetchFixturesByDate(product: ApiSportsProduct, date: string): Promise<NormFixture[]> {
  const query: Record<string, string> = { date, timezone: "UTC" };
  const rows = await get(product, product.listPath, query);
  return normaliseRows(product, rows, `${product.scope}${product.listPath}`, false);
}

export async function fetchH2H(product: ApiSportsProduct, idA: string, idB: string): Promise<NormFixture[]> {
  const query: Record<string, string | number> = { h2h: `${idA}-${idB}` };
  if (product.h2hPath === "/fixtures/headtohead") query.last = 10;
  const rows = await get(product, product.h2hPath, query);
  return normaliseRows(product, rows, `${product.scope}${product.h2hPath}`, true);
}

/* ------------------------------------------------------------ standings */

const loose = z.looseObject({});

function recordOf(o: Record<string, unknown> | null) {
  if (!o) return null;
  const goals = obj(o.goals);
  void goals;
  return { played: num(o.played) ?? undefined, wins: num(o.win) ?? undefined, draws: num(o.draw) ?? undefined, losses: num(o.lose) ?? undefined };
}

function rowFromFootball(raw: Record<string, unknown>): NormStandingRow | null {
  const team = obj(raw.team);
  const all = obj(raw.all);
  const id = num(team?.id);
  const name = str(team?.name);
  const position = num(raw.rank);
  if (id === null || !name || position === null) return null;
  const goals = obj(all?.goals);
  return {
    participant: { externalId: String(id), name, logo: str(team?.logo) },
    position,
    points: num(raw.points),
    played: num(all?.played),
    wins: num(all?.win),
    draws: num(all?.draw),
    losses: num(all?.lose),
    goalsFor: num(goals?.for),
    goalsAgainst: num(goals?.against),
    form: str(raw.form),
    group: str(raw.group),
    home: recordOf(obj(raw.home)),
    away: recordOf(obj(raw.away)),
  };
}

function totalOf(x: unknown): number | null {
  return num(x) ?? num(obj(x)?.total);
}

function rowFromGames(raw: Record<string, unknown>): NormStandingRow | null {
  const team = obj(raw.team);
  const id = num(team?.id);
  const name = str(team?.name);
  const position = num(raw.position) ?? num(raw.rank);
  if (id === null || !name || position === null) return null;
  const games = obj(raw.games);
  const wins = (totalOf(games?.win) ?? num(raw.won) ?? 0) + (totalOf(games?.win_overtime) ?? 0);
  const losses = (totalOf(games?.lose) ?? num(raw.lost) ?? 0) + (totalOf(games?.lose_overtime) ?? 0);
  const draws = totalOf(games?.draw) ?? num(raw.ties) ?? 0;
  const played = num(games?.played) ?? wins + losses + draws;
  const goals = obj(raw.goals);
  const pointsObj = obj(raw.points);
  return {
    participant: { externalId: String(id), name, logo: str(team?.logo) },
    position,
    points: typeof raw.points === "number" ? raw.points : (num(obj(raw.group)?.points) ?? null),
    played,
    wins,
    draws,
    losses,
    goalsFor: num(goals?.for) ?? num(pointsObj?.for),
    goalsAgainst: num(goals?.against) ?? num(pointsObj?.against),
    form: str(raw.form),
    group: str(obj(raw.group)?.name) ?? str(raw.stage) ?? str(raw.conference) ?? str(raw.division),
  };
}

export async function fetchStandings(product: ApiSportsProduct, leagueId: string, season: string): Promise<NormStandings | null> {
  const rows = await get(product, "/standings", { league: leagueId, season });
  const flat: Record<string, unknown>[] = [];
  let leagueMeta: Record<string, unknown> | null = null;
  for (const item of rows) {
    const o = obj(item);
    if (!o) continue;
    if (product.scope === "football") {
      const league = obj(o.league);
      leagueMeta = league;
      const groups = Array.isArray(league?.standings) ? (league!.standings as unknown[]) : [];
      for (const g of groups) if (Array.isArray(g)) for (const r of g) { const ro = obj(r); if (ro) flat.push(ro); }
    } else if (Array.isArray(item)) {
      for (const r of item) { const ro = obj(r); if (ro) { flat.push(ro); leagueMeta = leagueMeta ?? obj(ro.league); } }
    } else {
      flat.push(o);
      leagueMeta = leagueMeta ?? obj(o.league);
    }
  }
  const validated = await validateRows("apisports", `${product.scope}/standings`, flat, loose);
  const out: NormStandingRow[] = [];
  for (const r of validated) {
    const row = product.scope === "football" ? rowFromFootball(r) : rowFromGames(r);
    if (row) out.push(row);
  }
  if (out.length === 0) return null;
  return {
    provider: "apisports",
    scope: product.scope,
    sport: product.sport,
    league: { externalId: leagueId, name: str(leagueMeta?.name) ?? "", country: str(leagueMeta?.country), season },
    rows: out,
  };
}

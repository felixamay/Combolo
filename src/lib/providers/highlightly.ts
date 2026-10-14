import { z } from "zod";
import { HIGHLIGHTLY_PRODUCTS, type HighlightlyProduct } from "../../../config/admin";
import { getEnv } from "../env";
import { SPORTS } from "../sports";
import { callProvider, headerInt, validateRows, type RemainingInfo } from "./http";
import { decideWinner, type NormFixture, type NormStandingRow, type NormStandings, type NormStatus } from "./types";
import { num, obj, parseDate, parseScoreString, str } from "./util";

/**
 * Highlightly (highlightly.net) – one host per sport, header `x-rapidapi-key` (direct Highlightly key).
 * Response headers x-ratelimit-requests-limit / -remaining describe the daily plan quota.
 * Documented endpoints used: /matches, /head-2-head, /standings (see docs/INTEGRATION_PLAN.md).
 */

/** Products whose /standings returns the classic `groups[].standings[]` shape. */
const STANDINGS_SUPPORTED = new Set(["soccer", "basketball", "hockey", "rugby", "volleyball", "handball"]);

export function highlightlyEnabled(): boolean {
  return !!getEnv().HIGHLIGHTLY_KEY;
}

export function highlightlyProduct(scope: string): HighlightlyProduct {
  const p = HIGHLIGHTLY_PRODUCTS.find((x) => x.scope === scope);
  if (!p) throw new Error(`Unknown Highlightly product ${scope}`);
  return p;
}

export function standingsSupported(product: HighlightlyProduct): boolean {
  return STANDINGS_SUPPORTED.has(product.scope);
}

function parseRemaining(h: Headers): RemainingInfo {
  const remaining = headerInt(h, "x-ratelimit-requests-remaining");
  const limit = headerInt(h, "x-ratelimit-requests-limit");
  return remaining !== undefined ? { day: { remaining, limit } } : {};
}

async function get<T>(product: HighlightlyProduct, path: string, schema: z.ZodType<T>, query?: Record<string, string | number>) {
  const key = getEnv().HIGHLIGHTLY_KEY;
  if (!key) throw new Error("HIGHLIGHTLY_KEY not configured");
  return callProvider({
    provider: "highlightly",
    scope: product.scope,
    url: `https://${product.host}${path}`,
    endpoint: `${product.scope}${path}`,
    query,
    headers: { "x-rapidapi-key": key },
    schema,
    parseRemaining,
    maxWaitMs: 30_000,
  });
}

const teamRef = z.looseObject({ id: z.number(), name: z.string().min(1), logo: z.string().nullish() });

const matchRow = z.looseObject({
  id: z.number(),
  date: z.string(),
  round: z.union([z.string(), z.number()]).nullish(),
  season: z.union([z.number(), z.string()]).nullish(),
  league: z.union([z.string(), z.looseObject({ id: z.number(), name: z.string(), season: z.union([z.number(), z.string()]).nullish(), logo: z.string().nullish() })]),
  country: z.looseObject({ name: z.string().nullish() }).nullish(),
  homeTeam: teamRef,
  awayTeam: teamRef,
  state: z.looseObject({ description: z.string().nullish(), score: z.unknown().optional() }),
});

const matchesEnvelope = z.looseObject({
  data: z.array(z.unknown()),
  pagination: z.looseObject({ totalCount: z.number(), offset: z.number(), limit: z.number() }).optional(),
});

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function mapState(desc: string | null | undefined): NormStatus | "TBA" {
  const d = (desc ?? "").toLowerCase();
  if (!d || d === "not started") return "SCHEDULED";
  if (d.includes("to be announced") || d === "tba") return "TBA";
  if (d.startsWith("finished") || d === "final" || d.startsWith("ended")) return "FINISHED";
  if (d.includes("postponed")) return "POSTPONED";
  if (d.includes("cancel")) return "CANCELLED";
  if (d.includes("abandon") || d.includes("awarded")) return "ABANDONED";
  return "LIVE";
}

function sumArray(x: unknown): number | null {
  if (!Array.isArray(x) || x.length === 0) return null;
  let t = 0;
  for (const v of x) {
    const n = num(v);
    if (n === null) return null;
    t += n;
  }
  return t;
}

function extractScore(score: unknown): { home: number; away: number } | null {
  const o = obj(score);
  if (!o) return null;
  const cur = parseScoreString(o.current);
  if (cur) return cur;
  const h = sumArray(o.homeTeam);
  const a = sumArray(o.awayTeam);
  return h !== null && a !== null ? { home: h, away: a } : null;
}

export function normaliseMatch(product: HighlightlyProduct, r: z.infer<typeof matchRow>, historical: boolean): NormFixture | null {
  const startsAt = parseDate(r.date);
  const status = mapState(r.state.description);
  if (!startsAt || status === "TBA") return null;
  const leagueObj = typeof r.league === "string" ? null : r.league;
  const leagueName = typeof r.league === "string" ? r.league : r.league.name;
  const season = leagueObj?.season ?? r.season;
  const hasDraw = SPORTS[product.sport].hasDraw;
  const score = extractScore(r.state.score);
  const afterExtra = /after (extra|penal)/i.test(r.state.description ?? "") && product.sport === "football";
  const finishedScore = status === "FINISHED" && !afterExtra ? score : null;
  return {
    provider: "highlightly",
    scope: product.scope,
    externalId: String(r.id),
    sport: product.sport,
    league: {
      externalId: leagueObj ? String(leagueObj.id) : `name:${slug(leagueName)}`,
      name: leagueName,
      country: str(r.country?.name),
      logo: leagueObj?.logo ?? null,
      season: season != null ? String(season) : null,
    },
    round: r.round != null ? String(r.round) : null,
    startsAt,
    status,
    statusDetail: r.state.description ?? null,
    home: { externalId: String(r.homeTeam.id), name: r.homeTeam.name, logo: r.homeTeam.logo ?? null },
    away: { externalId: String(r.awayTeam.id), name: r.awayTeam.name, logo: r.awayTeam.logo ?? null },
    homeScore: status === "FINISHED" || status === "LIVE" ? (score?.home ?? null) : null,
    awayScore: status === "FINISHED" || status === "LIVE" ? (score?.away ?? null) : null,
    winner: finishedScore ? decideWinner(finishedScore.home, finishedScore.away, hasDraw) : null,
    historical,
  };
}

/** All matches on a UTC date, following `offset` pagination (limit 100 is the documented maximum). */
export async function fetchMatchesByDate(product: HighlightlyProduct, date: string, maxPages = 5): Promise<NormFixture[]> {
  const out: NormFixture[] = [];
  let offset = 0;
  for (let page = 0; page < maxPages; page++) {
    const res = await get(product, "/matches", matchesEnvelope, { date, timezone: "Etc/UTC", limit: 100, offset });
    const rows = await validateRows("highlightly", `${product.scope}/matches`, res.data.data, matchRow);
    for (const r of rows) {
      const n = normaliseMatch(product, r, false);
      if (n) out.push(n);
    }
    const total = res.data.pagination?.totalCount ?? res.data.data.length;
    offset += res.data.data.length;
    if (res.data.data.length === 0 || offset >= total) break;
  }
  return out;
}

const h2hEnvelope = z.union([z.array(z.unknown()), z.looseObject({ data: z.array(z.unknown()) })]);

export async function fetchH2H(product: HighlightlyProduct, teamIdOne: string, teamIdTwo: string): Promise<NormFixture[]> {
  const res = await get(product, "/head-2-head", h2hEnvelope, { teamIdOne, teamIdTwo });
  const raw = Array.isArray(res.data) ? res.data : res.data.data;
  const rows = await validateRows("highlightly", `${product.scope}/head-2-head`, raw, matchRow);
  return rows.map((r) => normaliseMatch(product, r, true)).filter((x): x is NormFixture => !!x);
}

export async function fetchLastFive(product: HighlightlyProduct, teamId: string): Promise<NormFixture[]> {
  const res = await get(product, "/last-five-games", h2hEnvelope, { teamId });
  const raw = Array.isArray(res.data) ? res.data : res.data.data;
  const rows = await validateRows("highlightly", `${product.scope}/last-five-games`, raw, matchRow);
  return rows.map((r) => normaliseMatch(product, r, true)).filter((x): x is NormFixture => !!x);
}

const standingsEnvelope = z.looseObject({ groups: z.array(z.looseObject({ name: z.string().nullish(), standings: z.array(z.unknown()) })) });
const standingsRow = z.looseObject({ team: teamRef, position: z.number() });

export async function fetchStandings(product: HighlightlyProduct, leagueId: string, season: string): Promise<NormStandings | null> {
  if (!standingsSupported(product)) return null;
  const res = await get(product, "/standings", standingsEnvelope, { leagueId, season });
  const rows: NormStandingRow[] = [];
  for (const g of res.data.groups) {
    for (const r of await validateRows("highlightly", `${product.scope}/standings`, g.standings, standingsRow)) {
      const total = obj((r as Record<string, unknown>).total);
      const flat = r as Record<string, unknown>;
      const src = total ?? flat;
      const wins = (num(src.wins) ?? 0) + (num(src.winsOvertime) ?? 0);
      const losses = (num(src.loses) ?? 0) + (num(src.losesOvertime) ?? 0);
      const draws = num(src.draws) ?? 0;
      rows.push({
        participant: { externalId: String(r.team.id), name: r.team.name, logo: r.team.logo ?? null },
        position: r.position,
        points: num(flat.points),
        played: num(src.games) ?? num(src.gamesPlayed) ?? wins + losses + draws,
        wins,
        draws,
        losses,
        goalsFor: num(src.scoredGoals) ?? num(src.scoredPoints),
        goalsAgainst: num(src.receivedGoals) ?? num(src.receivedPoints),
        group: g.name ?? null,
      });
    }
  }
  if (rows.length === 0) return null;
  return { provider: "highlightly", scope: product.scope, sport: product.sport, league: { externalId: leagueId, name: "", season }, rows };
}

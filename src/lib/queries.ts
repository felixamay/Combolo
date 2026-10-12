import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { loadMeetings } from "./ingest/h2h";
import { pairKeys, sidesOf } from "./ingest/keys";
import { excludedSources } from "./model/service";
import type { SportId } from "./sports";
import { getComboWindow } from "./time";

export interface Freshness {
  lastRefreshAt: Date | null;
  lastResultsAt: Date | null;
  lastStandingsAt: Date | null;
  lastOddsAt: Date | null;
  providers: Array<{ provider: string; lastOkAt: Date | null; callsToday: number; lastError: string | null }>;
}

const utcMidnight = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
};

/** "Data last updated" indicators shown on pages. Everything comes from job/log tables, never from a provider call. */
export async function getFreshness(): Promise<Freshness> {
  const [refresh, results, standings, odds, okCalls, todayCalls, errCalls] = await Promise.all([
    prisma.jobRun.findFirst({ where: { name: { in: ["refresh", "bootstrap"] }, status: { in: ["ok", "partial"] } }, orderBy: { finishedAt: "desc" } }),
    prisma.jobRun.findFirst({ where: { name: "results", status: { in: ["ok", "partial"] } }, orderBy: { finishedAt: "desc" } }),
    prisma.rankingSnapshot.aggregate({ _max: { capturedAt: true } }),
    prisma.matchOdds.aggregate({ _max: { fetchedAt: true } }),
    prisma.apiCallLog.groupBy({ by: ["provider"], where: { ok: true }, _max: { calledAt: true } }),
    prisma.apiCallLog.groupBy({ by: ["provider"], where: { calledAt: { gte: utcMidnight() }, httpStatus: { not: null } }, _count: { _all: true } }),
    prisma.apiCallLog.findMany({ where: { ok: false, error: { not: null } }, orderBy: { calledAt: "desc" }, take: 50, select: { provider: true, error: true } }),
  ]);
  const providers = new Set<string>([...okCalls.map((r) => r.provider), ...todayCalls.map((r) => r.provider)]);
  return {
    lastRefreshAt: refresh?.finishedAt ?? null,
    lastResultsAt: results?.finishedAt ?? null,
    lastStandingsAt: standings._max.capturedAt,
    lastOddsAt: odds._max.fetchedAt,
    providers: [...providers].sort().map((provider) => ({
      provider,
      lastOkAt: okCalls.find((r) => r.provider === provider)?._max.calledAt ?? null,
      callsToday: todayCalls.find((r) => r.provider === provider)?._count._all ?? 0,
      lastError: errCalls.find((r) => r.provider === provider)?.error ?? null,
    })),
  };
}

export type WindowMatch = Prisma.MatchGetPayload<{ include: { league: true; prediction: true } }>;

/** Scheduled matches inside the 3-calendar-day window (user timezone), earliest first. */
export async function windowMatches(opts: { tz: string; sport?: SportId; now?: Date }): Promise<{ matches: WindowMatch[]; window: ReturnType<typeof getComboWindow> }> {
  const now = opts.now ?? new Date();
  const window = getComboWindow(now, opts.tz);
  const matches = await prisma.match.findMany({
    where: { status: "SCHEDULED", startsAt: { gt: now, lt: window.end }, ...(opts.sport ? { sportId: opts.sport } : {}) },
    include: { league: true, prediction: true },
    orderBy: [{ startsAt: "asc" }, { id: "asc" }],
  });
  return { matches, window };
}

export async function windowCounts(tz: string, now = new Date()): Promise<{ bySport: Record<string, { total: number; eligible: number }>; total: number; eligible: number }> {
  const { matches } = await windowMatches({ tz, now });
  const bySport: Record<string, { total: number; eligible: number }> = {};
  for (const m of matches) {
    const s = (bySport[m.sportId] ??= { total: 0, eligible: 0 });
    s.total++;
    if (m.prediction?.eligible) s.eligible++;
  }
  return { bySport, total: matches.length, eligible: Object.values(bySport).reduce((n, s) => n + s.eligible, 0) };
}

export interface StandingsTable {
  scopeKey: string;
  title: string;
  country: string | null;
  leagueId: string | null;
  snapshotDate: Date;
  capturedAt: Date;
  source: string;
  season: string | null;
  rows: Array<Prisma.RankingSnapshotGetPayload<object>>;
}

/** Latest standings (team sports) or rankings (tennis) per scope for a sport. */
export async function standingsFor(sport: SportId): Promise<StandingsTable[]> {
  const latest = await prisma.rankingSnapshot.groupBy({ by: ["scopeKey"], where: { sportId: sport }, _max: { snapshotDate: true } });
  const tables: StandingsTable[] = [];
  for (const l of latest) {
    if (!l._max.snapshotDate) continue;
    const rows = await prisma.rankingSnapshot.findMany({
      where: { scopeKey: l.scopeKey, snapshotDate: l._max.snapshotDate },
      orderBy: [{ groupName: "asc" }, { position: "asc" }],
      take: l.scopeKey.startsWith("tennis:") ? 200 : 1000,
    });
    if (rows.length === 0) continue;
    const league = rows[0].leagueId ? await prisma.league.findUnique({ where: { id: rows[0].leagueId } }) : null;
    tables.push({
      scopeKey: l.scopeKey,
      title: league?.name ?? (l.scopeKey.startsWith("tennis:") ? `${l.scopeKey.split(":")[1]} singles ranking` : l.scopeKey),
      country: league?.country ?? null,
      leagueId: league?.id ?? null,
      snapshotDate: l._max.snapshotDate,
      capturedAt: rows.reduce((m, r) => (r.capturedAt > m ? r.capturedAt : m), rows[0].capturedAt),
      source: rows[0].source,
      season: rows[0].season,
      rows,
    });
  }
  return tables.sort((a, b) => (b.rows.length > 0 ? 1 : 0) - (a.rows.length > 0 ? 1 : 0) || a.title.localeCompare(b.title));
}

export interface FormDetail {
  date: string;
  opponent: string;
  result: string;
  score: string | null;
  home: boolean;
}

export interface SideDetail {
  name: string;
  logo: string | null;
  key: string | null;
  standing: Prisma.RankingSnapshotGetPayload<object> | null;
  form: { results: string; details: FormDetail[] } | null;
  elo: { overall: number | null; overallMatches: number; surface: number | null; surfaceMatches: number };
}

export async function matchDetail(id: string) {
  const match = await prisma.match.findUnique({ where: { id }, include: { league: true, prediction: true, odds: true } });
  if (!match) return null;
  const sides = sidesOf(match);
  const excluded = excludedSources();

  const side = async (which: "home" | "away"): Promise<SideDetail> => {
    const key = sides ? sides[which] : null;
    const name = which === "home" ? match.homeName : match.awayName;
    const logo = which === "home" ? match.homeLogo : match.awayLogo;
    if (!key) return { name, logo, key, standing: null, form: null, elo: { overall: null, overallMatches: 0, surface: null, surfaceMatches: 0 } };
    const tennis = match.sportId === "tennis";
    const standing = await prisma.rankingSnapshot.findFirst({
      where: { entityKey: key, scopeKey: tennis ? { startsWith: "tennis:" } : `league:${match.leagueId}` },
      orderBy: { snapshotDate: "desc" },
    });
    const chosen =
      standing ?? (tennis ? null : await prisma.rankingSnapshot.findFirst({ where: { entityKey: key, scopeKey: { startsWith: "league:" } }, orderBy: [{ snapshotDate: "desc" }, { played: "desc" }] }));
    const form = await prisma.formSnapshot.findUnique({ where: { sportId_entityKey: { sportId: match.sportId, entityKey: key } } });
    const eloRows = await prisma.eloRating.findMany({ where: { sportId: match.sportId, entityKey: key, surface: { in: ["overall", ...(match.surface ? [match.surface] : [])] } } });
    const overall = eloRows.find((r) => r.surface === "overall");
    const surf = match.surface ? eloRows.find((r) => r.surface === match.surface) : undefined;
    return {
      name,
      logo,
      key,
      standing: chosen,
      form: form ? { results: form.results, details: form.details as unknown as FormDetail[] } : null,
      elo: { overall: overall?.rating ?? null, overallMatches: overall?.matches ?? 0, surface: surf?.rating ?? null, surfaceMatches: surf?.matches ?? 0 },
    };
  };

  const [home, away] = await Promise.all([side("home"), side("away")]);
  const meetings = sides ? await loadMeetings(match.sportId, sides.kind, sides.home.slice(2), sides.away.slice(2), 100) : [];
  const h2hRecord = sides
    ? await prisma.h2HRecord.findUnique({ where: { sportId_keyLow_keyHigh: { sportId: match.sportId, ...pairKeys(sides.home, sides.away) } } })
    : null;
  return { match, home, away, meetings, h2hRecord, excludedSources: excluded };
}

export type ComboListItem = Prisma.ComboGetPayload<{ include: { legs: { select: { result: true; sportId: true } } } }>;

export async function activeCombos(opts: { sport?: SportId | null }): Promise<ComboListItem[]> {
  return prisma.combo.findMany({
    where: { status: "ACTIVE", ...(opts.sport === undefined ? {} : opts.sport === null ? { kind: "MIXED" } : { kind: "SINGLE_SPORT", sportId: opts.sport }) },
    include: { legs: { select: { result: true, sportId: true } } },
    orderBy: [{ requestedSize: "asc" }, { strategy: "asc" }],
  });
}

export async function comboDetail(id: string) {
  return prisma.combo.findUnique({
    where: { id },
    include: { legs: { include: { match: { include: { league: true, prediction: true } } }, orderBy: { position: "asc" } } },
  });
}

export async function leaguesWithUpcoming(now = new Date()) {
  return prisma.league.findMany({
    where: { matches: { some: { status: "SCHEDULED", startsAt: { gt: now, lt: new Date(now.getTime() + 5 * 86400_000) } } } },
    orderBy: [{ sportId: "asc" }, { priority: "desc" }, { name: "asc" }],
    select: { id: true, name: true, sportId: true, country: true },
  });
}

export async function latestBacktests() {
  const rows = await prisma.backtestResult.findMany({ orderBy: { createdAt: "desc" } });
  const seen = new Set<string>();
  return rows.filter((r) => (seen.has(r.sportId) ? false : (seen.add(r.sportId), true)));
}

export async function comboHistory(opts: { status?: string; size?: number; take?: number }) {
  return prisma.combo.findMany({
    where: {
      status: opts.status ? (opts.status as never) : { in: ["LOCKED", "WON", "LOST", "VOID"] },
      ...(opts.size ? { size: opts.size } : {}),
    },
    include: { legs: { select: { result: true, sportId: true } } },
    orderBy: { firstLegStartsAt: "desc" },
    take: opts.take ?? 100,
  });
}

import type { Match, Prisma } from "@prisma/client";
import { MODEL, MODEL_VERSION } from "../../../config/admin";
import { prisma } from "../db";
import { getEnv } from "../env";
import { entityKey, sidesOf, type EntityKind } from "../ingest/keys";
import { SPORTS, SPORT_IDS, type SportId } from "../sports";
import { backtest } from "./backtest";
import { replayElo, type EloMatch } from "./elo";
import { predictMatch, type H2HMeeting, type Result, type SideInfo, type StandingInfo } from "./predict";

/** In commercial mode the CC BY-NC-SA Sackmann rows are excluded from every computation. */
export function excludedSources(): string[] {
  return getEnv().TENNIS_COMMERCIAL_MODE ? ["sackmann"] : [];
}

export function matchSidesKeys(m: Pick<Match, "homeTeamId" | "awayTeamId" | "homePlayerId" | "awayPlayerId">) {
  return sidesOf(m);
}

function toEloMatch(m: Match): EloMatch | null {
  const s = sidesOf(m);
  if (!s || !m.winner) return null;
  return {
    id: m.id,
    a: s.home,
    b: s.away,
    winner: m.winner === "HOME" ? "A" : m.winner === "AWAY" ? "B" : "DRAW",
    at: m.startsAt.getTime(),
    surface: m.surface,
    neutral: m.neutralVenue,
    margin: m.homeScore != null && m.awayScore != null ? Math.abs(m.homeScore - m.awayScore) : null,
    sport: m.sportId,
  };
}

async function finishedMatches(sport: SportId): Promise<Match[]> {
  return prisma.match.findMany({
    where: { sportId: sport, status: "FINISHED", winner: { not: null }, primarySource: { notIn: excludedSources() } },
    orderBy: [{ startsAt: "asc" }, { id: "asc" }],
  });
}

/** Recompute Elo (overall + per surface) and form snapshots for one sport from every stored finished match. */
export async function refreshRatings(sport: SportId): Promise<{ matches: number; entities: number }> {
  const finished = await finishedMatches(sport);
  const elo = finished.map(toEloMatch).filter((m): m is EloMatch => !!m);
  const sys = replayElo(elo, MODEL.elo);

  const rows: Prisma.EloRatingCreateManyInput[] = [];
  for (const [key, e] of sys.ratings) {
    const lastAt = e.lastAt ? new Date(e.lastAt) : null;
    rows.push({ sportId: sport, entityKey: key, surface: "overall", rating: e.overall, matches: e.matches, lastMatchAt: lastAt });
    for (const [surface, s] of Object.entries(e.surfaces)) rows.push({ sportId: sport, entityKey: key, surface, rating: s.rating, matches: s.matches, lastMatchAt: lastAt });
  }
  await prisma.$transaction([prisma.eloRating.deleteMany({ where: { sportId: sport } }), prisma.eloRating.createMany({ data: rows })]);

  const upcoming = await prisma.match.findMany({ where: { sportId: sport, status: "SCHEDULED", startsAt: { gte: new Date(Date.now() - 6 * 3600_000), lte: new Date(Date.now() + 5 * 86400_000) } } });
  const wanted = new Set<string>();
  for (const m of upcoming) {
    const s = sidesOf(m);
    if (s) {
      wanted.add(s.home);
      wanted.add(s.away);
    }
  }
  const lastByEntity = new Map<string, Array<{ date: string; opponent: string; result: Result; score: string | null; home: boolean }>>();
  for (let i = finished.length - 1; i >= 0; i--) {
    const m = finished[i];
    const s = sidesOf(m);
    if (!s || !m.winner) continue;
    for (const [self, isHome] of [[s.home, true], [s.away, false]] as const) {
      if (!wanted.has(self)) continue;
      const list = lastByEntity.get(self) ?? [];
      if (list.length >= 10) continue;
      const result: Result = m.winner === "DRAW" ? "D" : (m.winner === "HOME") === isHome ? "W" : "L";
      list.push({
        date: m.startsAt.toISOString().slice(0, 10),
        opponent: isHome ? m.awayName : m.homeName,
        result,
        score: m.homeScore != null && m.awayScore != null ? `${m.homeScore}-${m.awayScore}` : null,
        home: isHome,
      });
      lastByEntity.set(self, list);
    }
  }
  for (const [key, list] of lastByEntity) {
    await prisma.formSnapshot.upsert({
      where: { sportId_entityKey: { sportId: sport, entityKey: key } },
      create: { sportId: sport, entityKey: key, results: list.map((x) => x.result).join(""), sample: list.length, details: list, source: "stored-results" },
      update: { results: list.map((x) => x.result).join(""), sample: list.length, details: list, source: "stored-results", computedAt: new Date() },
    });
  }
  return { matches: elo.length, entities: sys.ratings.size };
}

/* ------------------------------------------------------------------------ */
/* Prediction                                                                */
/* ------------------------------------------------------------------------ */

interface Preloaded {
  standings: Map<string, Array<{ scopeKey: string; snapshotDate: Date; position: number; points: number | null; played: number | null; wins: number | null; draws: number | null; losses: number | null; goalsFor: number | null; goalsAgainst: number | null; form: string | null; source: string }>>;
  elo: Map<string, Map<string, { rating: number; matches: number }>>;
  form: Map<string, string>;
  meetings: Match[];
}

async function preload(sport: SportId, matches: Match[]): Promise<Preloaded> {
  const keys = new Set<string>();
  const teamIds = new Set<string>();
  const playerIds = new Set<string>();
  for (const m of matches) {
    const s = sidesOf(m);
    if (!s) continue;
    keys.add(s.home);
    keys.add(s.away);
    if (s.kind === "TEAM") {
      teamIds.add(m.homeTeamId!);
      teamIds.add(m.awayTeamId!);
    } else {
      playerIds.add(m.homePlayerId!);
      playerIds.add(m.awayPlayerId!);
    }
  }
  const keyList = [...keys];
  const snaps = await prisma.rankingSnapshot.findMany({ where: { sportId: sport, entityKey: { in: keyList } }, orderBy: { snapshotDate: "desc" } });
  const standings: Preloaded["standings"] = new Map();
  const latestByScope = new Map<string, Date>();
  for (const s of snaps) {
    const scopeId = `${s.entityKey}|${s.scopeKey}`;
    if (latestByScope.has(scopeId)) continue;
    latestByScope.set(scopeId, s.snapshotDate);
    const list = standings.get(s.entityKey) ?? [];
    list.push({ scopeKey: s.scopeKey, snapshotDate: s.snapshotDate, position: s.position, points: s.points, played: s.played, wins: s.wins, draws: s.draws, losses: s.losses, goalsFor: s.goalsFor, goalsAgainst: s.goalsAgainst, form: s.form, source: s.source });
    standings.set(s.entityKey, list);
  }
  const eloRows = await prisma.eloRating.findMany({ where: { sportId: sport, entityKey: { in: keyList } } });
  const elo: Preloaded["elo"] = new Map();
  for (const r of eloRows) {
    const m = elo.get(r.entityKey) ?? new Map();
    m.set(r.surface, { rating: r.rating, matches: r.matches });
    elo.set(r.entityKey, m);
  }
  const formRows = await prisma.formSnapshot.findMany({ where: { sportId: sport, entityKey: { in: keyList } } });
  const form = new Map(formRows.map((f) => [f.entityKey, f.results]));
  const meetings = await prisma.match.findMany({
    where: {
      sportId: sport,
      status: "FINISHED",
      winner: { not: null },
      primarySource: { notIn: excludedSources() },
      ...(teamIds.size ? { homeTeamId: { in: [...teamIds] }, awayTeamId: { in: [...teamIds] } } : { homePlayerId: { in: [...playerIds] }, awayPlayerId: { in: [...playerIds] } }),
    },
    orderBy: { startsAt: "desc" },
  });
  return { standings, elo, form, meetings };
}

function pickStanding(pre: Preloaded, key: string, scopeKey: string): StandingInfo | null {
  const list = pre.standings.get(key);
  if (!list || list.length === 0) return null;
  const own = list.find((x) => x.scopeKey === scopeKey);
  const chosen = own ?? [...list].filter((x) => x.scopeKey.startsWith("league:")).sort((a, b) => (b.played ?? 0) - (a.played ?? 0))[0];
  if (!chosen) return null;
  return { position: chosen.position, points: chosen.points, played: chosen.played, wins: chosen.wins, draws: chosen.draws, losses: chosen.losses, goalsFor: chosen.goalsFor, goalsAgainst: chosen.goalsAgainst };
}

function pickRank(pre: Preloaded, key: string, tour: string | null): { position: number; points: number | null } | null {
  const list = pre.standings.get(key);
  if (!list) return null;
  const own = list.find((x) => x.scopeKey === `tennis:${tour}`) ?? list.find((x) => x.scopeKey.startsWith("tennis:"));
  return own ? { position: own.position, points: own.points } : null;
}

function toResults(s: string | undefined): Result[] | null {
  if (!s) return null;
  return s.split("").filter((c): c is Result => c === "W" || c === "D" || c === "L");
}

export function meetingsFor(all: Match[], m: Pick<Match, "id" | "homeTeamId" | "awayTeamId" | "homePlayerId" | "awayPlayerId">, kind: EntityKind, limit = 10): Match[] {
  const a = kind === "TEAM" ? m.homeTeamId : m.homePlayerId;
  const b = kind === "TEAM" ? m.awayTeamId : m.awayPlayerId;
  return all
    .filter((x) => x.id !== m.id)
    .filter((x) => {
      const xa = kind === "TEAM" ? x.homeTeamId : x.homePlayerId;
      const xb = kind === "TEAM" ? x.awayTeamId : x.awayPlayerId;
      return (xa === a && xb === b) || (xa === b && xb === a);
    })
    .slice(0, limit);
}

export async function predictUpcoming(now = new Date(), horizonDays = 5): Promise<{ predicted: number; eligible: number }> {
  let predicted = 0;
  let eligible = 0;
  for (const sport of SPORT_IDS) {
    const matches = await prisma.match.findMany({
      where: { sportId: sport, status: "SCHEDULED", startsAt: { gt: now, lt: new Date(now.getTime() + horizonDays * 86400_000) } },
      include: { league: true },
    });
    if (matches.length === 0) continue;
    const pre = await preload(sport, matches);
    const meta = SPORTS[sport];
    for (const m of matches) {
      const sides = sidesOf(m);
      if (!sides) continue;
      const kind = sides.kind;
      const meetings = meetingsFor(pre.meetings, m, kind);
      const h2h: H2HMeeting[] = meetings.map((x) => {
        const aIsHome = (kind === "TEAM" ? x.homeTeamId : x.homePlayerId) === (kind === "TEAM" ? m.homeTeamId : m.homePlayerId);
        const w = x.winner;
        return {
          winner: w === "DRAW" ? "DRAW" : w === "HOME" ? (aIsHome ? "A" : "B") : w === "AWAY" ? (aIsHome ? "B" : "A") : null,
          aWasHome: x.neutralVenue ? null : aIsHome,
          surface: x.surface,
        };
      });
      const tour = m.league.tour;
      const scopeKey = `league:${m.leagueId}`;
      const side = (key: string): SideInfo => {
        const e = pre.elo.get(key);
        const overall = e?.get("overall");
        const surf = m.surface ? e?.get(m.surface) : undefined;
        let form = toResults(pre.form.get(key));
        if (!form || form.length < 3) {
          const snapForm = pre.standings.get(key)?.find((x) => x.form && x.source === "apisports")?.form;
          const alt = toResults(snapForm ? [...snapForm].reverse().join("") : undefined);
          if (alt && alt.length >= 3) form = alt;
        }
        return {
          standing: meta.individual ? null : pickStanding(pre, key, scopeKey),
          rank: meta.individual ? pickRank(pre, key, tour) : null,
          elo: overall ? { overall: overall.rating, matches: overall.matches, surface: surf?.rating ?? null, surfaceMatches: surf?.matches ?? 0 } : null,
          form,
        };
      };
      const out = predictMatch({ sport, hasDraw: meta.hasDraw, neutral: m.neutralVenue, surface: m.surface, a: side(sides.home), b: side(sides.away), h2h }, MODEL);
      const data = {
        modelVersion: MODEL_VERSION,
        eligible: out.eligible,
        reason: out.reason ?? null,
        pHome: out.pHome,
        pDraw: out.pDraw,
        pAway: out.pAway,
        pick: out.pick,
        pickProb: out.pickProb,
        components: out.components as unknown as Prisma.InputJsonValue,
        dataQuality: out.dataQuality as unknown as Prisma.InputJsonValue,
        computedAt: new Date(),
      };
      await prisma.prediction.upsert({ where: { matchId: m.id }, create: { matchId: m.id, ...data }, update: data });
      predicted++;
      if (out.eligible) eligible++;
    }
  }
  return { predicted, eligible };
}

export async function runBacktests(): Promise<Array<{ sport: SportId; sample: number; accuracy: number }>> {
  const out: Array<{ sport: SportId; sample: number; accuracy: number }> = [];
  for (const sport of SPORT_IDS) {
    const finished = await finishedMatches(sport);
    const elo = finished.map(toEloMatch).filter((m): m is EloMatch => !!m);
    const res = backtest(elo, MODEL, { sport, hasDraw: SPORTS[sport].hasDraw });
    if (!res) continue;
    await prisma.backtestResult.create({
      data: {
        sportId: sport,
        modelVersion: MODEL_VERSION,
        sample: res.sample,
        accuracy: res.accuracy,
        brier: res.brier,
        logLoss: res.logLoss,
        baselineAccuracy: res.baselineAccuracy,
        calibration: res.calibration as unknown as Prisma.InputJsonValue,
        periodFrom: res.periodFrom ? new Date(res.periodFrom) : null,
        periodTo: res.periodTo ? new Date(res.periodTo) : null,
      },
    });
    out.push({ sport, sample: res.sample, accuracy: res.accuracy });
  }
  return out;
}

export { entityKey };

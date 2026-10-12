import type { Prisma, Side } from "@prisma/client";
import { COMBO } from "../../../config/admin";
import { prisma } from "../db";
import { getEnv } from "../env";
import { log } from "../log";
import { SPORT_IDS, type SportId } from "../sports";
import { getComboWindow } from "../time";
import { buildCombo, comboSignature, validateCombo, type BuildRequest, type BuildResult, type BuiltCombo, type Candidate, type Strategy } from "./engine";

const DAY = 86400_000;

/** Best available decimal price per side across stored bookmakers (never invented: absent means no odds). */
export async function bestOddsByMatch(matchIds: string[]): Promise<Map<string, Partial<Record<Side, number>>>> {
  const out = new Map<string, Partial<Record<Side, number>>>();
  if (matchIds.length === 0) return out;
  const rows = await prisma.matchOdds.findMany({ where: { matchId: { in: matchIds } } });
  for (const r of rows) {
    const cur = out.get(r.matchId) ?? {};
    if (r.home && r.home > 1 && r.home > (cur.HOME ?? 0)) cur.HOME = r.home;
    if (r.draw && r.draw > 1 && r.draw > (cur.DRAW ?? 0)) cur.DRAW = r.draw;
    if (r.away && r.away > 1 && r.away > (cur.AWAY ?? 0)) cur.AWAY = r.away;
    out.set(r.matchId, cur);
  }
  return out;
}

/**
 * Candidate legs straight from stored predictions. Only scheduled, not-yet-started matches with an eligible
 * prediction qualify. The engine applies the window / filters; this just loads everything inside a safe horizon.
 */
export async function loadCandidates(now: Date, horizonDays = 5): Promise<Candidate[]> {
  const rows = await prisma.prediction.findMany({
    where: {
      eligible: true,
      pick: { not: null },
      pickProb: { not: null },
      match: { status: "SCHEDULED", startsAt: { gt: now, lt: new Date(now.getTime() + horizonDays * DAY) } },
    },
    include: { match: { include: { league: true } } },
  });
  const odds = getEnv().FEATURE_ODDS ? await bestOddsByMatch(rows.map((r) => r.matchId)) : new Map<string, Partial<Record<Side, number>>>();
  return rows.map((r) => ({
    matchId: r.matchId,
    sport: r.match.sportId as SportId,
    leagueId: r.match.leagueId,
    leagueName: r.match.league.name,
    startsAt: r.match.startsAt,
    pick: r.pick as Side,
    prob: r.pickProb as number,
    odds: odds.get(r.matchId)?.[r.pick as Side] ?? null,
    homeName: r.match.homeName,
    awayName: r.match.awayName,
  }));
}

/** Live build used for filtered / custom-size / non-default-timezone views. Always reads from stored data only. */
export async function buildLive(req: Omit<BuildRequest, "now"> & { now?: Date }): Promise<BuildResult> {
  const now = req.now ?? new Date();
  const cands = await loadCandidates(now);
  return buildCombo(cands, { ...req, now });
}

export interface PersistStats {
  created: number;
  confirmed: number;
  superseded: number;
  insufficient: Array<{ slot: string; eligible: number; requested: number }>;
}

interface Slot {
  kind: "SINGLE_SPORT" | "MIXED";
  sport: SportId | null;
  strategy: Strategy;
  size: number;
}

function slots(): Slot[] {
  const out: Slot[] = [];
  const groups: Array<SportId | null> = [null, ...SPORT_IDS];
  for (const sport of groups) {
    for (const strategy of ["TOP", "DIVERSIFIED"] as Strategy[]) {
      for (const size of COMBO.SIZES) out.push({ kind: sport ? "SINGLE_SPORT" : "MIXED", sport, strategy, size });
    }
  }
  return out;
}

const slotLabel = (s: Slot) => `${s.sport ?? "mixed"}/${s.strategy}/${s.size}`;

async function persist(built: BuiltCombo, slot: Slot, tz: string, now: Date, stats: PersistStats): Promise<"created" | "confirmed" | null> {
  const problems = validateCombo(built.legs, now, tz);
  if (problems.length) {
    log.error(`Refusing to store invalid combo ${slotLabel(slot)}: ${problems.join("; ")}`);
    return null;
  }
  const signature = comboSignature({ kind: slot.kind, sport: slot.sport, strategy: slot.strategy, size: built.size, legs: built.legs });
  const active = await prisma.combo.findMany({ where: { status: "ACTIVE", kind: slot.kind, sportId: slot.sport, strategy: slot.strategy, requestedSize: slot.size } });
  const same = active.find((c) => c.signature === signature);
  for (const c of active) {
    if (c.id === same?.id) continue;
    await prisma.combo.update({ where: { id: c.id }, data: { status: "SUPERSEDED" } });
    stats.superseded++;
  }
  if (same) {
    await prisma.combo.update({ where: { id: same.id }, data: { lastConfirmedAt: now, combinedOdds: built.combinedOdds, legsPriced: built.legsPriced } });
    stats.confirmed++;
    return "confirmed";
  }
  const times = built.legs.map((l) => l.startsAt.getTime());
  await prisma.combo.create({
    data: {
      kind: slot.kind,
      sportId: slot.sport,
      size: built.size,
      requestedSize: slot.size,
      strategy: slot.strategy,
      signature,
      combinedProb: built.combinedProb,
      combinedOdds: built.combinedOdds,
      legsPriced: built.legsPriced,
      minLegProb: built.minLegProb,
      timezone: tz,
      windowStart: built.window.now,
      windowEnd: built.window.end,
      firstLegStartsAt: new Date(Math.min(...times)),
      lastLegStartsAt: new Date(Math.max(...times)),
      generatedAt: now,
      lastConfirmedAt: now,
      legs: {
        create: built.legs.map((l, i) => ({
          matchId: l.matchId,
          position: i + 1,
          sportId: l.sport,
          leagueId: l.leagueId,
          pick: l.pick,
          prob: l.prob,
          odds: l.odds ?? null,
          startsAt: l.startsAt,
        })),
      },
    },
  });
  stats.created++;
  return "created";
}

/**
 * Regenerate the stored combos for the default timezone: mixed + every single sport, sizes 7,10,12,15,20,25,32,
 * TOP and DIVERSIFIED. Unchanged combos are only re-confirmed; changed ones supersede the previous version
 * (history is kept). Slots without enough eligible matches retire their active combo and are reported as insufficient.
 */
export async function generateStoredCombos(now = new Date(), tz = getEnv().DEFAULT_TIMEZONE): Promise<PersistStats> {
  await expireStarted(now);
  const stats: PersistStats = { created: 0, confirmed: 0, superseded: 0, insufficient: [] };
  const cands = await loadCandidates(now);
  for (const slot of slots()) {
    const pool = slot.sport ? cands.filter((c) => c.sport === slot.sport) : cands;
    const res = buildCombo(pool, { size: slot.size, strategy: slot.strategy, now, tz, sports: slot.sport ? [slot.sport] : undefined });
    if (!res.ok) {
      const active = await prisma.combo.updateMany({ where: { status: "ACTIVE", kind: slot.kind, sportId: slot.sport, strategy: slot.strategy, requestedSize: slot.size }, data: { status: "SUPERSEDED" } });
      stats.superseded += active.count;
      if (slot.strategy === "TOP") stats.insufficient.push({ slot: slotLabel(slot), eligible: res.eligibleCount, requested: slot.size });
      continue;
    }
    if (slot.strategy === "DIVERSIFIED") {
      const top = buildCombo(pool, { size: slot.size, strategy: "TOP", now, tz, sports: slot.sport ? [slot.sport] : undefined });
      if (top.ok && comboSignature({ kind: slot.kind, sport: slot.sport, strategy: "X", size: top.size, legs: top.legs }) === comboSignature({ kind: slot.kind, sport: slot.sport, strategy: "X", size: res.size, legs: res.legs })) {
        // Identical to the TOP combo: do not store a duplicate DIVERSIFIED variant.
        await prisma.combo.updateMany({ where: { status: "ACTIVE", kind: slot.kind, sportId: slot.sport, strategy: "DIVERSIFIED", requestedSize: slot.size }, data: { status: "SUPERSEDED" } });
        continue;
      }
    }
    await persist(res, slot, tz, now, stats);
  }
  return stats;
}

/** ACTIVE combos whose first leg has started are no longer actionable: lock them so they leave the active lists. */
export async function expireStarted(now = new Date()): Promise<number> {
  const r = await prisma.combo.updateMany({ where: { status: "ACTIVE", firstLegStartsAt: { lte: now } }, data: { status: "LOCKED" } });
  return r.count;
}

const NO_RESULT_GRACE_MS = 3 * DAY;

/**
 * Mark legs won/lost from stored results, then roll the result up to the combo:
 *   any lost leg -> LOST (immediately);  every leg won -> WON;  all settled with a void leg and no loss -> VOID.
 * A leg whose match is postponed/cancelled/abandoned, or has no result 72h after kick-off, is VOID.
 */
export async function settleCombos(now = new Date()): Promise<{ legsSettled: number; combosSettled: number }> {
  const pending = await prisma.comboLeg.findMany({
    where: { result: "PENDING", startsAt: { lte: now }, combo: { status: { in: ["LOCKED", "ACTIVE", "SUPERSEDED"] } } },
    include: { match: { select: { status: true, winner: true } } },
  });
  let legsSettled = 0;
  for (const leg of pending) {
    let result: "WON" | "LOST" | "VOID" | null = null;
    const m = leg.match;
    if (m.status === "FINISHED" && m.winner) result = m.winner === leg.pick ? "WON" : "LOST";
    else if (m.status === "POSTPONED" || m.status === "CANCELLED" || m.status === "ABANDONED") result = "VOID";
    else if (now.getTime() - leg.startsAt.getTime() > NO_RESULT_GRACE_MS) result = "VOID";
    if (!result) continue;
    await prisma.comboLeg.update({ where: { id: leg.id }, data: { result, settledAt: now } });
    legsSettled++;
  }

  let combosSettled = 0;
  const open = await prisma.combo.findMany({ where: { status: "LOCKED" }, include: { legs: { select: { result: true } } } });
  for (const c of open) {
    const results = c.legs.map((l) => l.result);
    let status: "WON" | "LOST" | "VOID" | null = null;
    if (results.includes("LOST")) status = "LOST";
    else if (results.every((r) => r !== "PENDING")) status = results.every((r) => r === "WON") ? "WON" : "VOID";
    if (!status) continue;
    await prisma.combo.update({ where: { id: c.id }, data: { status, settledAt: now } });
    combosSettled++;
  }
  return { legsSettled, combosSettled };
}

export interface SizeStats {
  size: number;
  played: number;
  won: number;
  lost: number;
  pending: number;
  voided: number;
  hitRate: number | null;
  avgPredictedProb: number | null;
}

/** Hit rate per combo size. Only combos that actually started (locked or settled) count; superseded drafts do not. */
export async function historyStats(): Promise<{ bySize: SizeStats[]; legs: { settled: number; won: number; hitRate: number | null; avgPredictedProb: number | null } }> {
  const combos = await prisma.combo.findMany({
    where: { status: { in: ["LOCKED", "WON", "LOST", "VOID"] } },
    select: { size: true, status: true, combinedProb: true },
  });
  const map = new Map<number, SizeStats & { probSum: number; probN: number }>();
  for (const c of combos) {
    const s = map.get(c.size) ?? { size: c.size, played: 0, won: 0, lost: 0, pending: 0, voided: 0, hitRate: null, avgPredictedProb: null, probSum: 0, probN: 0 };
    s.played++;
    if (c.status === "WON") s.won++;
    else if (c.status === "LOST") s.lost++;
    else if (c.status === "VOID") s.voided++;
    else s.pending++;
    if (c.status === "WON" || c.status === "LOST") {
      s.probSum += c.combinedProb;
      s.probN++;
    }
    map.set(c.size, s);
  }
  const bySize = [...map.values()]
    .sort((a, b) => a.size - b.size)
    .map(({ probSum, probN, ...s }) => ({ ...s, hitRate: s.won + s.lost > 0 ? s.won / (s.won + s.lost) : null, avgPredictedProb: probN ? probSum / probN : null }));

  const legRows = await prisma.comboLeg.findMany({ where: { result: { in: ["WON", "LOST"] }, combo: { status: { in: ["LOCKED", "WON", "LOST"] } } }, select: { result: true, prob: true } });
  const won = legRows.filter((l) => l.result === "WON").length;
  return {
    bySize,
    legs: {
      settled: legRows.length,
      won,
      hitRate: legRows.length ? won / legRows.length : null,
      avgPredictedProb: legRows.length ? legRows.reduce((p, l) => p + l.prob, 0) / legRows.length : null,
    },
  };
}

export type ComboWithLegs = Prisma.ComboGetPayload<{ include: { legs: { include: { match: { include: { league: true } } } } } }>;

export { getComboWindow };

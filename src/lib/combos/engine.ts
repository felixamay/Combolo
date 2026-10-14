import { createHash } from "node:crypto";
import { COMBO } from "../../../config/admin";
import { SPORTS, type SportId } from "../sports";
import { WINDOW_DAYS, WINDOW_PHRASE, dayIndexOf, getComboWindow, isInWindow, type ComboWindow } from "../time";

/**
 * Pure combo engine – no database, no clock. Every hard rule from the product brief is enforced here:
 *  1. window: only matches that start after `now` and before the end of the window (today, user tz)
 *  2. size: 7..32 legs inclusive
 *  3. one leg per match (never both sides of a match)
 *  5. never pad: if there are not enough eligible matches the result is an explicit INSUFFICIENT outcome
 */

export type PickSide = "HOME" | "DRAW" | "AWAY";
export type Strategy = "TOP" | "DIVERSIFIED";

/** The Kalshi market for this leg's pick (stored by the `kalshi` job); absent when Kalshi does not list it. */
export interface KalshiLeg {
  seriesTicker: string;
  eventTicker: string;
  marketTicker: string;
  eventTitle: string;
  marketTitle: string;
  yesAsk: number | null;
}

export interface Candidate {
  matchId: string;
  sport: SportId;
  leagueId: string;
  leagueName: string;
  startsAt: Date;
  pick: PickSide;
  prob: number;
  odds?: number | null;
  homeName: string;
  awayName: string;
  kalshi?: KalshiLeg | null;
}

export interface BuildRequest {
  size: number;
  strategy: Strategy;
  now: Date;
  tz: string;
  sports?: SportId[];
  leagueIds?: string[];
  days?: Array<1 | 2 | 3>;
  /** Minimum per-leg probability (0..1). */
  minConfidence?: number;
  /** Only legs whose pick has a Kalshi market, so the whole combo can be placed on Kalshi. */
  kalshiOnly?: boolean;
}

export interface BuiltCombo {
  ok: true;
  legs: Candidate[];
  size: number;
  combinedProb: number;
  combinedOdds: number | null;
  legsPriced: number;
  minLegProb: number;
  eligibleCount: number;
  window: ComboWindow;
  sports: SportId[];
}

export interface Insufficient {
  ok: false;
  reason: "INSUFFICIENT" | "INVALID_SIZE";
  eligibleCount: number;
  requested: number;
  message: string;
}

export type BuildResult = BuiltCombo | Insufficient;

export function isValidSize(n: number): boolean {
  return Number.isInteger(n) && n >= COMBO.MIN_SIZE && n <= COMBO.MAX_SIZE;
}

/** Candidates that satisfy window, filters and the one-leg-per-match rule (best probability kept per match). */
export function filterEligible(cands: Candidate[], req: globalThis.Pick<BuildRequest, "now" | "tz" | "sports" | "leagueIds" | "days" | "minConfidence" | "kalshiOnly">): Candidate[] {
  const window = getComboWindow(req.now, req.tz);
  const best = new Map<string, Candidate>();
  for (const c of cands) {
    if (!Number.isFinite(c.prob) || c.prob <= 0 || c.prob > 1) continue;
    if (!isInWindow(c.startsAt, window)) continue;
    if (req.sports && req.sports.length && !req.sports.includes(c.sport)) continue;
    if (req.leagueIds && req.leagueIds.length && !req.leagueIds.includes(c.leagueId)) continue;
    if (req.days && req.days.length) {
      const d = dayIndexOf(c.startsAt, window);
      if (!d || !req.days.includes(d)) continue;
    }
    if (req.minConfidence !== undefined && c.prob < req.minConfidence) continue;
    if (req.kalshiOnly && !c.kalshi) continue;
    const prev = best.get(c.matchId);
    if (!prev || c.prob > prev.prob) best.set(c.matchId, c);
  }
  return [...best.values()];
}

const byProb = (a: Candidate, b: Candidate) => b.prob - a.prob || a.startsAt.getTime() - b.startsAt.getTime() || a.matchId.localeCompare(b.matchId);

function pickTop(sorted: Candidate[], size: number): Candidate[] {
  return sorted.slice(0, size);
}

/**
 * Diversified: highest probabilities first, but no sport takes more than ceil(size / #sports) legs and
 * no league more than max(2, 30% of size). If the caps leave the combo short, the remaining slots are
 * filled with the next best legs (caps are a preference, never a reason to build a smaller combo).
 */
function pickDiversified(sorted: Candidate[], size: number): Candidate[] {
  const sports = new Set(sorted.map((c) => c.sport));
  const sportCap = Math.ceil(size / Math.max(1, sports.size));
  const leagueCap = Math.max(2, Math.ceil(size * 0.3));
  const chosen: Candidate[] = [];
  const sportCount = new Map<string, number>();
  const leagueCount = new Map<string, number>();
  for (const c of sorted) {
    if (chosen.length >= size) break;
    if ((sportCount.get(c.sport) ?? 0) >= sportCap) continue;
    if ((leagueCount.get(c.leagueId) ?? 0) >= leagueCap) continue;
    chosen.push(c);
    sportCount.set(c.sport, (sportCount.get(c.sport) ?? 0) + 1);
    leagueCount.set(c.leagueId, (leagueCount.get(c.leagueId) ?? 0) + 1);
  }
  if (chosen.length < size) {
    const taken = new Set(chosen.map((c) => c.matchId));
    for (const c of sorted) {
      if (chosen.length >= size) break;
      if (!taken.has(c.matchId)) chosen.push(c);
    }
  }
  return chosen;
}

export function insufficientMessage(eligible: number, size: number, sports: SportId[] | undefined, days: Array<1 | 2 | 3> | undefined, kalshiOnly = false): string {
  const scope = sports && sports.length === 1 ? SPORTS[sports[0]].pluralLabel : sports && sports.length > 1 ? "matches in the selected sports" : "matches across all sports";
  const eligibleLabel = eligible === 1 ? "eligible" : "eligible";
  const when = days && days.length && days.length < WINDOW_DAYS ? `on day ${days.join(", ")}` : WINDOW_PHRASE;
  return `Only ${eligible} ${eligibleLabel} ${scope}${kalshiOnly ? " listed on Kalshi" : ""} ${when} – a ${size}-leg combo needs ${size}. Nothing was padded.`;
}

export function buildCombo(cands: Candidate[], req: BuildRequest): BuildResult {
  if (!isValidSize(req.size)) {
    return { ok: false, reason: "INVALID_SIZE", eligibleCount: 0, requested: req.size, message: `Combo size must be a whole number between ${COMBO.MIN_SIZE} and ${COMBO.MAX_SIZE}.` };
  }
  const eligible = filterEligible(cands, req).sort(byProb);
  if (eligible.length < req.size) {
    return { ok: false, reason: "INSUFFICIENT", eligibleCount: eligible.length, requested: req.size, message: insufficientMessage(eligible.length, req.size, req.sports, req.days, req.kalshiOnly) };
  }
  const legs = (req.strategy === "DIVERSIFIED" ? pickDiversified(eligible, req.size) : pickTop(eligible, req.size)).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || b.prob - a.prob);
  return summarise(legs, req, eligible.length);
}

export function summarise(legs: Candidate[], req: globalThis.Pick<BuildRequest, "now" | "tz">, eligibleCount: number): BuiltCombo {
  const priced = legs.filter((l) => l.odds != null && l.odds > 1);
  return {
    ok: true,
    legs,
    size: legs.length,
    combinedProb: legs.reduce((p, l) => p * l.prob, 1),
    combinedOdds: priced.length === legs.length ? legs.reduce((p, l) => p * (l.odds as number), 1) : null,
    legsPriced: priced.length,
    minLegProb: Math.min(...legs.map((l) => l.prob)),
    eligibleCount,
    window: getComboWindow(req.now, req.tz),
    sports: [...new Set(legs.map((l) => l.sport))],
  };
}

/** Independent re-check of every hard rule. Used in tests and by the persistence layer as a last line of defence. */
export function validateCombo(legs: Array<globalThis.Pick<Candidate, "matchId" | "startsAt" | "prob" | "pick" | "sport">>, now: Date, tz: string): string[] {
  const problems: string[] = [];
  if (!isValidSize(legs.length)) problems.push(`size ${legs.length} outside ${COMBO.MIN_SIZE}-${COMBO.MAX_SIZE}`);
  const window = getComboWindow(now, tz);
  const seen = new Set<string>();
  for (const l of legs) {
    if (seen.has(l.matchId)) problems.push(`duplicate match ${l.matchId}`);
    seen.add(l.matchId);
    if (!isInWindow(l.startsAt, window)) problems.push(`match ${l.matchId} outside window (${l.startsAt.toISOString()})`);
    if (!(l.prob > 0 && l.prob <= 1)) problems.push(`match ${l.matchId} has invalid probability`);
    if (l.pick === "DRAW" && !SPORTS[l.sport].hasDraw) problems.push(`match ${l.matchId}: draw pick in a sport without draws`);
  }
  return problems;
}

export function comboSignature(parts: { kind: string; sport?: string | null; strategy: string; size: number; legs: Array<{ matchId: string; pick: string }> }): string {
  const legKey = parts.legs.map((l) => `${l.matchId}:${l.pick}`).sort().join(",");
  return createHash("sha1").update(`${parts.kind}|${parts.sport ?? "-"}|${parts.strategy}|${parts.size}|${legKey}`).digest("hex");
}

export function probabilityLabel(p: number): string {
  if (p >= 0.1) return `${(p * 100).toFixed(1)}%`;
  if (p >= 0.001) return `${(p * 100).toFixed(2)}%`;
  if (p >= 0.00001) return `${(p * 100).toFixed(4)}%`;
  return "<0.001%";
}

/** "1 in N" framing of the combined probability, so long combos read honestly. */
export function oneInN(p: number): string {
  if (p <= 0) return "never";
  const n = 1 / p;
  if (n >= 1e9) return `1 in ${(n / 1e9).toFixed(1)} billion`;
  if (n >= 1e6) return `1 in ${(n / 1e6).toFixed(1)} million`;
  if (n >= 1e4) return `1 in ${Math.round(n).toLocaleString("en-US")}`;
  if (n >= 100) return `1 in ${Math.round(n)}`;
  return `1 in ${n.toFixed(1)}`;
}

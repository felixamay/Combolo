import type { KalshiGame, KalshiOutcome } from "../providers/kalshi";
import { normName, playerKey } from "./names";
import type { OddsTarget } from "./odds-match";

const HOUR = 3600_000;

export type KalshiSide = "HOME" | "DRAW" | "AWAY";

export interface KalshiMatchResult {
  matchId: string;
  sides: Partial<Record<KalshiSide, KalshiOutcome>>;
}

/** "Jacksonville St." on Kalshi is a state school; everywhere else normName reads "St." as "Saint". */
function kalshiTeamName(name: string): string {
  return name.replace(/\bSt\.?\s*$/i, "State");
}

function tokens(name: string): string[] {
  return normName(name).split(" ").filter(Boolean);
}

/** True when token `t` stands for o[i..]: equal, a one-letter abbreviation ("Los Angeles D"), or initials ("Sporting CP"). */
function tokenAt(t: string, o: string[], i: number): number {
  if (o[i] === t) return 1;
  if (t.length === 1 && o[i]?.startsWith(t)) return 1;
  if (t.length >= 2 && t.length <= 4 && i + t.length <= o.length && o.slice(i, i + t.length).every((w, k) => w[0] === t[k])) return t.length;
  return 0;
}

/** Every token of `short` appears in order in `long` (abbreviations allowed). "new york" ⊂ "new york knicks". */
function containsInOrder(short: string[], long: string[]): boolean {
  if (short.length === 0) return false;
  let i = 0;
  for (const t of short) {
    let used = 0;
    while (i < long.length && !(used = tokenAt(t, long, i))) i++;
    if (!used) return false;
    i += used;
  }
  return true;
}

/**
 * Does Kalshi's participant name denote our participant? Kalshi uses short names ("Chelsea", "Los Angeles D",
 * "New York") while providers use full ones ("Chelsea FC", "Los Angeles Dodgers", "New York Knicks").
 * The pairing is only accepted when both sides of a match agree, which removes the "New York" ambiguity.
 */
export function sameParticipant(kalshiName: string, ourName: string, sport: string, tour?: string | null): boolean {
  if (sport === "tennis") return playerKey(kalshiName, tour) === playerKey(ourName, tour);
  const k = tokens(kalshiTeamName(kalshiName));
  const o = tokens(ourName);
  return containsInOrder(k, o) || containsInOrder(o, k);
}

/** Kalshi publishes the expected settlement time (≈ start + 3 h) for games and a date placeholder for tennis. */
function plausibleStart(target: Date, kalshiTime: Date, sport: string): boolean {
  const d = kalshiTime.getTime() - target.getTime();
  return sport === "tennis" ? Math.abs(d) <= 36 * HOUR : d >= -2 * HOUR && d <= 8 * HOUR;
}

/**
 * Link a Kalshi game to exactly one stored match. Both participants must match (in either order) and the
 * time must be plausible; ambiguous or partial pairings return null – a market is never attached on a guess.
 */
export function matchKalshiGame(targets: OddsTarget[], game: KalshiGame, sport: string, tour?: string | null): KalshiMatchResult | null {
  const tie = game.outcomes.find((o) => /^(tie|draw)$/i.test(o.name.trim()));
  const parts = game.outcomes.filter((o) => o !== tie);
  if (parts.length !== 2) return null;
  const [a, b] = parts;
  const hits: KalshiMatchResult[] = [];
  for (const t of targets) {
    if (t.sport !== sport || !plausibleStart(t.startsAt, game.startsAt, sport)) continue;
    const tt = tour ?? t.tour;
    const aHome = sameParticipant(a.name, t.homeName, sport, tt);
    const aAway = sameParticipant(a.name, t.awayName, sport, tt);
    const bHome = sameParticipant(b.name, t.homeName, sport, tt);
    const bAway = sameParticipant(b.name, t.awayName, sport, tt);
    let sides: KalshiMatchResult["sides"] | null = null;
    if (aHome && bAway && !aAway && !bHome) sides = { HOME: a, AWAY: b };
    else if (aAway && bHome && !aHome && !bAway) sides = { HOME: b, AWAY: a };
    if (!sides) continue;
    if (tie) sides.DRAW = tie;
    hits.push({ matchId: t.id, sides });
  }
  return hits.length === 1 ? hits[0] : null;
}

import { normName, playerKey } from "./names";

export interface OddsTarget {
  id: string;
  sport: string;
  startsAt: Date;
  homeName: string;
  awayName: string;
  tour?: string | null;
}

export interface OddsEventLike {
  homeName: string;
  awayName: string;
  startsAt: Date;
}

export interface OddsMatchResult {
  matchId: string;
  /** True when the provider's home side is our away side (prices must be flipped). */
  swapped: boolean;
}

const HOUR = 3600_000;

function nameKey(sport: string, name: string, tour: string | null | undefined): string {
  return sport === "tennis" ? playerKey(name, tour) : normName(name);
}

/**
 * Match a bookmaker event to one of our stored matches by participant names and kick-off time.
 * Returns null when the pairing is missing or ambiguous – odds are never attached on a guess.
 */
export function matchOddsEvent(targets: OddsTarget[], event: OddsEventLike, sport: string, tour?: string | null): OddsMatchResult | null {
  const window = sport === "tennis" ? 18 * HOUR : 4 * HOUR;
  const eh = nameKey(sport, event.homeName, tour);
  const ea = nameKey(sport, event.awayName, tour);
  const hits: OddsMatchResult[] = [];
  for (const t of targets) {
    if (t.sport !== sport) continue;
    if (Math.abs(t.startsAt.getTime() - event.startsAt.getTime()) > window) continue;
    const t1 = nameKey(sport, t.homeName, tour ?? t.tour);
    const t2 = nameKey(sport, t.awayName, tour ?? t.tour);
    if (t1 === eh && t2 === ea) hits.push({ matchId: t.id, swapped: false });
    else if (t1 === ea && t2 === eh) hits.push({ matchId: t.id, swapped: true });
  }
  return hits.length === 1 ? hits[0] : null;
}

import type { ModelConfig } from "../../../config/admin";

export type Outcome = "A" | "B" | "DRAW";

export interface EloMatch {
  id: string;
  /** Entity keys (A is the home side). */
  a: string;
  b: string;
  winner: Outcome | null;
  at: number;
  surface?: string | null;
  neutral?: boolean;
  /** Absolute score margin (goals / points) – used for a mild margin-of-victory multiplier. */
  margin?: number | null;
  sport: string;
}

export interface EloEntry {
  overall: number;
  matches: number;
  lastAt: number | null;
  surfaces: Record<string, { rating: number; matches: number }>;
}

export interface PreMatchRatings {
  a: { overall: number; matches: number; surface: number | null; surfaceMatches: number };
  b: { overall: number; matches: number; surface: number | null; surfaceMatches: number };
}

export function expectedScore(ratingA: number, ratingB: number, scale = 400): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / scale));
}

function kFor(cfg: ModelConfig["elo"], sport: string): number {
  return sport === "tennis" ? cfg.kTennis : cfg.k;
}

function marginMultiplier(margin: number | null | undefined, sport: string): number {
  if (sport === "tennis" || margin == null || margin <= 0) return 1;
  return Math.min(2, 1 + 0.4 * Math.log(1 + margin));
}

export class EloSystem {
  readonly ratings = new Map<string, EloEntry>();

  constructor(private readonly cfg: ModelConfig["elo"]) {}

  get(key: string): EloEntry {
    let e = this.ratings.get(key);
    if (!e) {
      e = { overall: this.cfg.initial, matches: 0, lastAt: null, surfaces: {} };
      this.ratings.set(key, e);
    }
    return e;
  }

  peek(key: string): EloEntry | undefined {
    return this.ratings.get(key);
  }

  /** Ratings as they stand right now for a prospective match (does not mutate). */
  pre(a: string, b: string, surface?: string | null): PreMatchRatings {
    const side = (k: string) => {
      const e = this.ratings.get(k);
      const s = surface ? e?.surfaces[surface] : undefined;
      return { overall: e?.overall ?? this.cfg.initial, matches: e?.matches ?? 0, surface: s ? s.rating : null, surfaceMatches: s?.matches ?? 0 };
    };
    return { a: side(a), b: side(b) };
  }

  /** Apply one finished match. Draws score 0.5. Matches with an unknown winner are ignored. */
  apply(m: EloMatch): void {
    if (!m.winner) return;
    const ea = this.get(m.a);
    const eb = this.get(m.b);
    const k = kFor(this.cfg, m.sport) * marginMultiplier(m.margin, m.sport);
    const score = m.winner === "A" ? 1 : m.winner === "B" ? 0 : 0.5;
    const ha = m.neutral ? 0 : this.cfg.homeAdvantagePoints;
    if (m.sport !== "tennis") {
      const exp = expectedScore(ea.overall + ha, eb.overall, this.cfg.scale);
      ea.overall += k * (score - exp);
      eb.overall -= k * (score - exp);
    } else {
      const exp = expectedScore(ea.overall, eb.overall, this.cfg.scale);
      ea.overall += k * (score - exp);
      eb.overall -= k * (score - exp);
      if (m.surface) {
        const sa = (ea.surfaces[m.surface] ??= { rating: this.cfg.initial, matches: 0 });
        const sb = (eb.surfaces[m.surface] ??= { rating: this.cfg.initial, matches: 0 });
        const expS = expectedScore(sa.rating, sb.rating, this.cfg.scale);
        sa.rating += k * (score - expS);
        sb.rating -= k * (score - expS);
        sa.matches++;
        sb.matches++;
      }
    }
    ea.matches++;
    eb.matches++;
    ea.lastAt = m.at;
    eb.lastAt = m.at;
  }
}

/** Replay matches chronologically; `before` receives the ratings immediately before each match. */
export function replayElo(matches: EloMatch[], cfg: ModelConfig["elo"], before?: (m: EloMatch, pre: PreMatchRatings, system: EloSystem) => void): EloSystem {
  const sys = new EloSystem(cfg);
  const sorted = [...matches].sort((x, y) => x.at - y.at || x.id.localeCompare(y.id));
  for (const m of sorted) {
    if (before) before(m, sys.pre(m.a, m.b, m.surface), sys);
    sys.apply(m);
  }
  return sys;
}

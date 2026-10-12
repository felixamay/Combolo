import { describe, expect, it } from "vitest";
import { MODEL } from "../../config/admin";
import { backtest } from "../../src/lib/model/backtest";
import { EloSystem, expectedScore, replayElo, type EloMatch } from "../../src/lib/model/elo";
import { predictMatch, type MatchInput, type SideInfo, type StandingInfo } from "../../src/lib/model/predict";

const standing = (position: number, w: number, d: number, l: number, gf = 30, ga = 30): StandingInfo => ({ position, tableSize: 20, played: w + d + l, wins: w, draws: d, losses: l, points: w * 3 + d, goalsFor: gf, goalsAgainst: ga });
const side = (s: Partial<SideInfo>): SideInfo => ({ standing: null, rank: null, elo: null, form: null, ...s });
const base = (a: SideInfo, b: SideInfo, extra: Partial<MatchInput> = {}): MatchInput => ({ sport: "football", hasDraw: true, neutral: false, a, b, h2h: [], ...extra });

describe("predictMatch", () => {
  it("prefers the clearly stronger side and returns a valid distribution", () => {
    const out = predictMatch(base(side({ standing: standing(1, 20, 5, 3, 60, 20) }), side({ standing: standing(18, 4, 6, 18, 20, 55) })), MODEL);
    expect(out.eligible).toBe(true);
    expect(out.pick).toBe("HOME");
    expect(out.pHome! + out.pDraw! + out.pAway!).toBeCloseTo(1, 3);
    expect(out.pickProb!).toBeGreaterThan(0.5);
  });

  it("picks the away side when it is much stronger even with home advantage", () => {
    const out = predictMatch(base(side({ standing: standing(19, 3, 6, 19, 18, 60) }), side({ standing: standing(1, 22, 4, 2, 65, 15) })), MODEL);
    expect(out.pick).toBe("AWAY");
  });

  it("is symmetric at a neutral venue", () => {
    const strong = side({ elo: { overall: 1650, matches: 60 } });
    const weak = side({ elo: { overall: 1400, matches: 60 } });
    const ab = predictMatch(base(strong, weak, { neutral: true, hasDraw: false, sport: "tennis" }), MODEL);
    const ba = predictMatch(base(weak, strong, { neutral: true, hasDraw: false, sport: "tennis" }), MODEL);
    expect(ab.pHome).toBeCloseTo(ba.pAway!, 4);
    expect(ab.pAway).toBeCloseTo(ba.pHome!, 4);
  });

  it("gives the home side an edge between equal teams", () => {
    const eq = standing(10, 10, 5, 10);
    const out = predictMatch(base(side({ standing: eq }), side({ standing: eq }), { hasDraw: false, sport: "basketball" }), MODEL);
    expect(out.pHome!).toBeGreaterThan(out.pAway!);
  });

  it("never publishes a pick from head-to-head alone", () => {
    const out = predictMatch(base(side({}), side({}), { h2h: Array.from({ length: 8 }, () => ({ winner: "A" as const, aWasHome: true })) }), MODEL);
    expect(out.eligible).toBe(false);
    expect(out.pick).toBeNull();
    expect(out.reason).toMatch(/not enough data/i);
  });

  it("returns no pick with no data at all", () => {
    const out = predictMatch(base(side({}), side({})), MODEL);
    expect(out.eligible).toBe(false);
  });

  it("uses head-to-head to move the estimate, and reports the component", () => {
    const eq = standing(10, 10, 5, 10);
    const none = predictMatch(base(side({ standing: eq }), side({ standing: eq }), { hasDraw: false, sport: "hockey" }), MODEL);
    const withH2H = predictMatch(base(side({ standing: eq }), side({ standing: eq }), { hasDraw: false, sport: "hockey", h2h: Array.from({ length: 6 }, () => ({ winner: "B" as const, aWasHome: true })) }), MODEL);
    expect(withH2H.pHome!).toBeLessThan(none.pHome!);
    expect(withH2H.components.h2h).toBeDefined();
    expect(withH2H.dataQuality.present).toContain("h2h");
  });

  it("keeps probabilities inside the configured clamp", () => {
    const out = predictMatch(base(side({ elo: { overall: 2600, matches: 500 }, standing: standing(1, 38, 0, 0, 120, 5) }), side({ elo: { overall: 900, matches: 500 }, standing: standing(20, 0, 0, 38, 5, 120) }), { hasDraw: false, sport: "basketball" }), MODEL);
    expect(out.pHome!).toBeLessThanOrEqual(MODEL.clamp[1]);
    expect(out.pAway!).toBeGreaterThanOrEqual(MODEL.clamp[0]);
  });

  it("draw probability shrinks as the gap grows", () => {
    const even = predictMatch(base(side({ elo: { overall: 1500, matches: 50 } }), side({ elo: { overall: 1500, matches: 50 } })), MODEL);
    const lopsided = predictMatch(base(side({ elo: { overall: 1800, matches: 50 } }), side({ elo: { overall: 1300, matches: 50 } })), MODEL);
    expect(lopsided.pDraw!).toBeLessThan(even.pDraw!);
  });

  it("tennis uses surface Elo when available", () => {
    const clay = (a: number) => side({ elo: { overall: 1500, matches: 80, surface: a, surfaceMatches: 40 } });
    const out = predictMatch({ sport: "tennis", hasDraw: false, neutral: true, surface: "Clay", a: clay(1700), b: clay(1400), h2h: [] }, MODEL);
    const flat = predictMatch({ sport: "tennis", hasDraw: false, neutral: true, surface: "Clay", a: side({ elo: { overall: 1500, matches: 80 } }), b: side({ elo: { overall: 1500, matches: 80 } }), h2h: [] }, MODEL);
    expect(out.pHome!).toBeGreaterThan(0.6);
    expect(flat.pHome!).toBeCloseTo(0.5, 2);
  });
});

describe("Elo", () => {
  it("expected score is 0.5 for equal ratings and monotone", () => {
    expect(expectedScore(1500, 1500)).toBeCloseTo(0.5, 6);
    expect(expectedScore(1600, 1500)).toBeGreaterThan(0.5);
  });

  it("winner gains and loser loses the same amount", () => {
    const sys = new EloSystem(MODEL.elo);
    sys.apply({ id: "1", a: "x", b: "y", winner: "A", at: 1, sport: "basketball", neutral: true });
    const x = sys.get("x").overall;
    const y = sys.get("y").overall;
    expect(x).toBeGreaterThan(MODEL.elo.initial);
    expect(x + y).toBeCloseTo(2 * MODEL.elo.initial, 6);
  });

  it("tracks per-surface ratings for tennis", () => {
    const m: EloMatch[] = Array.from({ length: 10 }, (_, i) => ({ id: String(i), a: "p1", b: "p2", winner: "A", at: i, sport: "tennis", surface: "Clay", neutral: true }));
    const sys = replayElo(m, MODEL.elo);
    expect(sys.get("p1").surfaces.Clay.rating).toBeGreaterThan(sys.get("p1").overall - 1);
    expect(sys.get("p1").surfaces.Hard).toBeUndefined();
  });
});

describe("backtest", () => {
  function synthetic(n: number): EloMatch[] {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
    const skill = Array.from({ length: 10 }, (_, i) => (i - 4.5) * 0.45);
    const out: EloMatch[] = [];
    for (let i = 0; i < n; i++) {
      const a = Math.floor(rnd() * 10);
      let b = Math.floor(rnd() * 10);
      if (a === b) b = (b + 1) % 10;
      const p = 1 / (1 + Math.exp(-(skill[a] - skill[b])));
      out.push({ id: String(i).padStart(5, "0"), a: `t${a}`, b: `t${b}`, winner: rnd() < p ? "A" : "B", at: i * 3600_000, sport: "basketball", neutral: true });
    }
    return out;
  }

  it("refuses to report accuracy on tiny samples", () => {
    expect(backtest(synthetic(20), MODEL, { sport: "basketball", hasDraw: false })).toBeNull();
  });

  it("beats the baseline on data with real skill differences and is roughly calibrated", () => {
    const res = backtest(synthetic(1500), MODEL, { sport: "basketball", hasDraw: false })!;
    expect(res.sample).toBeGreaterThan(300);
    expect(res.accuracy).toBeGreaterThan(res.baselineAccuracy);
    expect(res.accuracy).toBeGreaterThan(0.58);
    expect(res.brier).toBeLessThan(0.45);
    expect(res.calibration.reduce((n, b) => n + b.n, 0)).toBe(res.sample);
    for (const b of res.calibration.filter((x) => x.n >= 60)) expect(Math.abs(b.predicted - b.actual)).toBeLessThan(0.15);
  });

  it("scores only matches after the warm-up window", () => {
    const res = backtest(synthetic(400), MODEL, { sport: "basketball", hasDraw: false, warmupFraction: 0.5 })!;
    expect(res.sample).toBeLessThanOrEqual(200);
  });
});

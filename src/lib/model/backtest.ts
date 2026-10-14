import type { ModelConfig } from "../../../config/admin";
import { EloSystem, type EloMatch } from "./elo";
import { predictMatch, type H2HMeeting, type Result, type SideInfo } from "./predict";
import type { SportId } from "../sports";

export interface CalibrationBin {
  low: number;
  high: number;
  n: number;
  predicted: number;
  actual: number;
}

export interface BacktestMetrics {
  sample: number;
  accuracy: number;
  brier: number;
  logLoss: number;
  baselineAccuracy: number;
  calibration: CalibrationBin[];
  periodFrom: number | null;
  periodTo: number | null;
}

export interface BacktestOptions {
  sport: SportId;
  hasDraw: boolean;
  /** Fraction of the chronologically-ordered history used only to warm up Elo/form (no scoring). */
  warmupFraction?: number;
  /** Elo ratings needed on both sides before a match is scored. */
  minMatchesPerSide?: number;
}

function resultFor(winner: EloMatch["winner"], isA: boolean): Result | null {
  if (!winner) return null;
  if (winner === "DRAW") return "D";
  return (winner === "A") === isA ? "W" : "L";
}

/**
 * Walk-forward back-test: every match is predicted using ONLY information available before it
 * (Elo, form, H2H built from earlier matches), then scored against the real result.
 * Standings are not part of this test because historical league tables are not stored.
 */
export function backtest(matches: EloMatch[], cfg: ModelConfig, opts: BacktestOptions): BacktestMetrics | null {
  const sorted = matches.filter((m) => m.winner !== null).sort((x, y) => x.at - y.at || x.id.localeCompare(y.id));
  if (sorted.length < 40) return null;
  const warmup = Math.floor(sorted.length * (opts.warmupFraction ?? 0.5));
  const minMatches = opts.minMatchesPerSide ?? 5;
  const elo = new EloSystem(cfg.elo);
  const forms = new Map<string, Result[]>();
  const pairs = new Map<string, Array<{ winnerKey: string | "DRAW"; homeKey: string; surface?: string | null }>>();

  let n = 0;
  let correct = 0;
  let brier = 0;
  let logLoss = 0;
  const classCounts = { HOME: 0, DRAW: 0, AWAY: 0 };
  const bins = Array.from({ length: 10 }, (_, i) => ({ low: i / 10, high: (i + 1) / 10, n: 0, predicted: 0, hits: 0 }));
  let from: number | null = null;
  let to: number | null = null;

  sorted.forEach((m, idx) => {
    if (idx >= warmup) {
      const pre = elo.pre(m.a, m.b, m.surface);
      const pairKey = m.a < m.b ? `${m.a}|${m.b}` : `${m.b}|${m.a}`;
      const h2h: H2HMeeting[] = (pairs.get(pairKey) ?? [])
        .slice(-10)
        .reverse()
        .map((x) => ({ winner: x.winnerKey === "DRAW" ? "DRAW" : x.winnerKey === m.a ? "A" : "B", aWasHome: x.homeKey === m.a, surface: x.surface }));
      const side = (key: string, p: typeof pre.a): SideInfo => ({
        elo: p.matches >= minMatches ? { overall: p.overall, matches: p.matches, surface: p.surface, surfaceMatches: p.surfaceMatches } : null,
        form: (forms.get(key) ?? []).slice(0, cfg.formWindow),
      });
      const pred = predictMatch(
        { sport: opts.sport, hasDraw: opts.hasDraw, neutral: !!m.neutral, surface: m.surface, a: side(m.a, pre.a), b: side(m.b, pre.b), h2h },
        cfg,
      );
      if (pred.eligible && pred.pick && pred.pickProb !== null) {
        const actual = m.winner === "A" ? "HOME" : m.winner === "B" ? "AWAY" : "DRAW";
        n++;
        classCounts[actual]++;
        if (pred.pick === actual) correct++;
        const probs = { HOME: pred.pHome ?? 0, DRAW: pred.pDraw ?? 0, AWAY: pred.pAway ?? 0 };
        for (const k of ["HOME", "DRAW", "AWAY"] as const) brier += (probs[k] - (k === actual ? 1 : 0)) ** 2;
        logLoss += -Math.log(Math.max(1e-6, probs[actual]));
        const b = bins[Math.min(9, Math.floor(pred.pickProb * 10))];
        b.n++;
        b.predicted += pred.pickProb;
        if (pred.pick === actual) b.hits++;
        from = from === null ? m.at : Math.min(from, m.at);
        to = to === null ? m.at : Math.max(to, m.at);
      }
    }
    elo.apply(m);
    for (const [key, isA] of [[m.a, true], [m.b, false]] as const) {
      const r = resultFor(m.winner, isA);
      if (r) {
        const arr = forms.get(key) ?? [];
        arr.unshift(r);
        if (arr.length > 20) arr.pop();
        forms.set(key, arr);
      }
    }
    const pk = m.a < m.b ? `${m.a}|${m.b}` : `${m.b}|${m.a}`;
    const list = pairs.get(pk) ?? [];
    list.push({ winnerKey: m.winner === "DRAW" ? "DRAW" : m.winner === "A" ? m.a : m.b, homeKey: m.a, surface: m.surface });
    pairs.set(pk, list);
  });

  if (n === 0) return null;
  return {
    sample: n,
    accuracy: correct / n,
    brier: brier / n,
    logLoss: logLoss / n,
    baselineAccuracy: Math.max(classCounts.HOME, classCounts.DRAW, classCounts.AWAY) / n,
    calibration: bins.filter((b) => b.n > 0).map((b) => ({ low: b.low, high: b.high, n: b.n, predicted: b.predicted / b.n, actual: b.hits / b.n })),
    periodFrom: from,
    periodTo: to,
  };
}

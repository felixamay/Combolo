import type { ModelConfig } from "../../../config/admin";
import type { SportId } from "../sports";

export type Result = "W" | "D" | "L";

export interface StandingInfo {
  position: number;
  tableSize?: number | null;
  points?: number | null;
  played?: number | null;
  wins?: number | null;
  draws?: number | null;
  losses?: number | null;
  goalsFor?: number | null;
  goalsAgainst?: number | null;
}

export interface SideInfo {
  /** Team-sport league standing. */
  standing?: StandingInfo | null;
  /** Tennis ranking. */
  rank?: { position: number; points?: number | null } | null;
  elo?: { overall: number; matches: number; surface?: number | null; surfaceMatches?: number } | null;
  /** Most recent first. */
  form?: Result[] | null;
}

export interface H2HMeeting {
  /** From the perspective of side A (the home side of the match being predicted). */
  winner: "A" | "B" | "DRAW" | null;
  aWasHome: boolean | null;
  surface?: string | null;
}

export interface MatchInput {
  sport: SportId;
  hasDraw: boolean;
  neutral: boolean;
  surface?: string | null;
  a: SideInfo;
  b: SideInfo;
  /** Most recent first. */
  h2h: H2HMeeting[];
}

export type ComponentName = "strength" | "elo" | "h2h" | "form";

export interface ComponentDetail {
  /** Log-odds in favour of side A contributed by this component before weighting. */
  logit: number;
  weight: number;
  contribution: number;
  summary: string;
  data?: Record<string, number | string | null>;
}

export interface PredictionOutput {
  eligible: boolean;
  reason?: string;
  pHome: number | null;
  pDraw: number | null;
  pAway: number | null;
  pick: "HOME" | "DRAW" | "AWAY" | null;
  pickProb: number | null;
  components: Partial<Record<ComponentName, ComponentDetail>> & {
    homeAdvantage?: { logit: number; summary: string };
    combined?: { z: number; temperature: number; pTwoWayA: number; pDrawBase: number | null };
  };
  dataQuality: { present: ComponentName[]; missing: ComponentName[]; h2hMeetings: number; formA: number; formB: number };
}

export const logit = (p: number) => Math.log(p / (1 - p));
export const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/* ---------------------------------------------------------------- strength */

function teamRating(s: StandingInfo, sport: SportId, hasDraw: boolean): { value: number; weight: number } | null {
  const played = s.played ?? (s.wins != null && s.losses != null ? s.wins + s.losses + (s.draws ?? 0) : null);
  if (!played || played < 1) return null;
  let rate: number;
  if (hasDraw && sport === "football" && s.points != null) {
    rate = (s.points / played - 1.37) / 1.0; // points per game relative to a typical league average
  } else if (s.wins != null) {
    rate = ((s.wins + 0.5 * (s.draws ?? 0)) / played - 0.5) * 3.0;
  } else return null;
  const margin = s.goalsFor != null && s.goalsAgainst != null ? (s.goalsFor - s.goalsAgainst) / played : 0;
  const marginScale = sport === "football" || sport === "hockey" || sport === "handball" ? 0.35 : sport === "baseball" ? 0.25 : 0.03;
  const reliability = played / (played + 5);
  return { value: (rate + marginScale * margin) * reliability, weight: reliability };
}

function strengthLogit(input: MatchInput): ComponentDetail | null {
  const { a, b } = input;
  if (input.sport === "tennis") {
    if (!a.rank || !b.rank || a.rank.position < 1 || b.rank.position < 1) return null;
    const byRank = 0.42 * Math.log(b.rank.position / a.rank.position);
    let z = byRank;
    let detail = `ranks #${a.rank.position} vs #${b.rank.position}`;
    if (a.rank.points && b.rank.points && a.rank.points > 0 && b.rank.points > 0) {
      const byPts = 0.75 * Math.log(a.rank.points / b.rank.points);
      z = (byRank + clamp(byPts, -2.5, 2.5)) / 2;
      detail += ` (${a.rank.points} vs ${b.rank.points} pts)`;
    }
    z = clamp(z, -2.5, 2.5);
    return { logit: z, weight: 0, contribution: 0, summary: detail, data: { rankA: a.rank.position, rankB: b.rank.position } };
  }
  if (!a.standing || !b.standing) return null;
  const ra = teamRating(a.standing, input.sport, input.hasDraw);
  const rb = teamRating(b.standing, input.sport, input.hasDraw);
  if (!ra || !rb) return null;
  const z = clamp(ra.value - rb.value, -2.5, 2.5);
  return {
    logit: z,
    weight: 0,
    contribution: 0,
    summary: `table positions #${a.standing.position} vs #${b.standing.position}`,
    data: { positionA: a.standing.position, positionB: b.standing.position, ratingA: round(ra.value), ratingB: round(rb.value) },
  };
}

const round = (x: number, d = 3) => Math.round(x * 10 ** d) / 10 ** d;

/* --------------------------------------------------------------------- elo */

function eloLogit(input: MatchInput, cfg: ModelConfig): ComponentDetail | null {
  const { a, b } = input;
  if (!a.elo || !b.elo) return null;
  const minMatches = Math.min(a.elo.matches, b.elo.matches);
  if (minMatches < 5) return null;
  let ra = a.elo.overall;
  let rb = b.elo.overall;
  let surfaceNote = "";
  if (input.sport === "tennis" && input.surface && a.elo.surface != null && b.elo.surface != null && (a.elo.surfaceMatches ?? 0) >= 5 && (b.elo.surfaceMatches ?? 0) >= 5) {
    const w = cfg.elo.surfaceBlend;
    ra = (1 - w) * ra + w * a.elo.surface;
    rb = (1 - w) * rb + w * b.elo.surface;
    surfaceNote = ` blended with ${input.surface} Elo`;
  }
  const reliability = minMatches / (minMatches + 10);
  const z = clamp(((ra - rb) / cfg.elo.scale) * Math.LN10 * reliability, -3.5, 3.5);
  return {
    logit: z,
    weight: 0,
    contribution: 0,
    summary: `Elo ${Math.round(ra)} vs ${Math.round(rb)}${surfaceNote}`,
    data: { eloA: Math.round(ra), eloB: Math.round(rb), matchesA: a.elo.matches, matchesB: b.elo.matches },
  };
}

/* --------------------------------------------------------------------- h2h */

function h2hLogit(input: MatchInput, cfg: ModelConfig): ComponentDetail | null {
  const meetings = input.h2h.filter((m) => m.winner !== null);
  if (meetings.length === 0) return null;
  let num = 0;
  let den = 0;
  meetings.forEach((m, i) => {
    let w = Math.pow(0.5, i / cfg.h2hHalfLifeMeetings);
    if (input.sport === "tennis" && input.surface && m.surface && m.surface === input.surface) w *= 1.6;
    if (!input.neutral && m.aWasHome !== null && m.aWasHome === true) w *= 1.3;
    let score = m.winner === "A" ? 1 : m.winner === "B" ? 0 : 0.5;
    if (!input.hasDraw && m.winner === "DRAW") score = 0.5;
    num += w * score;
    den += w;
  });
  const p = (num + cfg.h2hPrior * 0.5) / (den + cfg.h2hPrior);
  const aWins = meetings.filter((m) => m.winner === "A").length;
  const bWins = meetings.filter((m) => m.winner === "B").length;
  const draws = meetings.filter((m) => m.winner === "DRAW").length;
  return {
    logit: logit(clamp(p, 0.02, 0.98)),
    weight: 0,
    contribution: 0,
    summary: `${meetings.length} meetings: ${aWins}-${draws ? `${draws}-` : ""}${bWins} (recency weighted)`,
    data: { meetings: meetings.length, winsA: aWins, winsB: bWins, draws, weightedShareA: round(p) },
  };
}

/* -------------------------------------------------------------------- form */

function formShare(form: Result[], cfg: ModelConfig): number {
  const recent = form.slice(0, cfg.formWindow);
  let num = 0;
  let den = 0;
  recent.forEach((r, i) => {
    const w = Math.pow(0.5, i / (cfg.formWindow / 2));
    num += w * (r === "W" ? 1 : r === "D" ? 0.5 : 0);
    den += w;
  });
  return (num + cfg.formPrior * 0.5) / (den + cfg.formPrior);
}

function formLogit(input: MatchInput, cfg: ModelConfig): ComponentDetail | null {
  const fa = input.a.form;
  const fb = input.b.form;
  if (!fa || !fb || fa.length < 3 || fb.length < 3) return null;
  const pa = formShare(fa, cfg);
  const pb = formShare(fb, cfg);
  const z = clamp(logit(clamp(pa, 0.05, 0.95)) - logit(clamp(pb, 0.05, 0.95)), -2.5, 2.5);
  return {
    logit: z,
    weight: 0,
    contribution: 0,
    summary: `form ${fa.slice(0, cfg.formWindow).join("")} vs ${fb.slice(0, cfg.formWindow).join("")}`,
    data: { formShareA: round(pa), formShareB: round(pb) },
  };
}

/* ----------------------------------------------------------------- predict */

const DECIDING: ComponentName[] = ["strength", "elo", "form"];

/**
 * Pure win-probability model. Components are expressed as log-odds for side A (home), combined
 * with configurable weights, shifted by home advantage and tempered. Sports with draws get a
 * three-way split whose draw share shrinks as the rating gap grows.
 */
export function predictMatch(input: MatchInput, cfg: ModelConfig): PredictionOutput {
  const raw: Partial<Record<ComponentName, ComponentDetail | null>> = {
    strength: strengthLogit(input),
    elo: eloLogit(input, cfg),
    h2h: h2hLogit(input, cfg),
    form: formLogit(input, cfg),
  };
  const present: ComponentName[] = [];
  const missing: ComponentName[] = [];
  const components: PredictionOutput["components"] = {};
  let z = 0;
  for (const name of ["strength", "elo", "h2h", "form"] as ComponentName[]) {
    const c = raw[name];
    if (!c) {
      missing.push(name);
      continue;
    }
    const weight = cfg.weights[name];
    c.weight = weight;
    c.contribution = round(weight * c.logit);
    c.logit = round(c.logit);
    components[name] = c;
    present.push(name);
    z += weight * c.logit;
  }
  const dataQuality = { present, missing, h2hMeetings: input.h2h.filter((m) => m.winner !== null).length, formA: input.a.form?.length ?? 0, formB: input.b.form?.length ?? 0 };

  const hasDecider = present.some((p) => DECIDING.includes(p));
  if (!hasDecider || present.length < cfg.minComponents) {
    return { eligible: false, reason: "Not enough data: no ranking/standing, rating or recent form for both sides.", pHome: null, pDraw: null, pAway: null, pick: null, pickProb: null, components, dataQuality };
  }

  const ha = input.neutral ? 0 : cfg.homeAdvantage[input.sport];
  components.homeAdvantage = { logit: ha, summary: input.neutral ? "neutral venue / no home advantage" : `home advantage +${ha.toFixed(2)} log-odds` };
  z += ha;
  const zTempered = z * cfg.temperature;
  const pTwoWay = clamp(sigmoid(zTempered), cfg.clamp[0], cfg.clamp[1]);

  let pHome: number;
  let pAway: number;
  let pDraw: number | null = null;
  const drawBase = input.hasDraw ? (cfg.drawBase[input.sport] ?? 0.1) : null;
  if (input.hasDraw && drawBase !== null) {
    pDraw = clamp(drawBase * Math.exp(-cfg.drawDecay * Math.abs(zTempered)), 0.01, 0.45);
    pHome = (1 - pDraw) * pTwoWay;
    pAway = (1 - pDraw) * (1 - pTwoWay);
  } else {
    pHome = pTwoWay;
    pAway = 1 - pTwoWay;
  }
  components.combined = { z: round(z), temperature: cfg.temperature, pTwoWayA: round(pTwoWay), pDrawBase: drawBase };

  let pick: "HOME" | "DRAW" | "AWAY" = pHome >= pAway ? "HOME" : "AWAY";
  let pickProb = Math.max(pHome, pAway);
  if (pDraw !== null && pDraw > pickProb) {
    pick = "DRAW";
    pickProb = pDraw;
  }
  return { eligible: true, pHome: round(pHome, 4), pDraw: pDraw === null ? null : round(pDraw, 4), pAway: round(pAway, 4), pick, pickProb: round(pickProb, 4), components, dataQuality };
}

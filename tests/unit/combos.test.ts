import { describe, expect, it } from "vitest";
import { buildCombo, comboSignature, filterEligible, insufficientMessage, oneInN, probabilityLabel, validateCombo, type Candidate } from "@/lib/combos/engine";
import { COMBO } from "../../config/admin";
import type { SportId } from "@/lib/sports";

const TZ = "America/Chicago";
const NOW = new Date("2026-10-12T15:30:00Z"); // Mon 10:30 CDT; window ends 2026-10-15T05:00Z

function cand(i: number, over: Partial<Candidate> = {}): Candidate {
  return {
    matchId: `m${i}`,
    sport: "football",
    leagueId: "L1",
    leagueName: "League One",
    startsAt: new Date(NOW.getTime() + (i + 1) * 3600_000),
    pick: "HOME",
    prob: 0.9 - i * 0.004,
    homeName: `H${i}`,
    awayName: `A${i}`,
    ...over,
  };
}

const many = (n: number, sport: SportId = "football", leagueId = "L1") => Array.from({ length: n }, (_, i) => cand(i, { sport, leagueId, matchId: `${sport}-${leagueId}-${i}` }));

const req = (size: number, extra: Record<string, unknown> = {}) => ({ size, strategy: "TOP" as const, now: NOW, tz: TZ, ...extra });

describe("rule 2 – combo size 7..32", () => {
  it("rejects sizes outside 7..32 and non-integers", () => {
    for (const bad of [0, 1, 6, 33, 100, 7.5, -7, NaN]) {
      const r = buildCombo(many(60), req(bad));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe("INVALID_SIZE");
    }
  });

  it("accepts every boundary and the default size ladder", () => {
    for (const size of [...COMBO.SIZES, 7, 32, 8, 31, 17]) {
      const r = buildCombo(many(40), req(size));
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.legs).toHaveLength(size);
    }
    expect(COMBO.SIZES).toEqual(expect.arrayContaining([7, 10, 12, 15, 20, 25, 32]));
  });

  it("supports a custom size anywhere in range", () => {
    for (let size = 7; size <= 32; size++) {
      const r = buildCombo(many(32), req(size));
      expect(r.ok && r.legs.length === size).toBe(true);
    }
  });
});

describe("rule 1 – window", () => {
  it("excludes started matches, matches at/after the end of day 3 and far-future matches", () => {
    const good = many(10);
    const started = cand(100, { matchId: "started", startsAt: new Date(NOW.getTime() - 60_000) });
    const exactlyNow = cand(101, { matchId: "now", startsAt: NOW });
    const atEnd = cand(102, { matchId: "atEnd", startsAt: new Date("2026-10-15T05:00:00Z") });
    const justBefore = cand(103, { matchId: "justBefore", startsAt: new Date("2026-10-15T04:59:00Z"), prob: 0.5 });
    const far = cand(104, { matchId: "far", startsAt: new Date("2026-10-20T12:00:00Z") });
    const ids = filterEligible([...good, started, exactlyNow, atEnd, justBefore, far], { now: NOW, tz: TZ }).map((c) => c.matchId);
    expect(ids).toContain("justBefore");
    for (const bad of ["started", "now", "atEnd", "far"]) expect(ids).not.toContain(bad);
    expect(ids).toHaveLength(11);
  });

  it("never lets an out-of-window match into a built combo", () => {
    const cands = [...many(8), cand(200, { matchId: "far", startsAt: new Date("2026-10-18T12:00:00Z"), prob: 0.99 })];
    const r = buildCombo(cands, req(8));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.legs.map((l) => l.matchId)).not.toContain("far");
  });

  it("window is evaluated in the requested timezone", () => {
    // 04:30Z on 15 Oct is still day 3 in Chicago (23:30 on the 14th) but already the 15th in Tokyo (day 3 for Tokyo ends 15th 15:00Z)
    const c = cand(1, { startsAt: new Date("2026-10-15T04:30:00Z") });
    expect(filterEligible([c], { now: NOW, tz: "America/Chicago" })).toHaveLength(1);
    const late = cand(2, { startsAt: new Date("2026-10-15T06:00:00Z") });
    expect(filterEligible([late], { now: NOW, tz: "America/Chicago" })).toHaveLength(0);
    expect(filterEligible([late], { now: NOW, tz: "Asia/Tokyo" })).toHaveLength(1);
  });
});

describe("rule 3 – one leg per match", () => {
  it("keeps only the highest-probability pick when a match appears twice (never both sides)", () => {
    const base = many(9);
    const both = [cand(50, { matchId: "dup", pick: "HOME", prob: 0.55 }), cand(51, { matchId: "dup", pick: "AWAY", prob: 0.7 })];
    const r = buildCombo([...base, ...both], req(10));
    expect(r.ok).toBe(true);
    if (r.ok) {
      const dupLegs = r.legs.filter((l) => l.matchId === "dup");
      expect(dupLegs).toHaveLength(1);
      expect(dupLegs[0].pick).toBe("AWAY");
      expect(new Set(r.legs.map((l) => l.matchId)).size).toBe(r.legs.length);
    }
  });

  it("validateCombo flags duplicates", () => {
    const legs = [...many(7), cand(0, { matchId: "football-L1-0", pick: "AWAY" })];
    expect(validateCombo(legs, NOW, TZ).some((p) => p.includes("duplicate"))).toBe(true);
  });

  it("all generated combos pass independent validation at every size", () => {
    for (const strategy of ["TOP", "DIVERSIFIED"] as const) {
      for (const size of COMBO.SIZES) {
        const cands = [...many(20, "football", "A"), ...many(20, "tennis", "T"), ...many(10, "basketball", "B")];
        const r = buildCombo(cands, { size, strategy, now: NOW, tz: TZ });
        expect(r.ok).toBe(true);
        if (r.ok) expect(validateCombo(r.legs, NOW, TZ)).toEqual([]);
      }
    }
  });
});

describe("rule 5 – insufficient matches are reported, never padded", () => {
  it("says exactly how many eligible matches exist", () => {
    const r = buildCombo(many(9, "tennis", "T"), req(10, { sports: ["tennis"] }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("INSUFFICIENT");
      expect(r.eligibleCount).toBe(9);
      expect(r.message).toMatch(/Only 9 eligible tennis matches in the next 3 days/);
    }
  });

  it("does not count out-of-window or filtered matches toward the minimum", () => {
    const cands = [...many(6), cand(70, { matchId: "far", startsAt: new Date("2026-10-30T12:00:00Z") }), cand(71, { matchId: "past", startsAt: new Date("2026-10-12T10:00:00Z") })];
    const r = buildCombo(cands, req(7));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.eligibleCount).toBe(6);
  });

  it("exactly the required number of matches is enough", () => {
    expect(buildCombo(many(7), req(7)).ok).toBe(true);
    expect(buildCombo(many(6), req(7)).ok).toBe(false);
  });

  it("message wording for a single eligible match and day filters", () => {
    expect(insufficientMessage(1, 7, ["hockey"], undefined)).toContain("Only 1 eligible ice hockey games");
    expect(insufficientMessage(3, 7, undefined, [1])).toContain("on day 1");
  });
});

describe("rule 4 – categories and filters", () => {
  it("single-sport combos contain only that sport; mixed combos tag every leg with its sport", () => {
    const cands = [...many(12, "football", "F"), ...many(12, "tennis", "T"), ...many(12, "hockey", "H")];
    const single = buildCombo(cands, req(10, { sports: ["tennis"] }));
    expect(single.ok && single.legs.every((l) => l.sport === "tennis")).toBe(true);
    const mixed = buildCombo(cands, { size: 12, strategy: "DIVERSIFIED", now: NOW, tz: TZ });
    expect(mixed.ok).toBe(true);
    if (mixed.ok) {
      expect(mixed.sports.length).toBeGreaterThan(1);
      expect(mixed.legs.every((l) => ["football", "tennis", "hockey"].includes(l.sport))).toBe(true);
    }
  });

  it("filters by league, day and minimum confidence", () => {
    const cands = [
      ...many(8, "football", "PL"),
      ...many(8, "football", "LL").map((c) => ({ ...c, prob: 0.6 })),
      cand(300, { matchId: "tomorrow", sport: "football", leagueId: "PL", startsAt: new Date("2026-10-13T20:00:00Z"), prob: 0.95 }),
    ];
    expect(filterEligible(cands, { now: NOW, tz: TZ, leagueIds: ["LL"] })).toHaveLength(8);
    expect(filterEligible(cands, { now: NOW, tz: TZ, days: [2] }).map((c) => c.matchId)).toEqual(["tomorrow"]);
    expect(filterEligible(cands, { now: NOW, tz: TZ, minConfidence: 0.7 }).every((c) => c.prob >= 0.7)).toBe(true);
    expect(filterEligible(cands, { now: NOW, tz: TZ, minConfidence: 0.99 })).toHaveLength(0);
  });
});

describe("combo selection quality", () => {
  it("TOP maximises the combined probability (brute-force check on 12 candidates, size 7)", () => {
    const cands = Array.from({ length: 12 }, (_, i) => cand(i, { prob: [0.91, 0.55, 0.78, 0.62, 0.88, 0.7, 0.51, 0.83, 0.66, 0.74, 0.59, 0.95][i] }));
    const r = buildCombo(cands, req(7));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    let best = 0;
    const probs = cands.map((c) => c.prob);
    const rec = (start: number, chosen: number, prod: number) => {
      if (chosen === 7) {
        best = Math.max(best, prod);
        return;
      }
      for (let i = start; i < probs.length; i++) rec(i + 1, chosen + 1, prod * probs[i]);
    };
    rec(0, 0, 1);
    expect(r.combinedProb).toBeCloseTo(best, 12);
  });

  it("combined probability is the product of leg probabilities", () => {
    const r = buildCombo(many(10), req(7));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.combinedProb).toBeCloseTo(r.legs.reduce((p, l) => p * l.prob, 1), 12);
  });

  it("combined odds only exist when every leg is priced (odds are never invented)", () => {
    const priced = many(10).map((c) => ({ ...c, odds: 1.5 }));
    const rp = buildCombo(priced, req(7));
    expect(rp.ok && rp.combinedOdds !== null && Math.abs(rp.combinedOdds - 1.5 ** 7) < 1e-9).toBe(true);
    const partial = many(10).map((c, i) => ({ ...c, odds: i === 0 ? null : 1.5 }));
    const rn = buildCombo(partial, req(10));
    expect(rn.ok && rn.combinedOdds === null && rn.legsPriced === 9).toBe(true);
  });

  it("DIVERSIFIED spreads legs across sports when possible and still fills the size when it cannot", () => {
    const cands = [...many(30, "football", "F").map((c) => ({ ...c, prob: 0.95 - Number(c.matchId.split("-")[2]) * 0.001 })), ...many(10, "tennis", "T").map((c) => ({ ...c, prob: 0.6 })), ...many(10, "hockey", "H").map((c) => ({ ...c, prob: 0.58 }))];
    const top = buildCombo(cands, { size: 12, strategy: "TOP", now: NOW, tz: TZ });
    const div = buildCombo(cands, { size: 12, strategy: "DIVERSIFIED", now: NOW, tz: TZ });
    expect(top.ok && div.ok).toBe(true);
    if (top.ok && div.ok) {
      expect(new Set(top.legs.map((l) => l.sport)).size).toBe(1);
      expect(new Set(div.legs.map((l) => l.sport)).size).toBe(3);
      expect(div.legs).toHaveLength(12);
      expect(div.combinedProb).toBeLessThan(top.combinedProb);
    }
    const onlyFootball = buildCombo(many(30, "football", "F"), { size: 12, strategy: "DIVERSIFIED", now: NOW, tz: TZ });
    expect(onlyFootball.ok && onlyFootball.legs.length === 12).toBe(true);
  });

  it("is deterministic and signatures are order independent", () => {
    const a = buildCombo(many(20), req(10));
    const b = buildCombo([...many(20)].reverse(), req(10));
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      const sig = (legs: Candidate[]) => comboSignature({ kind: "SINGLE_SPORT", sport: "football", strategy: "TOP", size: 10, legs });
      expect(sig(a.legs)).toBe(sig([...b.legs].reverse()));
    }
  });
});

describe("honest probability display", () => {
  it("formats tiny combined probabilities without rounding them to zero", () => {
    expect(probabilityLabel(0.4321)).toBe("43.2%");
    expect(probabilityLabel(0.0123)).toBe("1.23%");
    expect(probabilityLabel(0.9 ** 32)).toBe("3.43%");
    expect(probabilityLabel(1e-9)).toBe("<0.001%");
    expect(oneInN(0.9 ** 32)).toBe("1 in 29.1");
    expect(oneInN(0.6 ** 32)).toMatch(/million|billion|\d{1,3}(,\d{3})+/);
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { COMBO } from "../../config/admin";
import { validateCombo } from "../../src/lib/combos/engine";
import { buildLive, expireStarted, generateStoredCombos, historyStats, settleCombos } from "../../src/lib/combos/service";
import { prisma } from "../../src/lib/db";
import { getComboWindow } from "../../src/lib/time";
import { SEED_TZ, seedTestData } from "../support/seed";

const HOUR = 3600_000;

async function activeWithLegs() {
  return prisma.combo.findMany({ where: { status: "ACTIVE" }, include: { legs: { include: { match: { include: { prediction: true } } } } } });
}

describe("stored combos obey the hard rules", () => {
  beforeAll(async () => {
    await seedTestData();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("generates the required sizes and every stored combo passes validateCombo", async () => {
    const now = new Date();
    const combos = await activeWithLegs();
    expect(combos.length).toBeGreaterThan(10);
    const sizes = new Set(combos.map((c) => c.requestedSize));
    for (const s of [7, 10, 12, 15, 20, 25]) expect(sizes.has(s)).toBe(true);
    for (const c of combos) {
      expect(c.size).toBe(c.legs.length);
      expect(c.size).toBeGreaterThanOrEqual(COMBO.MIN_SIZE);
      expect(c.size).toBeLessThanOrEqual(COMBO.MAX_SIZE);
      const problems = validateCombo(
        c.legs.map((l) => ({ matchId: l.matchId, startsAt: l.startsAt, prob: l.prob, pick: l.pick, sport: l.sportId as never })),
        now,
        SEED_TZ,
      );
      expect(problems).toEqual([]);
    }
  });

  it("uses at most one leg per match and the pick equals the stored model pick", async () => {
    for (const c of await activeWithLegs()) {
      const ids = c.legs.map((l) => l.matchId);
      expect(new Set(ids).size).toBe(ids.length);
      for (const l of c.legs) {
        expect(l.pick).toBe(l.match.prediction!.pick);
        expect(l.prob).toBeCloseTo(l.match.prediction!.pickProb!, 6);
      }
    }
  });

  it("computes the combined probability as the product of the legs", async () => {
    for (const c of await activeWithLegs()) {
      const product = c.legs.reduce((p, l) => p * l.prob, 1);
      expect(c.combinedProb).toBeCloseTo(product, 10);
    }
  });

  it("only contains scheduled matches inside the 3-day window", async () => {
    const now = new Date();
    const window = getComboWindow(now, SEED_TZ);
    for (const c of await activeWithLegs()) {
      for (const l of c.legs) {
        expect(l.match.status).toBe("SCHEDULED");
        expect(l.startsAt.getTime()).toBeGreaterThan(now.getTime());
        expect(l.startsAt.getTime()).toBeLessThan(window.end.getTime());
      }
    }
  });

  it("labels single-sport combos with one sport and mixed combos with several", async () => {
    const combos = await activeWithLegs();
    for (const c of combos.filter((x) => x.kind === "SINGLE_SPORT")) expect(new Set(c.legs.map((l) => l.sportId))).toEqual(new Set([c.sportId]));
    const mixed = combos.filter((x) => x.kind === "MIXED");
    expect(mixed.length).toBeGreaterThan(0);
    expect(mixed.some((c) => new Set(c.legs.map((l) => l.sportId)).size > 1)).toBe(true);
  });

  it("does not pad: sports with too few eligible matches get no stored combo and a clear live message", async () => {
    const hockey = await prisma.combo.count({ where: { status: "ACTIVE", sportId: "hockey" } });
    expect(hockey).toBe(0);
    const tennis12 = await prisma.combo.count({ where: { status: "ACTIVE", sportId: "tennis", requestedSize: { gte: 10 } } });
    expect(tennis12).toBe(0);
    const live = await buildLive({ size: 12, strategy: "TOP", tz: SEED_TZ, sports: ["tennis"] });
    expect(live.ok).toBe(false);
    if (!live.ok) expect(live.message).toMatch(/^Only 9 eligible tennis matches today/);
  });

  it("the database itself rejects two legs from the same match in one combo", async () => {
    const c = (await activeWithLegs())[0];
    await expect(prisma.comboLeg.create({ data: { comboId: c.id, matchId: c.legs[0].matchId, position: 99, sportId: c.legs[0].sportId, leagueId: c.legs[0].leagueId, pick: c.legs[0].pick, prob: 0.5, startsAt: c.legs[0].startsAt } })).rejects.toThrow();
  });

  it("builds filtered live combos (sport, day, minimum confidence)", async () => {
    const all = await buildLive({ size: 7, strategy: "TOP", tz: SEED_TZ });
    expect(all.ok).toBe(true);
    const confident = await buildLive({ size: 7, strategy: "TOP", tz: SEED_TZ, minConfidence: 0.7 });
    if (confident.ok) for (const l of confident.legs) expect(l.prob).toBeGreaterThanOrEqual(0.7);
    const day1 = await buildLive({ size: 7, strategy: "TOP", tz: SEED_TZ, days: [1] });
    const window = getComboWindow(new Date(), SEED_TZ);
    if (day1.ok) for (const l of day1.legs) expect(l.startsAt.getTime()).toBeLessThan(window.days[0].end.getTime());
    const bad = await buildLive({ size: 6, strategy: "TOP", tz: SEED_TZ });
    expect(bad.ok).toBe(false);
    const bad2 = await buildLive({ size: 33, strategy: "TOP", tz: SEED_TZ });
    expect(bad2.ok).toBe(false);
  });
});

describe("lifecycle: regeneration, started matches, settlement, history", () => {
  beforeAll(async () => {
    await seedTestData();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("re-confirms identical combos instead of storing duplicates", async () => {
    const before = await prisma.combo.count({ where: { status: "ACTIVE" } });
    const stats = await generateStoredCombos(new Date(), SEED_TZ);
    expect(stats.created).toBe(0);
    expect(stats.confirmed).toBe(before);
    expect(await prisma.combo.count({ where: { status: "ACTIVE" } })).toBe(before);
  });

  it("removes a match that has started from active combos and keeps the old combo as history", async () => {
    const victim = (await prisma.combo.findFirstOrThrow({ where: { status: "ACTIVE", kind: "MIXED", requestedSize: 7, strategy: "TOP" }, include: { legs: true } }));
    const matchId = victim.legs[0].matchId;
    await prisma.match.update({ where: { id: matchId }, data: { startsAt: new Date(Date.now() - 5 * 60_000) } });
    await generateStoredCombos(new Date(), SEED_TZ);
    const stillActive = await prisma.comboLeg.count({ where: { matchId, combo: { status: "ACTIVE" } } });
    expect(stillActive).toBe(0);
    const old = await prisma.combo.findUniqueOrThrow({ where: { id: victim.id } });
    expect(["LOCKED", "SUPERSEDED"]).toContain(old.status);
    const replacement = await prisma.combo.findFirst({ where: { status: "ACTIVE", kind: "MIXED", requestedSize: 7, strategy: "TOP" }, include: { legs: true } });
    expect(replacement).not.toBeNull();
    expect(replacement!.legs.length).toBe(7);
    expect(replacement!.legs.some((l) => l.matchId === matchId)).toBe(false);
  });

  it("locks combos once their first leg starts and settles them from real results", async () => {
    const future = new Date(Date.now() + 80 * HOUR);
    const winner = await prisma.combo.findFirstOrThrow({ where: { status: "ACTIVE", sportId: "football", requestedSize: 7, strategy: "TOP" }, include: { legs: true } });
    const loser = await prisma.combo.findFirstOrThrow({ where: { status: "ACTIVE", sportId: "tennis", requestedSize: 7, strategy: "TOP" }, include: { legs: true } });
    const voided = await prisma.combo.findFirstOrThrow({ where: { status: "ACTIVE", sportId: "basketball", requestedSize: 7, strategy: "TOP" }, include: { legs: true } });

    for (const l of winner.legs) await prisma.match.update({ where: { id: l.matchId }, data: { status: "FINISHED", winner: l.pick, homeScore: 1, awayScore: 0 } });
    // loser combo: only its first leg has finished (and lost) – the combo must be LOST immediately.
    const first = loser.legs[0];
    await prisma.match.update({ where: { id: first.matchId }, data: { status: "FINISHED", winner: first.pick === "HOME" ? "AWAY" : "HOME", homeScore: 0, awayScore: 1 } });
    // void combo: one leg cancelled, the rest won.
    for (const [i, l] of voided.legs.entries()) {
      if (i === 0) await prisma.match.update({ where: { id: l.matchId }, data: { status: "CANCELLED" } });
      else await prisma.match.update({ where: { id: l.matchId }, data: { status: "FINISHED", winner: l.pick } });
    }
    // The three combos are single-sport, so they share no matches and cannot influence each other.

    expect(await expireStarted(future)).toBeGreaterThan(0);
    const res = await settleCombos(future);
    expect(res.legsSettled).toBeGreaterThan(0);

    expect((await prisma.combo.findUniqueOrThrow({ where: { id: winner.id } })).status).toBe("WON");
    expect((await prisma.combo.findUniqueOrThrow({ where: { id: loser.id } })).status).toBe("LOST");
    expect((await prisma.combo.findUniqueOrThrow({ where: { id: voided.id } })).status).toBe("VOID");
    const wonLegs = await prisma.comboLeg.findMany({ where: { comboId: winner.id } });
    expect(wonLegs.every((l) => l.result === "WON")).toBe(true);
  });

  it("hit-rate statistics count only combos that reached kick-off", async () => {
    const stats = await historyStats();
    const total = stats.bySize.reduce((n, s) => n + s.played, 0);
    const played = await prisma.combo.count({ where: { status: { in: ["LOCKED", "WON", "LOST", "VOID"] } } });
    expect(total).toBe(played);
    const superseded = await prisma.combo.count({ where: { status: "SUPERSEDED" } });
    expect(superseded).toBeGreaterThan(0);
    for (const s of stats.bySize) {
      if (s.won + s.lost > 0) expect(s.hitRate).toBeCloseTo(s.won / (s.won + s.lost), 10);
      else expect(s.hitRate).toBeNull();
    }
    expect(stats.legs.settled).toBeGreaterThan(0);
  });
});

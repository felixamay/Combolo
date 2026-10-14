import { generateKeyPairSync } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { buildLive } from "../../src/lib/combos/service";
import { prisma } from "../../src/lib/db";
import { resetEnvCache } from "../../src/lib/env";
import { createKalshiCombo } from "../../src/lib/kalshi/combo";
import { SEED_TZ, seedTestData } from "../support/seed";

/** Link the first `n` eligible predictions (by pick) to fake Kalshi markets. */
async function linkKalshi(n: number) {
  const preds = await prisma.prediction.findMany({
    where: { eligible: true, pick: { not: null }, match: { status: "SCHEDULED", startsAt: { gt: new Date() } } },
    include: { match: true },
    orderBy: { pickProb: "desc" },
  });
  const linked = preds.slice(0, n);
  await prisma.kalshiMarket.createMany({
    data: linked.map((p, i) => ({
      matchId: p.matchId,
      side: p.pick!,
      seriesTicker: "KXTESTGAME",
      eventTicker: `KXTESTGAME-E${i}`,
      marketTicker: `KXTESTGAME-E${i}-${p.pick}`,
      eventTitle: `${p.match.homeName} vs ${p.match.awayName}`,
      marketTitle: p.pick === "HOME" ? p.match.homeName : p.pick === "AWAY" ? p.match.awayName : "Tie",
      yesAsk: 0.7,
      yesBid: 0.68,
    })),
  });
  return linked;
}

describe("Kalshi combos", () => {
  let linked: Awaited<ReturnType<typeof linkKalshi>>;
  beforeAll(async () => {
    await seedTestData();
    linked = await linkKalshi(9);
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    process.env.KALSHI_API_KEY_ID = "test-key";
    process.env.KALSHI_PRIVATE_KEY = privateKey.export({ type: "pkcs8", format: "pem" }).toString().replace(/\n/g, "\\n");
    resetEnvCache();
  });
  afterEach(() => vi.unstubAllGlobals());
  afterAll(async () => {
    delete process.env.KALSHI_API_KEY_ID;
    delete process.env.KALSHI_PRIVATE_KEY;
    resetEnvCache();
    await prisma.$disconnect();
  });

  it("builds Kalshi-only combos from linked legs only", async () => {
    const res = await buildLive({ size: 7, strategy: "TOP", tz: SEED_TZ, kalshiOnly: true });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const ids = new Set(linked.map((p) => p.matchId));
    expect(res.legs.every((l) => l.kalshi && ids.has(l.matchId))).toBe(true);
    const tooBig = await buildLive({ size: 10, strategy: "TOP", tz: SEED_TZ, kalshiOnly: true });
    expect(tooBig.ok).toBe(false);
  });

  it("creates the combo once with a signed request and reuses it for the same legs", async () => {
    const fetchMock = vi.fn(async (_url: URL, init: RequestInit) => {
      const headers = init.headers as Record<string, string>;
      expect(init.method).toBe("POST");
      expect(headers["KALSHI-ACCESS-KEY"]).toBe("test-key");
      expect(headers["KALSHI-ACCESS-SIGNATURE"]).toMatch(/^[A-Za-z0-9+/]+=*$/);
      const body = JSON.parse(String(init.body));
      expect(body.selected_markets).toHaveLength(7);
      expect(body.selected_markets.every((m: { side: string }) => m.side === "yes")).toBe(true);
      return new Response(JSON.stringify({ event_ticker: "KXMVE-EV1", market_ticker: "KXMVE-EV1-M1", market: { yes_ask_dollars: "0.0900" } }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const legs = linked.slice(0, 7).map((p) => ({ matchId: p.matchId, pick: p.pick! }));
    const first = await createKalshiCombo(legs);
    expect(first).toMatchObject({ ok: true, marketTicker: "KXMVE-EV1-M1", yesAsk: 0.09, reused: false });
    const again = await createKalshiCombo([...legs].reverse());
    expect(again).toMatchObject({ ok: true, marketTicker: "KXMVE-EV1-M1", reused: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refuses legs Kalshi does not list, without calling Kalshi", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const other = await prisma.prediction.findFirst({ where: { eligible: true, pick: { not: null }, matchId: { notIn: linked.map((p) => p.matchId) } } });
    const legs = [...linked.slice(0, 6), other!].map((p) => ({ matchId: p.matchId, pick: p.pick! }));
    const res = await createKalshiCombo(legs);
    expect(res).toMatchObject({ ok: false, status: 409, message: "1 leg is not listed on Kalshi." });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

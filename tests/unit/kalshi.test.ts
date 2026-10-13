import { generateKeyPairSync, verify, constants } from "node:crypto";
import { describe, expect, it } from "vitest";
import { matchKalshiGame, sameParticipant } from "../../src/lib/ingest/kalshi-match";
import type { OddsTarget } from "../../src/lib/ingest/odds-match";
import { legsKey, price, signRequest, type KalshiGame } from "../../src/lib/providers/kalshi";

const start = new Date("2026-10-17T11:30:00Z");
const t = (id: string, home: string, away: string, sport = "football", shift = 0, tour: string | null = null): OddsTarget => ({ id, sport, startsAt: new Date(start.getTime() + shift), homeName: home, awayName: away, tour });
// Kalshi publishes the expected settlement time, about 3 h after kick-off.
const game = (names: string[], shiftH = 3, tie = false): KalshiGame => ({
  seriesTicker: "KXEPLGAME",
  eventTicker: "KXEPLGAME-26OCT17EVECFC",
  title: `${names[0]} vs ${names[1]}`,
  startsAt: new Date(start.getTime() + shiftH * 3600_000),
  outcomes: [...names, ...(tie ? ["Tie"] : [])].map((n, i) => ({ ticker: `T-${i}`, name: n, yesAsk: 0.4, yesBid: 0.38 })),
});

describe("sameParticipant", () => {
  it.each([
    ["Chelsea", "Chelsea FC", "football"],
    ["Los Angeles D", "Los Angeles Dodgers", "baseball"],
    ["New York", "New York Knicks", "basketball"],
    ["Sporting CP", "Sporting Clube de Portugal", "football"],
    ["Jacksonville St.", "Jacksonville State Gamecocks", "american-football"],
    ["Lens", "RC Lens", "football"],
  ])("%s ≈ %s", (k, o, sport) => expect(sameParticipant(k, o, sport)).toBe(true));

  it.each([
    ["Los Angeles D", "Los Angeles Angels", "baseball"],
    ["Chelsea", "Arsenal", "football"],
  ])("%s ≠ %s", (k, o, sport) => expect(sameParticipant(k, o, sport)).toBe(false));

  it("matches tennis players by tour key", () => {
    expect(sameParticipant("Tommy Paul", "T. Paul", "tennis", "ATP")).toBe(true);
    expect(sameParticipant("Tommy Paul", "Tommy Haas", "tennis", "ATP")).toBe(false);
  });
});

describe("matchKalshiGame", () => {
  it("maps each Kalshi outcome to our home/away side and the tie to DRAW", () => {
    const hit = matchKalshiGame([t("m1", "Everton FC", "Chelsea FC")], game(["Chelsea", "Everton"], 3, true), "football");
    expect(hit?.matchId).toBe("m1");
    expect(hit?.sides.HOME?.name).toBe("Everton");
    expect(hit?.sides.AWAY?.name).toBe("Chelsea");
    expect(hit?.sides.DRAW?.name).toBe("Tie");
  });

  it("needs both participants", () => {
    expect(matchKalshiGame([t("m1", "Everton FC", "Arsenal FC")], game(["Everton", "Chelsea"]), "football")).toBeNull();
  });

  it("rejects implausible times", () => {
    expect(matchKalshiGame([t("m1", "Everton FC", "Chelsea FC")], game(["Everton", "Chelsea"], 30), "football")).toBeNull();
    expect(matchKalshiGame([t("m1", "Everton FC", "Chelsea FC")], game(["Everton", "Chelsea"], -5), "football")).toBeNull();
  });

  it("returns null when two stored matches fit (never guesses)", () => {
    const targets = [t("m1", "Everton FC", "Chelsea FC"), t("m2", "Everton", "Chelsea", "football", 3600_000)];
    expect(matchKalshiGame(targets, game(["Everton", "Chelsea"]), "football")).toBeNull();
  });

  it("uses the opponent to tell New York teams apart", () => {
    const targets = [t("knicks", "New York Knicks", "Toronto Raptors", "basketball"), t("nets", "Brooklyn Nets", "Boston Celtics", "basketball")];
    expect(matchKalshiGame(targets, game(["New York", "Toronto"]), "basketball")?.matchId).toBe("knicks");
  });

  it("allows the tennis date placeholder", () => {
    const hit = matchKalshiGame([t("m1", "D. Medvedev", "S. Tsitsipas", "tennis", 0, "ATP")], game(["Daniil Medvedev", "Stefanos Tsitsipas"], -6), "tennis", "ATP");
    expect(hit?.sides.HOME?.name).toBe("Daniil Medvedev");
  });
});

describe("Kalshi provider helpers", () => {
  it("parses dollar prices and treats 0/1/missing as no offer", () => {
    expect(price("0.4600")).toBeCloseTo(0.46);
    expect(price(0.3)).toBe(0.3);
    expect(price("0.0000")).toBeNull();
    expect(price("1.0000")).toBeNull();
    expect(price(null)).toBeNull();
  });

  it("keys a set of legs independent of order", () => {
    const a = [{ eventTicker: "E1", marketTicker: "M1" }, { eventTicker: "E2", marketTicker: "M2" }];
    expect(legsKey(a)).toBe(legsKey([...a].reverse()));
    expect(legsKey(a)).not.toBe(legsKey([a[0]]));
  });

  it("signs timestamp + method + path with RSA-PSS", () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const sig = signRequest(privateKey, "1700000000000", "post", "/trade-api/v2/multivariate_event_collections/X");
    const ok = verify("sha256", Buffer.from("1700000000000POST/trade-api/v2/multivariate_event_collections/X"), { key: publicKey, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: constants.RSA_PSS_SALTLEN_DIGEST }, Buffer.from(sig, "base64"));
    expect(ok).toBe(true);
  });

  it("signs with Ed25519 keys", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const sig = signRequest(privateKey, "1", "GET", "/p");
    expect(verify(null, Buffer.from("1GET/p"), publicKey, Buffer.from(sig, "base64"))).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { matchOddsEvent, type OddsTarget } from "../../src/lib/ingest/odds-match";

const at = new Date("2026-10-13T18:00:00Z");
const t = (id: string, home: string, away: string, sport = "football", shift = 0): OddsTarget => ({ id, sport, startsAt: new Date(at.getTime() + shift), homeName: home, awayName: away });

describe("matchOddsEvent", () => {
  it("matches on normalised names and kick-off", () => {
    const hit = matchOddsEvent([t("m1", "Manchester United FC", "Arsenal FC")], { homeName: "Manchester United", awayName: "Arsenal", startsAt: at }, "football");
    expect(hit).toEqual({ matchId: "m1", swapped: false });
  });

  it("flags swapped sides so prices are flipped", () => {
    const hit = matchOddsEvent([t("m1", "Arsenal FC", "Chelsea FC")], { homeName: "Chelsea", awayName: "Arsenal", startsAt: at }, "football");
    expect(hit).toEqual({ matchId: "m1", swapped: true });
  });

  it("never attaches odds on a different day", () => {
    expect(matchOddsEvent([t("m1", "Arsenal FC", "Chelsea FC", "football", 24 * 3600_000)], { homeName: "Arsenal", awayName: "Chelsea", startsAt: at }, "football")).toBeNull();
  });

  it("returns null when the pairing is ambiguous", () => {
    const targets = [t("m1", "Arsenal FC", "Chelsea FC"), t("m2", "Arsenal FC", "Chelsea FC", "football", 3600_000)];
    expect(matchOddsEvent(targets, { homeName: "Arsenal", awayName: "Chelsea", startsAt: at }, "football")).toBeNull();
  });

  it("matches tennis players across name formats", () => {
    const hit = matchOddsEvent([t("m1", "A. Vale", "Bruno Keller", "tennis")], { homeName: "Adrian Vale", awayName: "B. Keller", startsAt: at }, "tennis", "ATP");
    expect(hit?.matchId).toBe("m1");
  });

  it("ignores matches of another sport", () => {
    expect(matchOddsEvent([t("m1", "Hawks", "Bulls", "basketball")], { homeName: "Hawks", awayName: "Bulls", startsAt: at }, "football")).toBeNull();
  });
});

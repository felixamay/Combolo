import { describe, expect, it } from "vitest";
import { LEAGUE_ALIASES } from "../../config/admin";
import { leagueIdentity, normName, playerKey } from "../../src/lib/ingest/names";

describe("league identity", () => {
  it("merges demonym and country-qualified spellings of the same league", () => {
    const a = leagueIdentity("English Premier League", null, LEAGUE_ALIASES);
    const b = leagueIdentity("Premier League", "England", LEAGUE_ALIASES);
    expect(a).toEqual(b);
  });

  it("keeps same-named leagues of different countries apart", () => {
    expect(leagueIdentity("Premier League", "England")).not.toEqual(leagueIdentity("Premier League", "Russia"));
  });

  it("applies aliases for providers that name a league differently", () => {
    expect(leagueIdentity("Primera Division", "Spain", LEAGUE_ALIASES)).toEqual(leagueIdentity("La Liga", "Spain", LEAGUE_ALIASES));
  });

  it("strips UEFA/EFL noise", () => {
    expect(leagueIdentity("UEFA Champions League", null).base).toBe(leagueIdentity("Champions League", null).base);
    expect(leagueIdentity("EFL Championship", "England").base).toBe("championship");
  });
});

describe("team and player keys", () => {
  it("normalises club-suffix noise and diacritics", () => {
    expect(normName("Manchester United FC")).toBe(normName("Man United"));
    expect(normName("FC Köln")).toBe(normName("Koln"));
  });

  it("resolves tennis name formats to one key", () => {
    expect(playerKey("M. Navone", "ATP")).toBe(playerKey("Mariano Navone", "ATP"));
    expect(playerKey("Navone M.", "ATP")).toBe(playerKey("Mariano Navone", "ATP"));
    expect(playerKey("Carlos Alcaraz", "ATP")).not.toBe(playerKey("Carlos Alcaraz", "WTA"));
  });
});

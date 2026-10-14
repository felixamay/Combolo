import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { HIGHLIGHTLY_PRODUCTS } from "../../config/admin";
import { flattenGameRow } from "../../src/lib/providers/apisports";
import { normaliseEvent } from "../../src/lib/providers/apitennis";
import { normaliseMatch as fdMatch } from "../../src/lib/providers/footballdata";
import { normaliseMatch as hlMatch } from "../../src/lib/providers/highlightly";
import { parseMatchesCsv, setsFromScore } from "../../src/lib/providers/sackmann";
import { decideWinner } from "../../src/lib/providers/types";

const fdRow = (over: Record<string, unknown> = {}) =>
  ({
    id: 1,
    utcDate: "2026-10-13T18:45:00Z",
    status: "FINISHED",
    matchday: 8,
    competition: { id: 2021, name: "Premier League", code: "PL" },
    area: { name: "England" },
    season: { startDate: "2026-08-15" },
    homeTeam: { id: 57, name: "Arsenal FC" },
    awayTeam: { id: 61, name: "Chelsea FC" },
    score: { winner: "HOME_TEAM", duration: "REGULAR", fullTime: { home: 2, away: 1 } },
    ...over,
  }) as never;

describe("football-data normaliser", () => {
  it("maps a regular-time result", () => {
    const f = fdMatch(fdRow(), null, true)!;
    expect(f.status).toBe("FINISHED");
    expect(f.homeScore).toBe(2);
    expect(f.awayScore).toBe(1);
    expect(f.round).toBe("Matchday 8");
    expect(f.league.season).toBe("2026");
  });

  it("uses the 90-minute score when a match went to extra time", () => {
    const f = fdMatch(fdRow({ score: { winner: "AWAY_TEAM", duration: "PENALTY_SHOOTOUT", fullTime: { home: 4, away: 5 }, regularTime: { home: 1, away: 1 } } }), null, true)!;
    expect(f.homeScore).toBe(1);
    expect(f.awayScore).toBe(1);
    expect(decideWinner(f.homeScore, f.awayScore, true)).toBe("DRAW");
  });

  it("does not invent a score for scheduled matches and voids awarded results", () => {
    const sched = fdMatch(fdRow({ status: "TIMED", score: { winner: null, duration: "REGULAR", fullTime: { home: null, away: null } } }), null, false)!;
    expect(sched.status).toBe("SCHEDULED");
    expect(sched.homeScore).toBeNull();
    expect(fdMatch(fdRow({ status: "AWARDED" }), null, true)!.status).toBe("ABANDONED");
  });

  it("rejects rows without a parsable date", () => {
    expect(fdMatch(fdRow({ utcDate: "garbage" }), null, false)).toBeNull();
  });
});

describe("Highlightly normaliser", () => {
  const nba = HIGHLIGHTLY_PRODUCTS.find((p) => p.scope === "nba")!;
  const soccer = HIGHLIGHTLY_PRODUCTS.find((p) => p.scope === "soccer")!;
  const row = (over: Record<string, unknown>) =>
    ({ id: 9, date: "2026-10-13T00:30:00.000Z", league: { id: 5, name: "NBA", season: 2026 }, homeTeam: { id: 1, name: "Lakers" }, awayTeam: { id: 2, name: "Celtics" }, state: { description: "Finished", score: { current: "110 - 104" } }, ...over }) as never;

  it("parses a finished basketball game", () => {
    const f = hlMatch(nba, row({}), true)!;
    expect(f.homeScore).toBe(110);
    expect(f.winner).toBe("HOME");
    expect(f.sport).toBe("basketball");
  });

  it("does not decide a football winner from an after-penalties score", () => {
    const f = hlMatch(soccer, row({ state: { description: "Finished after penalties", score: { current: "1 - 1" } } }), true)!;
    expect(f.winner).toBeNull();
  });

  it("skips matches whose time is not announced", () => {
    expect(hlMatch(nba, row({ state: { description: "To be announced" } }), false)).toBeNull();
  });
});

describe("API-Tennis normaliser", () => {
  const ev = (over: Record<string, unknown> = {}) =>
    ({
      event_key: 777,
      event_date: "2026-10-13",
      event_time: "14:00",
      event_first_player: "A. Vale",
      first_player_key: 11,
      event_second_player: "B. Keller",
      second_player_key: 12,
      event_final_result: "2 - 1",
      event_winner: "First Player",
      event_status: "Finished",
      event_type_type: "Atp Singles",
      tournament_name: "Test Open",
      tournament_key: 3,
      ...over,
    }) as never;

  it("maps winner and set score", () => {
    const f = normaliseEvent(ev(), true)!;
    expect(f.winner).toBe("HOME");
    expect(f.homeScore).toBe(2);
    expect(f.league.tour).toBe("ATP");
  });

  it("ignores doubles and non-ATP/WTA events", () => {
    expect(normaliseEvent(ev({ event_type_type: "Atp Doubles" }), true)).toBeNull();
    expect(normaliseEvent(ev({ event_type_type: "Challenger Men Singles" }), true)).toBeNull();
  });

  it("treats a retirement without a winner as abandoned, not as a result", () => {
    const f = normaliseEvent(ev({ event_status: "Retired", event_winner: null, event_final_result: "0 - 0" }), true)!;
    expect(f.status).toBe("ABANDONED");
    expect(f.winner).toBeNull();
  });

  it("keeps unfinished matches scheduled with no scores", () => {
    const f = normaliseEvent(ev({ event_status: "", event_winner: null, event_final_result: "-" }), false)!;
    expect(f.status).toBe("SCHEDULED");
    expect(f.homeScore).toBeNull();
  });
});

describe("Sackmann CSV parser", () => {
  const csv = readFileSync(path.join(__dirname, "../fixtures/sackmann_atp_sample.csv"), "utf8");
  it("parses finished matches, skips walkovers and keeps retirements with a winner", () => {
    const rows = parseMatchesCsv("atp", csv);
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.status === "FINISHED" && r.individual && r.provider === "sackmann")).toBe(true);
    const ret = rows.find((r) => r.externalId.endsWith("-105"))!;
    expect(ret.homeScore).not.toBeNull();
  });

  it("assigns winners to both sides rather than always home", () => {
    const sides = new Set(parseMatchesCsv("atp", csv).map((r) => r.winner));
    expect(sides.size).toBeGreaterThanOrEqual(1);
    for (const r of parseMatchesCsv("atp", csv)) expect(r.winner === "HOME" || r.winner === "AWAY").toBe(true);
  });

  it("counts sets", () => {
    expect(setsFromScore("6-4 3-6 7-6(5)")).toEqual({ winner: 2, loser: 1 });
    expect(setsFromScore("W/O")).toBeNull();
  });
});

describe("API-Sports american football rows", () => {
  it("flattens the nested game object into the shared games shape", () => {
    const raw = {
      game: { id: 17519, date: { timezone: "UTC", date: "2026-10-18", time: "17:00", timestamp: 1792342800 }, status: { short: "NS", long: "Not Started" } },
      league: { id: 1, name: "NFL", season: "2026", logo: "l.png", country: { name: "USA", code: "US" } },
      teams: { home: { id: 1, name: "Las Vegas Raiders", logo: "a.png" }, away: { id: 2, name: "Denver Broncos", logo: "b.png" } },
      scores: { home: { total: null }, away: { total: null } },
    };
    const flat = flattenGameRow(raw) as Record<string, unknown>;
    expect(flat.id).toBe(17519);
    expect(flat.date).toBe("2026-10-18T17:00:00.000Z");
    expect(flat.status).toEqual({ short: "NS", long: "Not Started" });
    expect(flat.country).toEqual({ name: "USA", code: "US" });
  });

  it("leaves rows of the other games APIs untouched", () => {
    const row = { id: 5, date: "2026-10-18T17:00:00+00:00", status: { short: "NS" } };
    expect(flattenGameRow(row)).toBe(row);
  });
});

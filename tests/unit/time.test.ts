import { describe, expect, it } from "vitest";
import { dayIndexOf, getComboWindow, isInWindow, localDateKey, startOfLocalDay, zonedTimeToUtc } from "@/lib/time";

const CHI = "America/Chicago";

describe("combo window (hard rule 1)", () => {
  it("ends at local midnight after the 3rd calendar day (CDT, UTC-5)", () => {
    const now = new Date("2026-10-12T15:30:00Z"); // 10:30 Mon in Chicago
    const w = getComboWindow(now, CHI);
    // day 3 = Wed 14 Oct, window ends Thu 15 Oct 00:00 CDT = 05:00Z
    expect(w.end.toISOString()).toBe("2026-10-15T05:00:00.000Z");
    expect(w.days.map((d) => d.dateKey)).toEqual(["2026-10-12", "2026-10-13", "2026-10-14"]);
  });

  it("includes a match 1 minute before the end and excludes one at / after the end", () => {
    const now = new Date("2026-10-12T15:30:00Z");
    const w = getComboWindow(now, CHI);
    expect(isInWindow(new Date("2026-10-15T04:59:00Z"), w)).toBe(true);
    expect(isInWindow(new Date("2026-10-15T05:00:00Z"), w)).toBe(false);
    expect(isInWindow(new Date("2026-10-15T05:01:00Z"), w)).toBe(false);
    expect(isInWindow(new Date("2026-10-20T12:00:00Z"), w)).toBe(false);
  });

  it("excludes matches that have already started (or start exactly now)", () => {
    const now = new Date("2026-10-12T15:30:00Z");
    const w = getComboWindow(now, CHI);
    expect(isInWindow(new Date("2026-10-12T15:29:59Z"), w)).toBe(false);
    expect(isInWindow(now, w)).toBe(false);
    expect(isInWindow(new Date("2026-10-12T15:30:01Z"), w)).toBe(true);
  });

  it("assigns day 1/2/3 using the user's timezone, not UTC", () => {
    const now = new Date("2026-10-12T15:30:00Z");
    const w = getComboWindow(now, CHI);
    // 03:30Z on 13th is still the 12th in Chicago -> day 1
    expect(dayIndexOf(new Date("2026-10-13T03:30:00Z"), w)).toBe(1);
    // 05:00Z on 13th is midnight in Chicago -> day 2
    expect(dayIndexOf(new Date("2026-10-13T05:00:00Z"), w)).toBe(2);
    expect(dayIndexOf(new Date("2026-10-14T20:00:00Z"), w)).toBe(3);
    expect(dayIndexOf(new Date("2026-10-15T20:00:00Z"), w)).toBeNull();
  });

  it("window differs per timezone (Asia/Tokyo is a day ahead of Chicago late in the evening)", () => {
    const now = new Date("2026-10-12T23:00:00Z"); // 18:00 Mon Chicago, 08:00 Tue Tokyo
    const chi = getComboWindow(now, CHI);
    const tok = getComboWindow(now, "Asia/Tokyo");
    expect(chi.days[0].dateKey).toBe("2026-10-12");
    expect(tok.days[0].dateKey).toBe("2026-10-13");
    expect(tok.end.getTime()).toBeGreaterThan(chi.end.getTime() - 24 * 3600 * 1000);
  });

  it("handles the DST change (clocks go back 1 Nov 2026 in Chicago)", () => {
    const now = new Date("2026-10-31T12:00:00Z"); // Sat 7:00 CDT
    const w = getComboWindow(now, CHI);
    // days: Sat 31 Oct, Sun 1 Nov (25h), Mon 2 Nov -> ends Tue 3 Nov 00:00 CST = 06:00Z
    expect(w.end.toISOString()).toBe("2026-11-03T06:00:00.000Z");
    const sunStart = startOfLocalDay(now, CHI, 1);
    expect(sunStart.toISOString()).toBe("2026-11-01T05:00:00.000Z");
    expect(localDateKey(new Date("2026-11-01T07:30:00Z"), CHI)).toBe("2026-11-01");
  });

  it("converts wall-clock times across DST (spring forward 8 Mar 2026)", () => {
    expect(zonedTimeToUtc(2026, 3, 8, 12, 0, 0, CHI).toISOString()).toBe("2026-03-08T17:00:00.000Z");
    expect(zonedTimeToUtc(2026, 3, 7, 12, 0, 0, CHI).toISOString()).toBe("2026-03-07T18:00:00.000Z");
  });
});

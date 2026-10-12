import { z } from "zod";
import { THESPORTSDB_SPORTS } from "../../../config/admin";
import { getEnv } from "../env";
import { SPORTS, type SportId } from "../sports";
import { callProvider, validateRows } from "./http";
import { decideWinner, type NormFixture, type NormStatus } from "./types";
import { num, str } from "./util";

/**
 * TheSportsDB. Free key "3". Used ONLY for schedules, names, badges (never for stats).
 * `eventsday.php?d=YYYY-MM-DD&s=<Sport>` – the free tier caps results per call, so this is a gap filler.
 */

export function theSportsDbEnabled(): boolean {
  return true;
}

const envelope = z.looseObject({ events: z.array(z.unknown()).nullable().optional() });

const eventRow = z.looseObject({
  idEvent: z.string(),
  strTimestamp: z.string().nullish(),
  dateEvent: z.string().nullish(),
  strTime: z.string().nullish(),
  idLeague: z.string().nullish(),
  strLeague: z.string().nullish(),
  strCountry: z.string().nullish(),
  strSeason: z.string().nullish(),
  strHomeTeam: z.string().min(1),
  strAwayTeam: z.string().min(1),
  idHomeTeam: z.string().nullish(),
  idAwayTeam: z.string().nullish(),
  strHomeTeamBadge: z.string().nullish(),
  strAwayTeamBadge: z.string().nullish(),
  intHomeScore: z.union([z.string(), z.number()]).nullish(),
  intAwayScore: z.union([z.string(), z.number()]).nullish(),
  strStatus: z.string().nullish(),
  strPostponed: z.string().nullish(),
  idAPIfootball: z.string().nullish(),
  intRound: z.union([z.string(), z.number()]).nullish(),
});

function mapStatus(s: string | null | undefined, postponed: string | null | undefined, hasScores: boolean): NormStatus {
  const v = (s ?? "").toLowerCase();
  if ((postponed ?? "").toLowerCase() === "yes" || v.includes("postp") || v === "pst") return "POSTPONED";
  if (v.includes("cancel") || v === "canc") return "CANCELLED";
  if (v.includes("abandon")) return "ABANDONED";
  if (v === "ns" || v === "not started" || v === "") return hasScores ? "FINISHED" : "SCHEDULED";
  if (v === "ft" || v.includes("finished") || v === "aet" || v === "pen" || v === "aot" || v === "ao") return "FINISHED";
  return "LIVE";
}

function parseTs(r: z.infer<typeof eventRow>): Date | null {
  const raw = r.strTimestamp ?? (r.dateEvent ? `${r.dateEvent}T${r.strTime ?? "00:00:00"}` : null);
  if (!raw) return null;
  const iso = /[zZ]|[+-]\d\d:?\d\d$/.test(raw) ? raw : `${raw}Z`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function fetchEventsDay(sport: SportId, date: string): Promise<NormFixture[]> {
  const key = getEnv().THESPORTSDB_KEY;
  const sportName = THESPORTSDB_SPORTS[sport];
  const res = await callProvider({
    provider: "thesportsdb",
    scope: sport,
    url: `https://www.thesportsdb.com/api/v1/json/${encodeURIComponent(key)}/eventsday.php`,
    endpoint: "eventsday.php",
    query: { d: date, s: sportName },
    schema: envelope,
    maxWaitMs: 70_000,
  });
  const rows = await validateRows("thesportsdb", "eventsday.php", res.data.events ?? [], eventRow);
  const out: NormFixture[] = [];
  for (const r of rows) {
    const startsAt = parseTs(r);
    if (!startsAt || !r.idHomeTeam || !r.idAwayTeam || !r.idLeague || !r.strLeague) continue;
    const hs = num(r.intHomeScore);
    const as = num(r.intAwayScore);
    const status = mapStatus(r.strStatus, r.strPostponed, hs !== null && as !== null);
    const meta = SPORTS[sport];
    out.push({
      provider: "thesportsdb",
      scope: sport,
      externalId: r.idEvent,
      sport,
      league: { externalId: r.idLeague, name: r.strLeague, country: str(r.strCountry), season: str(r.strSeason) },
      round: r.intRound != null ? `Round ${r.intRound}` : null,
      startsAt,
      status,
      statusDetail: r.strStatus ?? null,
      home: { externalId: r.idHomeTeam, name: r.strHomeTeam, logo: r.strHomeTeamBadge ?? null },
      away: { externalId: r.idAwayTeam, name: r.strAwayTeam, logo: r.strAwayTeamBadge ?? null },
      homeScore: status === "FINISHED" ? hs : null,
      awayScore: status === "FINISHED" ? as : null,
      winner: status === "FINISHED" ? decideWinner(hs, as, meta.hasDraw) : null,
      individual: meta.individual,
      altIds: r.idAPIfootball && sport === "football" ? [{ provider: "apisports", scope: "football", externalId: r.idAPIfootball }] : undefined,
    });
  }
  return out;
}

import type { ProviderId } from "../quota/rules";
import type { SportId } from "../sports";

export type NormStatus = "SCHEDULED" | "LIVE" | "FINISHED" | "POSTPONED" | "CANCELLED" | "ABANDONED";
export type NormWinner = "HOME" | "AWAY" | "DRAW";

export interface NormParticipant {
  externalId: string;
  name: string;
  logo?: string | null;
  country?: string | null;
  /** Optional hint ids from other providers (e.g. TheSportsDB gives the API-Football id). */
  hints?: Array<{ provider: ProviderId; scope: string; externalId: string }>;
}

export interface NormLeague {
  externalId: string;
  name: string;
  country?: string | null;
  logo?: string | null;
  tour?: string | null;
  season?: string | null;
}

export interface NormFixture {
  provider: ProviderId;
  scope: string;
  externalId: string;
  sport: SportId;
  league: NormLeague;
  round?: string | null;
  startsAt: Date;
  status: NormStatus;
  statusDetail?: string | null;
  home: NormParticipant;
  away: NormParticipant;
  homeScore?: number | null;
  awayScore?: number | null;
  winner?: NormWinner | null;
  surface?: string | null;
  bestOf?: number | null;
  neutralVenue?: boolean;
  individual?: boolean;
  /** Ids of the same fixture in other providers (e.g. TheSportsDB exposes the API-Football fixture id). */
  altIds?: Array<{ provider: ProviderId; scope: string; externalId: string }>;
  /** Marks rows loaded as history (H2H / form lists / datasets) rather than scheduled fixtures. */
  historical?: boolean;
}

export interface NormStandingRow {
  participant: NormParticipant;
  position: number;
  points?: number | null;
  played?: number | null;
  wins?: number | null;
  draws?: number | null;
  losses?: number | null;
  goalsFor?: number | null;
  goalsAgainst?: number | null;
  form?: string | null;
  group?: string | null;
  home?: { played?: number; wins?: number; draws?: number; losses?: number } | null;
  away?: { played?: number; wins?: number; draws?: number; losses?: number } | null;
}

export interface NormStandings {
  provider: ProviderId;
  scope: string;
  sport: SportId;
  league: NormLeague;
  rows: NormStandingRow[];
  individual?: boolean;
}

export function decideWinner(home: number | null | undefined, away: number | null | undefined, hasDraw: boolean): NormWinner | null {
  if (home == null || away == null) return null;
  if (home > away) return "HOME";
  if (away > home) return "AWAY";
  return hasDraw ? "DRAW" : null;
}

export function formFromResults(results: Array<"W" | "D" | "L">): string {
  return results.join("");
}

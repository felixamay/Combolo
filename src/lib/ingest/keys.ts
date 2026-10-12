import type { Match } from "@prisma/client";

export type EntityKind = "TEAM" | "PLAYER";

export function entityKey(kind: EntityKind, id: string): string {
  return `${kind === "TEAM" ? "T" : "P"}:${id}`;
}

export function pairKeys(a: string, b: string): { keyLow: string; keyHigh: string } {
  return a <= b ? { keyLow: a, keyHigh: b } : { keyLow: b, keyHigh: a };
}

export function sidesOf(m: Pick<Match, "homeTeamId" | "awayTeamId" | "homePlayerId" | "awayPlayerId">): { kind: EntityKind; home: string; away: string } | null {
  if (m.homeTeamId && m.awayTeamId) return { kind: "TEAM", home: entityKey("TEAM", m.homeTeamId), away: entityKey("TEAM", m.awayTeamId) };
  if (m.homePlayerId && m.awayPlayerId) return { kind: "PLAYER", home: entityKey("PLAYER", m.homePlayerId), away: entityKey("PLAYER", m.awayPlayerId) };
  return null;
}

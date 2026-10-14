import { prisma } from "../db";
import { excludedSources } from "../model/service";
import type { EntityKind } from "./keys";
import { entityKey, pairKeys } from "./keys";

/** All finished meetings between two entities, newest first (any provider). */
export async function loadMeetings(sportId: string, kind: EntityKind, a: string, b: string, limit = 50) {
  const [fa, fb] = kind === "TEAM" ? (["homeTeamId", "awayTeamId"] as const) : (["homePlayerId", "awayPlayerId"] as const);
  return prisma.match.findMany({
    where: {
      sportId,
      status: "FINISHED",
      primarySource: { notIn: excludedSources() },
      OR: [
        { [fa]: a, [fb]: b },
        { [fa]: b, [fb]: a },
      ],
    },
    include: { league: true },
    orderBy: { startsAt: "desc" },
    take: limit,
  });
}

/** Recompute the cached H2H summary for a pair from stored matches and mark it fresh. */
export async function storeH2H(sportId: string, kind: EntityKind, a: string, b: string, source: string) {
  const meetings = await loadMeetings(sportId, kind, a, b, 200);
  const { keyLow, keyHigh } = pairKeys(entityKey(kind, a), entityKey(kind, b));
  const lowId = keyLow.slice(2);
  let lowWins = 0;
  let highWins = 0;
  let draws = 0;
  for (const m of meetings) {
    if (!m.winner) continue;
    if (m.winner === "DRAW") {
      draws++;
      continue;
    }
    const winnerId = m.winner === "HOME" ? (kind === "TEAM" ? m.homeTeamId : m.homePlayerId) : kind === "TEAM" ? m.awayTeamId : m.awayPlayerId;
    if (winnerId === lowId) lowWins++;
    else highWins++;
  }
  const data = { meetings: meetings.length, lowWins, highWins, draws, lastMeetingAt: meetings[0]?.startsAt ?? null, source, stale: false, fetchedAt: new Date() };
  return prisma.h2HRecord.upsert({
    where: { sportId_keyLow_keyHigh: { sportId, keyLow, keyHigh } },
    create: { sportId, entityType: kind, keyLow, keyHigh, ...data },
    update: data,
  });
}

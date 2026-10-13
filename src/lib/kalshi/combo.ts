import type { Side } from "@prisma/client";
import { COMBO } from "../../../config/admin";
import { prisma } from "../db";
import { getEnv } from "../env";
import { createCombo, legsKey } from "../providers/kalshi";

export interface KalshiComboRequestLeg {
  matchId: string;
  pick: Side;
}

export interface KalshiComboResult {
  ok: true;
  marketTicker: string;
  eventTicker: string;
  yesAsk: number | null;
  /** True when this exact set of legs had already been created (Kalshi creation is capped per week). */
  reused: boolean;
}

export interface KalshiComboError {
  ok: false;
  status: number;
  message: string;
}

/**
 * Create (or reuse) the Kalshi combo market for a set of legs. Every leg must have a stored Kalshi market for its
 * pick and must not have started; the same set of legs is only ever created once.
 */
export async function createKalshiCombo(legs: KalshiComboRequestLeg[], now = new Date()): Promise<KalshiComboResult | KalshiComboError> {
  if (legs.length < COMBO.MIN_SIZE || legs.length > COMBO.MAX_SIZE) return { ok: false, status: 400, message: `A combo needs ${COMBO.MIN_SIZE}–${COMBO.MAX_SIZE} legs.` };
  if (new Set(legs.map((l) => l.matchId)).size !== legs.length) return { ok: false, status: 400, message: "Only one leg per match." };

  const rows = await prisma.kalshiMarket.findMany({
    where: { OR: legs.map((l) => ({ matchId: l.matchId, side: l.pick })) },
    include: { match: { select: { startsAt: true, status: true, homeName: true, awayName: true } } },
  });
  const missing = legs.filter((l) => !rows.some((r) => r.matchId === l.matchId && r.side === l.pick));
  if (missing.length) return { ok: false, status: 409, message: `${missing.length} leg${missing.length === 1 ? " is" : "s are"} not listed on Kalshi.` };
  const started = rows.filter((r) => r.match.status !== "SCHEDULED" || r.match.startsAt <= now);
  if (started.length) return { ok: false, status: 409, message: `${started.map((r) => `${r.match.homeName} vs ${r.match.awayName}`).join(", ")} already started.` };

  const input = rows.map((r) => ({ eventTicker: r.eventTicker, marketTicker: r.marketTicker }));
  const key = legsKey(input);
  const existing = await prisma.kalshiCombo.findUnique({ where: { legsKey: key } });
  if (existing) return { ok: true, marketTicker: existing.marketTicker, eventTicker: existing.eventTicker, yesAsk: existing.yesAsk, reused: true };

  const collection = getEnv().KALSHI_COLLECTION;
  const created = await createCombo(input, collection);
  await prisma.kalshiCombo.upsert({
    where: { legsKey: key },
    create: { legsKey: key, collectionTicker: collection, eventTicker: created.eventTicker, marketTicker: created.marketTicker, legTickers: input.map((l) => l.marketTicker).sort(), yesAsk: created.yesAsk },
    update: {},
  });
  return { ok: true, ...created, reused: false };
}

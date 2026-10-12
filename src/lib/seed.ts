import { prisma } from "./db";
import { SPORTS } from "./sports";

/** Reference rows for the supported sports (static configuration, not data). Idempotent. */
export async function ensureSports(): Promise<void> {
  for (const s of Object.values(SPORTS)) {
    await prisma.sport.upsert({ where: { id: s.id }, create: { id: s.id, name: s.name, hasDraw: s.hasDraw }, update: { name: s.name, hasDraw: s.hasDraw } });
  }
}

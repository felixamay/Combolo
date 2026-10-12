import type { Prisma } from "@prisma/client";
import { prisma } from "../db";
import type { QuotaState, QuotaStore, QuotaTx, WindowType } from "./manager";

/**
 * Postgres-backed store. A transaction-scoped advisory lock per provider key makes
 * read-check-increment atomic across processes (Vercel cron lambdas, worker, setup script).
 */
export class PrismaQuotaStore implements QuotaStore {
  async withLock<T>(key: string, fn: (tx: QuotaTx) => Promise<T>): Promise<T> {
    return prisma.$transaction(
      async (client: Prisma.TransactionClient) => {
        await client.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
        const tx: QuotaTx = {
          async get(window: WindowType): Promise<QuotaState | null> {
            const row = await client.providerQuota.findUnique({ where: { providerKey_windowType: { providerKey: key, windowType: window } } });
            if (!row) return null;
            return {
              windowStart: row.windowStart,
              used: row.used,
              limit: row.limit,
              stamps: Array.isArray(row.stamps) ? (row.stamps as number[]) : [],
              reportedRemaining: row.reportedRemaining,
            };
          },
          async set(window: WindowType, s: QuotaState) {
            const data = {
              windowStart: s.windowStart,
              used: s.used,
              limit: s.limit,
              reportedRemaining: s.reportedRemaining,
              stamps: s.stamps as unknown as Prisma.InputJsonValue,
            };
            await client.providerQuota.upsert({
              where: { providerKey_windowType: { providerKey: key, windowType: window } },
              create: { providerKey: key, windowType: window, ...data },
              update: data,
            });
          },
        };
        return fn(tx);
      },
      { timeout: 15000, maxWait: 15000 },
    );
  }
}

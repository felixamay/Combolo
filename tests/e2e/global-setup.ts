import { prisma } from "../../src/lib/db";
import { seedTestData } from "../support/seed";

/** Seeds the *_test database with deterministic fixtures and runs the real pipeline over them. */
export default async function globalSetup() {
  const summary = await seedTestData();
  console.log(`[e2e] seeded test database: ${JSON.stringify(summary.upcoming)}, eligible ${summary.eligible}`);
  await prisma.$disconnect();
}

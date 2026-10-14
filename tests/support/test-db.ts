/**
 * Test database wiring. Integration/e2e tests ONLY ever touch a database whose name ends in `_test`.
 * Set TEST_DATABASE_URL, or it is derived from DATABASE_URL by appending `_test` to the database name.
 */
import { existsSync } from "node:fs";

for (const f of [".env.local", ".env"]) if (existsSync(f)) process.loadEnvFile(f);

function derive(): string {
  const explicit = process.env.TEST_DATABASE_URL;
  if (explicit) return explicit;
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error("Set TEST_DATABASE_URL (or DATABASE_URL) to run database tests");
  const u = new URL(base);
  if (!u.pathname.endsWith("_test")) u.pathname = `${u.pathname}_test`;
  return u.toString();
}

export const TEST_DATABASE_URL = derive();
if (!new URL(TEST_DATABASE_URL).pathname.endsWith("_test")) throw new Error("Refusing to use a database that does not end in _test");
process.env.DATABASE_URL = TEST_DATABASE_URL;

import "./load-env";
import cron from "node-cron";
import { SCHEDULE } from "../config/schedule";
import { runJob } from "../src/jobs";
import { prisma } from "../src/lib/db";
import { log } from "../src/lib/log";

/**
 * Long-running scheduler for self-hosted deployments (VPS, Fly, Railway, Docker).
 * On start it runs `refresh` once if no refresh has ever completed or the last one is older than 7 hours.
 */
async function main() {
  for (const s of SCHEDULE) {
    cron.schedule(
      s.cron,
      () => {
        runJob(s.job).catch((e) => log.error(`scheduled ${s.job} crashed`, e));
      },
      { timezone: "UTC" },
    );
    log.info(`scheduled ${s.job} (${s.cron} UTC) – ${s.description}`);
  }

  const last = await prisma.jobRun.findFirst({ where: { name: "refresh", status: { in: ["ok", "partial"] } }, orderBy: { startedAt: "desc" } });
  if (!last || Date.now() - last.startedAt.getTime() > 7 * 3600_000) {
    log.info("no recent refresh found – running one now");
    runJob("refresh").catch((e) => log.error("startup refresh crashed", e));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

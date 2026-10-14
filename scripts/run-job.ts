import "./load-env";
import { JOB_NAMES, runJob } from "../src/jobs";
import { prisma } from "../src/lib/db";

async function main() {
  const name = process.argv[2];
  if (!name || !JOB_NAMES.includes(name)) {
    console.error(`Usage: npm run job -- <name>\nJobs: ${JOB_NAMES.join(", ")}`);
    process.exit(2);
  }
  const res = await runJob(name);
  console.log(JSON.stringify(res, null, 2));
  await prisma.$disconnect();
  process.exit(res.status === "failed" ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

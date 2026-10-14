import "./load-env";
import { execSync } from "node:child_process";
import { runJob } from "../src/jobs";
import { prisma } from "../src/lib/db";
import { getEnv } from "../src/lib/env";
import { getComboWindow } from "../src/lib/time";

function keyStatus() {
  const env = getEnv();
  const rows: Array<[string, boolean, string]> = [
    ["football-data.org", !!env.FOOTBALL_DATA_KEY, "FOOTBALL_DATA_KEY"],
    ["API-Sports", !!env.APISPORTS_KEY, "APISPORTS_KEY"],
    ["Highlightly", !!env.HIGHLIGHTLY_KEY, "HIGHLIGHTLY_KEY"],
    ["API-Tennis", !!env.API_TENNIS_KEY, "API_TENNIS_KEY"],
    ["Live Tennis API", !!env.LIVE_TENNIS_API_KEY, "LIVE_TENNIS_API_KEY"],
    ["The Odds API (optional)", env.FEATURE_ODDS && !!env.ODDS_API_KEY, "FEATURE_ODDS=true + ODDS_API_KEY"],
  ];
  console.log("\nProvider keys:");
  for (const [name, ok, v] of rows) console.log(`  ${ok ? "ok     " : "missing"}  ${name}${ok ? "" : `  (set ${v})`}`);
  console.log(`  ok       TheSportsDB (free key "${env.THESPORTSDB_KEY}")`);
  console.log(`  ${env.TENNIS_COMMERCIAL_MODE ? "off    " : "on     "}  Sackmann CSVs (non-commercial licence; TENNIS_COMMERCIAL_MODE=${env.TENNIS_COMMERCIAL_MODE})`);
  const configured = rows.filter((r) => r[1]).length;
  if (configured === 0) console.log("\n  No paid/keyed provider is configured: only TheSportsDB schedules (no standings/H2H) will load, so few or no combos can be generated.");
}

async function main() {
  const env = getEnv();
  console.log("1/3 Applying database migrations...");
  execSync("npx prisma migrate deploy", { stdio: "inherit" });
  execSync("npx prisma generate", { stdio: "inherit" });

  console.log("2/3 Checking provider configuration...");
  keyStatus();

  console.log("\n3/3 Bootstrapping data (history, fixtures, standings, H2H, model, odds, combos)...");
  const res = await runJob("bootstrap");
  console.log(JSON.stringify(res.summary, null, 2));
  if (res.errors.length) console.log(`\n${res.errors.length} non-fatal issue(s):\n  - ${res.errors.slice(0, 20).join("\n  - ")}`);

  const now = new Date();
  const window = getComboWindow(now, env.DEFAULT_TIMEZONE);
  const [matches, predictions, combos] = await Promise.all([
    prisma.match.count({ where: { status: "SCHEDULED", startsAt: { gt: now, lt: window.end } } }),
    prisma.prediction.count({ where: { eligible: true, match: { status: "SCHEDULED", startsAt: { gt: now, lt: window.end } } } }),
    prisma.combo.count({ where: { status: "ACTIVE" } }),
  ]);
  console.log(`\nResult: ${matches} upcoming matches in the 3-day window (${env.DEFAULT_TIMEZONE}), ${predictions} with an eligible prediction, ${combos} active combos.`);
  console.log("Start the site with `npm run dev` and the scheduler with `npm run worker` (or deploy with Vercel Cron, see README).");
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

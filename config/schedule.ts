/**
 * Single source of truth for job schedules (UTC cron expressions).
 * Used by scripts/worker.ts (node-cron). vercel.json mirrors these entries for Vercel Cron.
 */
export const SCHEDULE: Array<{ job: string; cron: string; description: string }> = [
  { job: "refresh", cron: "0 */6 * * *", description: "Full pipeline 4x/day: fixtures, standings, H2H, form, model, odds, Kalshi links, combos" },
  { job: "results", cron: "20 * * * *", description: "Hourly cheap results sync (football-data + API-Tennis), lock started combos, settle legs, refresh Kalshi prices" },
  { job: "tennis-backfill", cron: "30 3 * * *", description: "Daily API-Tennis results backfill (resumable)" },
  { job: "tennis-history", cron: "0 4 * * 0", description: "Weekly Sackmann CSV refresh (skipped in commercial mode)" },
  { job: "backtest", cron: "0 5 * * 1", description: "Weekly walk-forward back-test of the model" },
  { job: "cleanup", cron: "45 4 * * *", description: "Prune old API logs, job runs and superseded combos" },
];

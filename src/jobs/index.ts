import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/db";
import { generateStoredCombos, settleCombos, expireStarted } from "../lib/combos/service";
import { log } from "../lib/log";
import { ensureSports } from "../lib/seed";
import { refreshFixtures } from "./fixtures";
import { refreshForm } from "./form";
import { refreshH2H } from "./h2h";
import { type JobContext, type JobResult } from "./helpers";
import { refreshOdds } from "./odds";
import { backtestJob, refreshModel } from "./ratings";
import { refreshStandings } from "./standings";
import { backfillApiTennis, loadSackmannHistory } from "./tennis";

type JobFn = (ctx: JobContext) => Promise<JobResult>;

async function combosJob(ctx: JobContext): Promise<JobResult> {
  const stats = await generateStoredCombos(ctx.now);
  return { summary: { ...stats }, errors: [] };
}

async function resultsJob(ctx: JobContext): Promise<JobResult> {
  const res = await refreshFixtures(ctx, { daysBack: 2, resultsOnly: true });
  const locked = await expireStarted(ctx.now);
  const settled = await settleCombos(ctx.now);
  return { summary: { ...res.summary, newlyLocked: locked, ...settled }, errors: res.errors };
}

async function cleanupJob(ctx: JobContext): Promise<JobResult> {
  const day = 86400_000;
  const calls = await prisma.apiCallLog.deleteMany({ where: { calledAt: { lt: new Date(ctx.now.getTime() - 30 * day) } } });
  const runs = await prisma.jobRun.deleteMany({ where: { startedAt: { lt: new Date(ctx.now.getTime() - 30 * day) } } });
  const combos = await prisma.combo.deleteMany({ where: { status: "SUPERSEDED", generatedAt: { lt: new Date(ctx.now.getTime() - 7 * day) } } });
  return { summary: { apiCallLogs: calls.count, jobRuns: runs.count, supersededCombos: combos.count }, errors: [] };
}

/** Composite jobs run their steps in order; a failing step never prevents the next one (combos are always rebuilt). */
async function runSteps(ctx: JobContext, steps: Array<[string, JobFn]>): Promise<JobResult> {
  const summary: Record<string, unknown> = {};
  const errors: string[] = [];
  for (const [name, fn] of steps) {
    const t0 = Date.now();
    try {
      const r = await fn(ctx);
      summary[name] = { ...r.summary, ms: Date.now() - t0 };
      for (const e of r.errors) errors.push(`${name}: ${e}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      summary[name] = { failed: msg, ms: Date.now() - t0 };
      errors.push(`${name}: ${msg}`);
      log.error(`step ${name} failed: ${msg}`);
    }
  }
  return { summary, errors };
}

const refreshSteps: Array<[string, JobFn]> = [
  ["fixtures", (c) => refreshFixtures(c, { daysBack: 1 })],
  ["standings", refreshStandings],
  ["h2h", refreshH2H],
  ["form", refreshForm],
  ["model", refreshModel],
  ["odds", refreshOdds],
  ["combos", combosJob],
];

export const JOBS: Record<string, JobFn> = {
  fixtures: (c) => refreshFixtures(c, { daysBack: 1 }),
  standings: refreshStandings,
  h2h: refreshH2H,
  form: refreshForm,
  model: refreshModel,
  odds: refreshOdds,
  combos: combosJob,
  results: resultsJob,
  backtest: backtestJob,
  "tennis-history": loadSackmannHistory,
  "tennis-backfill": backfillApiTennis,
  cleanup: cleanupJob,
  /** Full pipeline: fixtures -> standings -> H2H -> form -> model -> odds -> combos. Scheduled 4x/day. */
  refresh: (c) => runSteps(c, refreshSteps),
  /** First-run population: history first so the model has data, then the normal pipeline, with raised budgets. */
  bootstrap: (c) =>
    runSteps({ ...c, bootstrap: true }, [
      ["tennis-history", loadSackmannHistory],
      ["tennis-backfill", backfillApiTennis],
      ["fixtures", (x) => refreshFixtures(x, { daysBack: 3 })],
      ...refreshSteps.slice(1),
      ["backtest", backtestJob],
    ]),
};

export const JOB_NAMES = Object.keys(JOBS);

const STALE_AFTER_MS = 30 * 60_000;

export interface RunOutcome {
  name: string;
  status: "ok" | "partial" | "failed" | "skipped";
  summary?: Record<string, unknown>;
  errors: string[];
  jobRunId?: string;
}

/** Run a named job, recording a JobRun row. Overlapping runs of the same job are refused (cron overlap protection). */
export async function runJob(name: string, opts: { deadline?: number; now?: Date } = {}): Promise<RunOutcome> {
  const fn = JOBS[name];
  if (!fn) throw new Error(`Unknown job "${name}". Known jobs: ${JOB_NAMES.join(", ")}`);

  const running = await prisma.jobRun.findFirst({ where: { name, status: "running", startedAt: { gt: new Date(Date.now() - STALE_AFTER_MS) } } });
  if (running) {
    log.warn(`job ${name} already running since ${running.startedAt.toISOString()} – skipping`);
    return { name, status: "skipped", errors: ["already running"] };
  }

  await ensureSports();
  const run = await prisma.jobRun.create({ data: { name } });
  log.info(`job ${name} started`);
  try {
    const res = await fn({ now: opts.now ?? new Date(), deadline: opts.deadline });
    const status = res.errors.length ? "partial" : "ok";
    await prisma.jobRun.update({
      where: { id: run.id },
      data: { status, finishedAt: new Date(), summary: res.summary as Prisma.InputJsonValue, error: res.errors.length ? res.errors.slice(0, 50).join("\n") : null },
    });
    log.info(`job ${name} ${status}`, res.summary);
    return { name, status, summary: res.summary, errors: res.errors, jobRunId: run.id };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await prisma.jobRun.update({ where: { id: run.id }, data: { status: "failed", finishedAt: new Date(), error: msg } });
    log.error(`job ${name} failed: ${msg}`);
    return { name, status: "failed", errors: [msg], jobRunId: run.id };
  }
}

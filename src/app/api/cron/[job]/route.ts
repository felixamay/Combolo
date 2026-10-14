import { NextResponse } from "next/server";
import { JOB_NAMES, runJob } from "@/jobs";
import { getEnv } from "@/lib/env";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Vercel Cron / external scheduler entry point. Requires `Authorization: Bearer $CRON_SECRET`
 * (Vercel adds this header automatically when the CRON_SECRET env var is set).
 */
export async function GET(req: Request, ctx: { params: Promise<{ job: string }> }) {
  const secret = getEnv().CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 503 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { job } = await ctx.params;
  if (!JOB_NAMES.includes(job)) return NextResponse.json({ error: `unknown job ${job}`, jobs: JOB_NAMES }, { status: 404 });

  const res = await runJob(job, { deadline: Date.now() + (maxDuration - 20) * 1000 });
  return NextResponse.json(res, { status: res.status === "failed" ? 500 : 200 });
}

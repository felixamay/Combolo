import { NextResponse } from "next/server";
import { z } from "zod";
import { createKalshiCombo } from "@/lib/kalshi/combo";
import { log } from "@/lib/log";
import { QuotaDeniedError, ProviderHttpError } from "@/lib/providers/http";
import { kalshiCanCreate } from "@/lib/providers/kalshi";

export const dynamic = "force-dynamic";

const body = z.object({ legs: z.array(z.object({ matchId: z.string().min(1), pick: z.enum(["HOME", "DRAW", "AWAY"]) })).min(1).max(64) });

/** Create the Kalshi combo market for a set of legs with the operator's API key. Users then trade it on Kalshi themselves. */
export async function POST(req: Request) {
  if (!kalshiCanCreate()) return NextResponse.json({ error: "Creating combos on Kalshi is not configured on this site." }, { status: 503 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  try {
    const res = await createKalshiCombo(parsed.data.legs);
    if (!res.ok) return NextResponse.json({ error: res.message }, { status: res.status });
    return NextResponse.json(res);
  } catch (e) {
    if (e instanceof QuotaDeniedError) return NextResponse.json({ error: "Kalshi combo creation limit reached for today. Copy the legs and build the combo on Kalshi instead." }, { status: 429 });
    if (e instanceof ProviderHttpError) {
      log.warn(`kalshi create failed: ${e.message}`);
      return NextResponse.json({ error: `Kalshi rejected the combo (HTTP ${e.status}). ${kalshiReason(e.body)}`.trim() }, { status: 502 });
    }
    log.error("kalshi create failed", e);
    return NextResponse.json({ error: "Could not reach Kalshi." }, { status: 502 });
  }
}

function kalshiReason(body?: string): string {
  try {
    const j = JSON.parse(body ?? "") as { error?: { message?: string; details?: string } };
    return [j.error?.message, j.error?.details].filter(Boolean).join(": ");
  } catch {
    return "";
  }
}

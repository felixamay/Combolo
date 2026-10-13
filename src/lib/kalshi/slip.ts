import type { KalshiSlipLeg } from "@/components/KalshiSlip";
import type { Candidate } from "../combos/engine";
import { authEnabled } from "../auth/firebase-admin";
import { currentUser } from "../auth/session";

/** Slip rows for legs that all carry a Kalshi market (call only for Kalshi-only combos). */
export function kalshiSlipLegs(legs: Array<Pick<Candidate, "matchId" | "pick" | "homeName" | "awayName" | "kalshi">>): KalshiSlipLeg[] {
  return legs.flatMap((l) => (l.kalshi ? [{ matchId: l.matchId, pick: l.pick, matchLabel: `${l.homeName} vs ${l.awayName}`, ...l.kalshi }] : []));
}

/** Login link (returning to `path`) when creating on Kalshi needs a signed-in user who is not signed in yet. */
export async function kalshiSignInHref(path: string): Promise<string | undefined> {
  if (!authEnabled() || (await currentUser())) return undefined;
  return `/login?next=${encodeURIComponent(path)}`;
}

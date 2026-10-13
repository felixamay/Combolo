import type { KalshiSlipLeg } from "@/components/KalshiSlip";
import type { Candidate } from "../combos/engine";

/** Slip rows for legs that all carry a Kalshi market (call only for Kalshi-only combos). */
export function kalshiSlipLegs(legs: Array<Pick<Candidate, "matchId" | "pick" | "homeName" | "awayName" | "kalshi">>): KalshiSlipLeg[] {
  return legs.flatMap((l) => (l.kalshi ? [{ matchId: l.matchId, pick: l.pick, matchLabel: `${l.homeName} vs ${l.awayName}`, ...l.kalshi }] : []));
}

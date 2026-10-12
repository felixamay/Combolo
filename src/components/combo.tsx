import Link from "next/link";
import { COMBO } from "@config/admin";
import { SPORTS, type SportId } from "@/lib/sports";
import { dayIndexOf, getComboWindow, type ComboWindow } from "@/lib/time";
import type { ComboListItem } from "@/lib/queries";
import { CombinedProb, KickOff, ProbBar, SportBadge, StatusChip, pickLabel } from "./ui";

export interface LegView {
  matchId: string;
  sport: string;
  leagueName: string;
  startsAt: Date;
  homeName: string;
  awayName: string;
  pick: string;
  prob: number;
  odds?: number | null;
  result?: string;
}

export function LegsTable({ legs, tz, window }: { legs: LegView[]; tz: string; window?: ComboWindow }) {
  const win = window ?? getComboWindow(new Date(), tz);
  return (
    <div className="card overflow-x-auto">
      <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-800" data-testid="legs-table">
        <thead>
          <tr>
            <th className="th">#</th>
            <th className="th">Sport / league</th>
            <th className="th">Match</th>
            <th className="th">Kick-off ({tz.split("/").pop()?.replace(/_/g, " ")})</th>
            <th className="th">Pick</th>
            <th className="th">Probability</th>
            <th className="th">Odds</th>
            <th className="th">Result</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {legs.map((l, i) => {
            const day = dayIndexOf(l.startsAt, win);
            return (
              <tr key={l.matchId} data-testid="leg-row">
                <td className="td tabular-nums muted">{i + 1}</td>
                <td className="td">
                  <div className="flex flex-col gap-1">
                    <SportBadge sport={l.sport} />
                    <span className="text-xs muted">{l.leagueName}</span>
                  </div>
                </td>
                <td className="td">
                  <Link href={`/matches/${l.matchId}`} className="font-medium hover:underline">
                    {l.homeName} <span className="muted">vs</span> {l.awayName}
                  </Link>
                </td>
                <td className="td whitespace-nowrap">
                  <KickOff at={l.startsAt} tz={tz} />
                  {day ? <span className="ml-1 text-xs muted">(day {day})</span> : null}
                </td>
                <td className="td font-semibold">
                  {pickLabel(l.pick, l.homeName, l.awayName)}
                  {SPORTS[l.sport as SportId]?.hasDraw && l.pick !== "DRAW" ? <span className="ml-1 text-xs font-normal muted">to win</span> : null}
                </td>
                <td className="td">
                  <ProbBar p={l.prob} />
                </td>
                <td className="td tabular-nums">{l.odds ? l.odds.toFixed(2) : <span className="muted">–</span>}</td>
                <td className="td">
                  <StatusChip status={l.result ?? "PENDING"} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function ComboCard({ combo }: { combo: ComboListItem }) {
  const sportLabel = combo.sportId ? SPORTS[combo.sportId as SportId]?.name : "Mixed sports";
  const settled = combo.legs.filter((l) => l.result !== "PENDING").length;
  return (
    <Link href={`/combos/${combo.id}`} className="card block p-4 transition hover:border-brand-500" data-testid="combo-card">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold">
            {combo.size}-leg {combo.strategy === "TOP" ? "top-probability" : "diversified"}
          </div>
          <div className="text-xs muted">{sportLabel}</div>
        </div>
        <StatusChip status={combo.status} />
      </div>
      <div className="mt-3">
        <CombinedProb p={combo.combinedProb} odds={combo.combinedOdds} priced={combo.legsPriced} size={combo.size} />
      </div>
      <div className="mt-3 flex flex-wrap gap-x-3 text-xs muted">
        <span>Weakest leg {(combo.minLegProb * 100).toFixed(0)}%</span>
        {settled > 0 ? (
          <span>
            {settled}/{combo.size} settled
          </span>
        ) : null}
      </div>
    </Link>
  );
}

export function ComboGrid({ combos, emptyHint }: { combos: ComboListItem[]; emptyHint: string }) {
  if (combos.length === 0) {
    return (
      <div className="card p-5 text-sm" role="status" data-testid="no-combos">
        {emptyHint}
      </div>
    );
  }
  const sizes = COMBO.SIZES.filter((s) => combos.some((c) => c.requestedSize === s));
  return (
    <div className="space-y-6">
      {sizes.map((size) => (
        <section key={size}>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide muted">{size} legs</h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {combos
              .filter((c) => c.requestedSize === size)
              .map((c) => (
                <ComboCard key={c.id} combo={c} />
              ))}
          </div>
        </section>
      ))}
    </div>
  );
}

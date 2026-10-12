import Link from "next/link";
import { Empty, PageTitle, StatusChip } from "@/components/ui";
import { historyStats } from "@/lib/combos/service";
import { comboHistory } from "@/lib/queries";
import { getTz, single } from "@/lib/request";
import { SPORTS, type SportId } from "@/lib/sports";
import { formatInTz } from "@/lib/time";
import { probabilityLabel } from "@/lib/combos/engine";

export const dynamic = "force-dynamic";
export const metadata = { title: "Combo history & hit rate" };

const pct = (v: number | null, d = 1) => (v == null ? "–" : `${(v * 100).toFixed(d)}%`);

export default async function HistoryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const status = single(sp.status);
  const size = single(sp.size) ? Number(single(sp.size)) : undefined;
  const tz = await getTz();
  const [stats, combos] = await Promise.all([historyStats(), comboHistory({ status: status && status !== "ALL" ? status : undefined, size })]);

  return (
    <div className="space-y-6">
      <PageTitle title="Combo history" subtitle="Every combo that reached kick-off is kept and settled from real results. Combos replaced by a newer version before kick-off are not counted." />

      <section aria-labelledby="hit-h" className="space-y-2">
        <h2 id="hit-h" className="text-lg font-semibold">
          Hit rate by combo size
        </h2>
        {stats.bySize.length === 0 ? (
          <Empty>No combo has reached kick-off yet, so there is nothing to measure. Hit rates will appear here as results arrive.</Empty>
        ) : (
          <div className="card overflow-x-auto">
            <table className="min-w-full" data-testid="hit-rate-table">
              <thead>
                <tr>
                  <th className="th">Legs</th>
                  <th className="th text-right">Played</th>
                  <th className="th text-right">Won</th>
                  <th className="th text-right">Lost</th>
                  <th className="th text-right">Awaiting</th>
                  <th className="th text-right">Void</th>
                  <th className="th text-right">Hit rate</th>
                  <th className="th text-right">Avg. predicted</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {stats.bySize.map((s) => (
                  <tr key={s.size}>
                    <td className="td font-semibold">{s.size}</td>
                    <td className="td text-right tabular-nums">{s.played}</td>
                    <td className="td text-right tabular-nums">{s.won}</td>
                    <td className="td text-right tabular-nums">{s.lost}</td>
                    <td className="td text-right tabular-nums">{s.pending}</td>
                    <td className="td text-right tabular-nums">{s.voided}</td>
                    <td className="td text-right tabular-nums font-semibold">{pct(s.hitRate)}</td>
                    <td className="td text-right tabular-nums">{s.avgPredictedProb != null ? probabilityLabel(s.avgPredictedProb) : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-sm muted" data-testid="leg-stats">
          Individual legs: {stats.legs.settled} settled, {stats.legs.won} won ({pct(stats.legs.hitRate)}); average predicted probability {pct(stats.legs.avgPredictedProb)}. Small samples are noisy – a combo size with only a few settled entries says little.
        </p>
      </section>

      <section aria-labelledby="list-h" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="list-h" className="text-lg font-semibold">
            Combos
          </h2>
          <div className="flex flex-wrap gap-1.5 text-sm">
            {["ALL", "LOCKED", "WON", "LOST", "VOID", "ACTIVE", "SUPERSEDED"].map((s) => (
              <Link key={s} href={s === "ALL" ? "/history" : `/history?status=${s}`} className={`chip ${((status ?? "ALL") === s) ? "border-brand-600 bg-brand-50 text-brand-700 dark:bg-brand-700/30 dark:text-brand-100" : "border-slate-300 dark:border-slate-700"}`}>
                {s === "ALL" ? "Played" : s.charAt(0) + s.slice(1).toLowerCase()}
              </Link>
            ))}
          </div>
        </div>
        {combos.length === 0 ? (
          <Empty>No combos match this filter.</Empty>
        ) : (
          <div className="card overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr>
                  <th className="th">First kick-off</th>
                  <th className="th">Type</th>
                  <th className="th text-right">Legs</th>
                  <th className="th text-right">Combined prob.</th>
                  <th className="th text-right">Won / lost / open</th>
                  <th className="th">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {combos.map((c) => (
                  <tr key={c.id} data-testid="history-row">
                    <td className="td whitespace-nowrap">
                      <Link href={`/combos/${c.id}`} className="underline">
                        {formatInTz(c.firstLegStartsAt, tz)}
                      </Link>
                    </td>
                    <td className="td">
                      {c.sportId ? SPORTS[c.sportId as SportId]?.name : "Mixed"} · {c.strategy === "TOP" ? "top" : "diversified"}
                    </td>
                    <td className="td text-right tabular-nums">{c.size}</td>
                    <td className="td text-right tabular-nums">{probabilityLabel(c.combinedProb)}</td>
                    <td className="td text-right tabular-nums">
                      {c.legs.filter((l) => l.result === "WON").length} / {c.legs.filter((l) => l.result === "LOST").length} / {c.legs.filter((l) => l.result === "PENDING").length}
                    </td>
                    <td className="td">
                      <StatusChip status={c.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

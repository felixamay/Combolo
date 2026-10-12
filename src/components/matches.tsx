import Link from "next/link";
import { dayIndexOf, type ComboWindow } from "@/lib/time";
import type { WindowMatch } from "@/lib/queries";
import { KickOff, ProbBar, SportBadge, pickLabel } from "./ui";

export function MatchTable({ matches, tz, window, showSport = false }: { matches: WindowMatch[]; tz: string; window: ComboWindow; showSport?: boolean }) {
  const byDay = new Map<number, WindowMatch[]>();
  for (const m of matches) {
    const d = dayIndexOf(m.startsAt, window) ?? 3;
    byDay.set(d, [...(byDay.get(d) ?? []), m]);
  }
  return (
    <div className="space-y-6">
      {window.days.map((d) => {
        const rows = byDay.get(d.day) ?? [];
        const byLeague = new Map<string, { name: string; priority: number; matches: WindowMatch[] }>();
        for (const m of rows) {
          const e = byLeague.get(m.leagueId) ?? { name: m.league.name, priority: m.league.priority, matches: [] };
          e.matches.push(m);
          byLeague.set(m.leagueId, e);
        }
        const leagues = [...byLeague.values()].sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name));
        return (
          <section key={d.day} aria-labelledby={`day-${d.day}`}>
            <h2 id={`day-${d.day}`} className="mb-2 text-lg font-semibold">
              Day {d.day} <span className="text-sm font-normal muted">· {new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long", month: "short", day: "numeric" }).format(d.start)} · {rows.length} match{rows.length === 1 ? "" : "es"}</span>
            </h2>
            {rows.length === 0 ? (
              <p className="text-sm muted">No matches stored for this day.</p>
            ) : (
              <div className="space-y-3">
                {leagues.map((l) => (
                  <div key={l.name} className="card overflow-x-auto">
                    <div className="border-b border-slate-100 px-3 py-2 text-sm font-semibold dark:border-slate-800">{l.name}</div>
                    <table className="min-w-full">
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {l.matches.map((m) => (
                          <tr key={m.id} data-testid="match-row">
                            <td className="td whitespace-nowrap muted">
                              <KickOff at={m.startsAt} tz={tz} />
                            </td>
                            {showSport ? (
                              <td className="td">
                                <SportBadge sport={m.sportId} short />
                              </td>
                            ) : null}
                            <td className="td">
                              <Link href={`/matches/${m.id}`} className="font-medium hover:underline">
                                {m.homeName} <span className="muted">vs</span> {m.awayName}
                              </Link>
                            </td>
                            <td className="td">
                              {m.prediction?.eligible && m.prediction.pick && m.prediction.pickProb != null ? (
                                <div className="flex items-center gap-3">
                                  <span className="text-sm font-semibold">{pickLabel(m.prediction.pick, m.homeName, m.awayName)}</span>
                                  <ProbBar p={m.prediction.pickProb} />
                                </div>
                              ) : (
                                <span className="text-xs muted">No pick – {m.prediction?.reason ?? "not yet analysed"}</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

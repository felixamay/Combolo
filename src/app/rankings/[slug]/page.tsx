import { notFound } from "next/navigation";
import { Empty, FormPills, PageTitle } from "@/components/ui";
import { standingsFor } from "@/lib/queries";
import { sportBySlug } from "@/lib/sports";
import { timeAgo } from "@/lib/time";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const s = sportBySlug((await params).slug);
  return { title: s ? `${s.name} ${s.individual ? "rankings" : "standings"}` : "Rankings" };
}

export default async function RankingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const sport = sportBySlug((await params).slug);
  if (!sport) notFound();
  const tables = await standingsFor(sport.id);

  return (
    <div className="space-y-6">
      <PageTitle title={`${sport.icon} ${sport.name} ${sport.individual ? "rankings" : "standings"}`} subtitle={`${tables.length} table${tables.length === 1 ? "" : "s"} stored.`} />
      {tables.length === 0 ? (
        <Empty>
          No {sport.individual ? "rankings" : "standings"} stored for {sport.name} yet. They are fetched by the scheduled refresh job within each provider&apos;s free-tier budget; leagues with the highest priority come first.
        </Empty>
      ) : null}
      {tables.length > 1 ? (
        <nav aria-label="Tables" className="flex flex-wrap gap-2 text-sm">
          {tables.map((t) => (
            <a key={t.scopeKey} href={`#t-${t.scopeKey.replace(/[^a-z0-9]/gi, "-")}`} className="chip border-slate-300 dark:border-slate-700">
              {t.title}
            </a>
          ))}
        </nav>
      ) : null}
      {tables.map((t) => (
        <section key={t.scopeKey} id={`t-${t.scopeKey.replace(/[^a-z0-9]/gi, "-")}`} className="card overflow-x-auto" data-testid="standings-table">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 px-3 py-2 dark:border-slate-800">
            <h2 className="font-semibold">
              {t.title}
              {t.country ? <span className="ml-2 text-xs font-normal muted">{t.country}</span> : null}
            </h2>
            <span className="text-xs muted">
              {t.season ? `Season ${t.season} · ` : ""}source {t.source} · updated {timeAgo(t.capturedAt)}
            </span>
          </div>
          <table className="min-w-full">
            <thead>
              <tr>
                <th className="th">#</th>
                <th className="th">{sport.individual ? "Player" : "Team"}</th>
                {!sport.individual ? (
                  <>
                    <th className="th text-right">P</th>
                    <th className="th text-right">W</th>
                    {sport.hasDraw ? <th className="th text-right">D</th> : null}
                    <th className="th text-right">L</th>
                    <th className="th text-right">For–Ag</th>
                  </>
                ) : null}
                <th className="th text-right">Pts</th>
                {!sport.individual ? <th className="th">Form</th> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {t.rows.map((r) => (
                <tr key={r.id}>
                  <td className="td tabular-nums muted">{r.position}</td>
                  <td className="td font-medium">
                    {r.name}
                    {r.groupName && !sport.individual ? <span className="ml-1 text-xs font-normal muted">{r.groupName}</span> : null}
                  </td>
                  {!sport.individual ? (
                    <>
                      <td className="td text-right tabular-nums">{r.played ?? "–"}</td>
                      <td className="td text-right tabular-nums">{r.wins ?? "–"}</td>
                      {sport.hasDraw ? <td className="td text-right tabular-nums">{r.draws ?? "–"}</td> : null}
                      <td className="td text-right tabular-nums">{r.losses ?? "–"}</td>
                      <td className="td text-right tabular-nums">
                        {r.goalsFor ?? "–"}–{r.goalsAgainst ?? "–"}
                      </td>
                    </>
                  ) : null}
                  <td className="td text-right font-semibold tabular-nums">{r.points ?? "–"}</td>
                  {!sport.individual ? (
                    <td className="td">
                      <FormPills results={r.form ? [...r.form].reverse().join("") : null} />
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}

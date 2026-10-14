import { ATTRIBUTIONS } from "@config/admin";
import { FreshnessBar, PageTitle } from "@/components/ui";
import { getEnv } from "@/lib/env";
import { getFreshness } from "@/lib/queries";
import { timeAgo } from "@/lib/time";

export const dynamic = "force-dynamic";
export const metadata = { title: "Data sources & attribution" };

export default async function DataSourcesPage() {
  const fresh = await getFreshness();
  const env = getEnv();
  return (
    <div className="max-w-4xl space-y-6">
      <PageTitle title="Data sources & attribution" subtitle="Every figure on this site comes from the providers below, cached in our database. Pages never call a provider live." />
      <FreshnessBar f={fresh} />

      <section className="space-y-3">
        {ATTRIBUTIONS.map((a) => {
          const p = fresh.providers.find((x) => x.provider === a.id);
          const off = a.id === "sackmann" && env.TENNIS_COMMERCIAL_MODE;
          return (
            <article key={a.id} className="card p-4" data-testid="attribution">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-semibold">
                  <a href={a.url} target="_blank" rel="noopener noreferrer" className="underline">
                    {a.name}
                  </a>
                </h2>
                <span className="chip border-slate-300 dark:border-slate-700">{a.licence}</span>
              </div>
              <p className="mt-1 text-sm muted">{a.note}</p>
              <p className="mt-2 text-xs muted">
                {off ? "Disabled (commercial mode)." : p ? `Last successful call ${timeAgo(p.lastOkAt)} · ${p.callsToday} call${p.callsToday === 1 ? "" : "s"} today (UTC).` : "No calls recorded yet."}
                {p?.lastError ? ` Last error: ${p.lastError.slice(0, 160)}` : ""}
              </p>
            </article>
          );
        })}
      </section>
      <section className="text-sm muted">
        <p>
          Request volume per provider is managed by a central quota manager that never exceeds the configured free-tier limits; head-to-head history is fetched once per pair and refreshed only after a new meeting. Tennis history from the Jeff Sackmann datasets is licensed CC BY-NC-SA 4.0 – attribution is required and commercial use is not permitted unless the site is switched to commercial mode, which removes those datasets from the model and the pages.
        </p>
      </section>
    </div>
  );
}

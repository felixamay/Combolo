import Link from "next/link";
import { ComboGrid } from "@/components/combo";
import { Empty, FreshnessBar, PageTitle } from "@/components/ui";
import { activeCombos, getFreshness, windowCounts } from "@/lib/queries";
import { getTz } from "@/lib/request";
import { SPORTS } from "@/lib/sports";
import { getComboWindow, formatInTz } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const tz = await getTz();
  const [fresh, counts, mixed] = await Promise.all([getFreshness(), windowCounts(tz), activeCombos({ sport: null })]);
  const window = getComboWindow(new Date(), tz);
  const never = !fresh.lastRefreshAt;

  return (
    <div className="space-y-8">
      <PageTitle
        title="Data-driven combos from real head-to-head stats"
        subtitle={`Matches starting between now and the end of ${formatInTz(window.days[2].start, tz, { weekday: "long", month: "short", day: "numeric", hour: undefined, minute: undefined })} (${tz.replace(/_/g, " ")}). Every combo has 7–32 legs, one leg per match.`}
      />
      <FreshnessBar f={fresh} />

      {never ? (
        <Empty>
          <p className="font-medium">No data has been loaded yet.</p>
          <p className="mt-1 muted">Run <code className="font-mono">npm run setup</code> (or the refresh job) with your provider keys configured. See the README.</p>
        </Empty>
      ) : null}

      <section aria-labelledby="sports-h">
        <h2 id="sports-h" className="mb-3 text-lg font-semibold">
          Sports in the next 3 days
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {Object.values(SPORTS).map((s) => {
            const c = counts.bySport[s.id] ?? { total: 0, eligible: 0 };
            return (
              <Link key={s.id} href={`/sport/${s.slug}`} className="card p-3 transition hover:border-brand-500" data-testid="sport-card">
                <div className="flex items-center gap-2 font-semibold">
                  <span aria-hidden className="text-xl">
                    {s.icon}
                  </span>
                  {s.name}
                </div>
                <div className="mt-1 text-sm">
                  <span className="tabular-nums font-medium">{c.eligible}</span> <span className="muted">usable picks /</span> <span className="tabular-nums">{c.total}</span> <span className="muted">matches</span>
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="mixed-h">
        <div className="mb-3 flex items-end justify-between">
          <h2 id="mixed-h" className="text-lg font-semibold">
            Mixed-sport combos
          </h2>
          <Link href="/combos" className="text-sm underline">
            All combos &amp; custom builder
          </Link>
        </div>
        <ComboGrid
          combos={mixed}
          emptyHint={
            never
              ? "Combos appear after the first data refresh."
              : `Not enough eligible matches for a 7-leg combo right now (${counts.eligible} match${counts.eligible === 1 ? "" : "es"} with a usable pick in the next 3 days, 7 needed). Nothing is padded.`
          }
        />
      </section>

      <section className="card p-4 text-sm">
        <h2 className="mb-1 font-semibold">How to read this</h2>
        <ul className="list-disc space-y-1 pl-5 muted">
          <li>
            Each leg is the model&apos;s most likely outcome for one match. The combined probability is the product of the leg probabilities, so it shrinks fast: a 10-leg combo of 75% legs wins only about 5.6% of the time.
          </li>
          <li>
            Combos are regenerated after every data refresh; matches that start are removed automatically and finished legs are marked won or lost in{" "}
            <Link href="/history" className="underline">
              history
            </Link>
            .
          </li>
          <li>
            See <Link href="/about-model" className="underline">how the model works and how accurate it has been</Link>.
          </li>
        </ul>
      </section>
    </div>
  );
}

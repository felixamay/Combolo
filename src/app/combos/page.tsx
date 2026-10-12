import Link from "next/link";
import { COMBO } from "@config/admin";
import { ComboFilters } from "@/components/ComboFilters";
import { ComboGrid, LegsTable } from "@/components/combo";
import { RgNotice } from "@/components/RgNotice";
import { CombinedProb, FreshnessBar, PageTitle, SportBadge } from "@/components/ui";
import { buildLive } from "@/lib/combos/service";
import { activeCombos, getFreshness, leaguesWithUpcoming } from "@/lib/queries";
import { getTz, list, single } from "@/lib/request";
import { SPORTS, SPORT_IDS, type SportId } from "@/lib/sports";

export const dynamic = "force-dynamic";
export const metadata = { title: "Combos" };

type SP = Record<string, string | string[] | undefined>;

export default async function CombosPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const tz = await getTz();
  const sports = list(sp.sport).filter((s): s is SportId => (SPORT_IDS as string[]).includes(s));
  const days = list(sp.day).filter((d) => ["1", "2", "3"].includes(d));
  const league = single(sp.league) || undefined;
  const minConf = single(sp.minConf) || undefined;
  const sizeRaw = single(sp.size) || undefined;
  const strategy = single(sp.strategy) === "DIVERSIFIED" ? "DIVERSIFIED" : "TOP";
  const filtered = sports.length > 0 || days.length > 0 || !!league || !!minConf || !!sizeRaw || single(sp.strategy) === "DIVERSIFIED";

  const [fresh, leagues] = await Promise.all([getFreshness(), leaguesWithUpcoming()]);
  const live = filtered
    ? await buildLive({
        size: sizeRaw ? Number(sizeRaw) : 10,
        strategy,
        tz,
        sports: sports.length ? sports : undefined,
        leagueIds: league ? [league] : undefined,
        days: days.length ? (days.map(Number) as Array<1 | 2 | 3>) : undefined,
        minConfidence: minConf ? Number(minConf) / 100 : undefined,
      })
    : null;
  const mixed = filtered ? [] : await activeCombos({ sport: null });

  return (
    <div className="space-y-6">
      <PageTitle title="Combos" subtitle={`Mixed-sport combos and a custom builder. Time zone: ${tz.replace(/_/g, " ")}. 7–32 legs, one leg per match, only matches that have not started.`} />
      <FreshnessBar f={fresh} />
      <ComboFilters values={{ sports, league, days, minConf, size: sizeRaw, strategy }} leagues={leagues} />

      {live ? (
        live.ok ? (
          <section aria-labelledby="live-h" className="space-y-4" data-testid="live-combo">
            <div className="card flex flex-wrap items-start justify-between gap-4 p-4">
              <div>
                <h2 id="live-h" className="text-lg font-semibold">
                  Your {live.size}-leg {strategy === "TOP" ? "top-probability" : "diversified"} combo
                </h2>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {live.sports.map((s) => (
                    <SportBadge key={s} sport={s} />
                  ))}
                </div>
                <p className="mt-2 text-xs muted">
                  Built live from {live.eligibleCount} eligible matches. Not stored in history; use the sizes below for tracked combos.
                </p>
              </div>
              <CombinedProb p={live.combinedProb} odds={live.combinedOdds} priced={live.legsPriced} size={live.size} large />
            </div>
            <LegsTable legs={live.legs} tz={tz} window={live.window} />
            <RgNotice compact />
          </section>
        ) : (
          <div className="card border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200" role="alert" data-testid="insufficient">
            <p className="font-semibold">{live.reason === "INVALID_SIZE" ? "Invalid size" : "Not enough eligible matches"}</p>
            <p className="mt-1">{live.message}</p>
            {live.reason === "INSUFFICIENT" && live.eligibleCount >= COMBO.MIN_SIZE ? (
              <p className="mt-1">
                Try a size of {COMBO.MIN_SIZE}–{live.eligibleCount}.
              </p>
            ) : null}
          </div>
        )
      ) : (
        <>
          <section aria-labelledby="mixed-h">
            <h2 id="mixed-h" className="mb-3 text-lg font-semibold">
              Mixed-sport combos (tracked)
            </h2>
            <ComboGrid combos={mixed} emptyHint="No mixed combo can be built yet: fewer than 7 matches have a usable pick in the next 3 days. Nothing is padded." />
          </section>
          <section aria-labelledby="single-h">
            <h2 id="single-h" className="mb-3 text-lg font-semibold">
              Single-sport combos
            </h2>
            <div className="flex flex-wrap gap-2">
              {SPORT_IDS.map((id) => (
                <Link key={id} href={`/sport/${SPORTS[id].slug}`} className="btn">
                  <span aria-hidden>{SPORTS[id].icon}</span> {SPORTS[id].name}
                </Link>
              ))}
            </div>
          </section>
          <RgNotice compact />
        </>
      )}
    </div>
  );
}

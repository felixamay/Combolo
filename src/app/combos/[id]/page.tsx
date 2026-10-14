import Link from "next/link";
import { notFound } from "next/navigation";
import { LegsTable } from "@/components/combo";
import { KalshiSlip } from "@/components/KalshiSlip";
import { RgNotice } from "@/components/RgNotice";
import { CombinedProb, KickOff, PageTitle, SportBadge, StatusChip } from "@/components/ui";
import { kalshiByMatch } from "@/lib/combos/service";
import { getEnv } from "@/lib/env";
import { kalshiSignInHref, kalshiSlipLegs } from "@/lib/kalshi/slip";
import { kalshiCanCreate } from "@/lib/providers/kalshi";
import { comboDetail } from "@/lib/queries";
import { getTz } from "@/lib/request";
import { SPORTS, type SportId } from "@/lib/sports";
import { formatInTz } from "@/lib/time";

export const dynamic = "force-dynamic";
export const metadata = { title: "Combo detail" };

export default async function ComboDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const combo = await comboDetail(id);
  if (!combo) notFound();
  const tz = await getTz();
  const sports = [...new Set(combo.legs.map((l) => l.sportId))];
  const won = combo.legs.filter((l) => l.result === "WON").length;
  const lost = combo.legs.filter((l) => l.result === "LOST").length;
  const pending = combo.legs.filter((l) => l.result === "PENDING").length;
  const label = combo.sportId ? SPORTS[combo.sportId as SportId]?.name : "Mixed sports";
  const kalshiMarkets = combo.status === "ACTIVE" && getEnv().FEATURE_KALSHI ? await kalshiByMatch(combo.legs.map((l) => l.matchId)) : null;
  const kalshiLegs = kalshiMarkets
    ? kalshiSlipLegs(combo.legs.map((l) => ({ matchId: l.matchId, pick: l.pick, homeName: l.match.homeName, awayName: l.match.awayName, kalshi: kalshiMarkets.get(l.matchId)?.[l.pick] ?? null })))
    : [];

  return (
    <div className="space-y-5">
      <PageTitle
        title={`${combo.size}-leg ${combo.strategy === "TOP" ? "top-probability" : "diversified"} combo`}
        subtitle={
          <>
            {label} · generated {formatInTz(combo.generatedAt, tz)} · last confirmed {formatInTz(combo.lastConfirmedAt, tz)} ·{" "}
            <Link href="/combos" className="underline">
              all combos
            </Link>
          </>
        }
        right={<StatusChip status={combo.status} />}
      />

      <div className="card flex flex-wrap items-start justify-between gap-4 p-4">
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {sports.map((s) => (
              <SportBadge key={s} sport={s} />
            ))}
          </div>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
            <dt className="muted">First kick-off</dt>
            <dd>
              <KickOff at={combo.firstLegStartsAt} tz={tz} />
            </dd>
            <dt className="muted">Last kick-off</dt>
            <dd>
              <KickOff at={combo.lastLegStartsAt} tz={tz} />
            </dd>
            <dt className="muted">Weakest leg</dt>
            <dd>{(combo.minLegProb * 100).toFixed(0)}%</dd>
            <dt className="muted">Legs won / lost / pending</dt>
            <dd data-testid="leg-tally">
              {won} / {lost} / {pending}
            </dd>
          </dl>
        </div>
        <CombinedProb p={combo.combinedProb} odds={combo.combinedOdds} priced={combo.legsPriced} size={combo.size} large />
      </div>

      {combo.status === "SUPERSEDED" ? (
        <p className="rounded-lg border border-slate-300 bg-slate-100 p-3 text-sm dark:border-slate-700 dark:bg-slate-800">
          This combo was replaced by a newer version after a data refresh and is kept for the record only. It is not counted in hit-rate statistics.
        </p>
      ) : null}

      <LegsTable
        tz={tz}
        legs={combo.legs.map((l) => ({
          matchId: l.matchId,
          sport: l.sportId,
          leagueName: l.match.league.name,
          startsAt: l.startsAt,
          homeName: l.match.homeName,
          awayName: l.match.awayName,
          pick: l.pick,
          prob: l.prob,
          odds: l.odds,
          result: l.result,
        }))}
      />
      {kalshiMarkets && kalshiLegs.length === combo.legs.length ? (
        <KalshiSlip legs={kalshiLegs} canCreate={kalshiCanCreate()} signInHref={await kalshiSignInHref(`/combos/${combo.id}`)} />
      ) : kalshiMarkets ? (
        <p className="card p-3 text-sm" data-testid="kalshi-partial">
          {kalshiLegs.length} of {combo.legs.length} legs are listed on Kalshi, so this combo cannot be placed there as a whole.{" "}
          <Link href={`/combos?kalshi=1&size=${combo.size}${combo.sportId ? `&sport=${combo.sportId}` : ""}&strategy=${combo.strategy}`} className="underline">
            Build a {combo.size}-leg Kalshi-only combo
          </Link>
          .
        </p>
      ) : null}
      <RgNotice compact />
    </div>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { COMBO } from "@config/admin";
import { ComboGrid } from "@/components/combo";
import { MatchTable } from "@/components/matches";
import { FreshnessBar, PageTitle } from "@/components/ui";
import { activeCombos, getFreshness, windowMatches } from "@/lib/queries";
import { getTz } from "@/lib/request";
import { sportBySlug } from "@/lib/sports";
import { WINDOW_PHRASE } from "@/lib/time";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const sport = sportBySlug((await params).slug);
  return { title: sport ? `${sport.name} fixtures, standings & combos` : "Sport" };
}

export default async function SportPage({ params }: { params: Promise<{ slug: string }> }) {
  const sport = sportBySlug((await params).slug);
  if (!sport) notFound();
  const tz = await getTz();
  const [fresh, { matches, window }, combos] = await Promise.all([getFreshness(), windowMatches({ tz, sport: sport.id }), activeCombos({ sport: sport.id })]);
  const eligible = matches.filter((m) => m.prediction?.eligible).length;

  return (
    <div className="space-y-8">
      <PageTitle
        title={`${sport.icon} ${sport.name}`}
        subtitle={`${matches.length} scheduled ${WINDOW_PHRASE}, ${eligible} with a usable pick.`}
        right={
          <Link href={`/rankings/${sport.slug}`} className="btn">
            {sport.individual ? "Rankings" : "Standings"}
          </Link>
        }
      />
      <FreshnessBar f={fresh} />

      <section aria-labelledby="combos-h">
        <h2 id="combos-h" className="mb-3 text-lg font-semibold">
          {sport.name} combos
        </h2>
        {eligible < COMBO.MAX_SIZE ? (
          <p className="mb-3 text-sm muted" data-testid="size-limit">
            Only {eligible} eligible {sport.pluralLabel} {WINDOW_PHRASE}
            {eligible >= COMBO.MIN_SIZE ? `, so ${sport.name.toLowerCase()} combos can have at most ${eligible} legs.` : ` – fewer than the ${COMBO.MIN_SIZE} legs a combo needs.`} Nothing is padded.
          </p>
        ) : null}
        <ComboGrid
          combos={combos}
          emptyHint={`Only ${eligible} eligible ${sport.pluralLabel} ${WINDOW_PHRASE} – a 7-leg combo needs 7. Nothing was padded. You can still build combos mixing sports.`}
        />
        <p className="mt-2 text-sm">
          <Link className="underline" href={`/combos?sport=${sport.id}`}>
            Custom {sport.name.toLowerCase()} combo (any size 7–32, filters)
          </Link>
        </p>
      </section>

      <section aria-labelledby="fixtures-h">
        <h2 id="fixtures-h" className="sr-only">
          Fixtures
        </h2>
        <MatchTable matches={matches} tz={tz} window={window} />
      </section>
    </div>
  );
}

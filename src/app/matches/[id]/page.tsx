import Link from "next/link";
import { notFound } from "next/navigation";
import { FormPills, KickOff, Pct, ProbBar, SportBadge, pickLabel } from "@/components/ui";
import { MODEL, MODEL_VERSION } from "@config/admin";
import type { PredictionOutput } from "@/lib/model/predict";
import { matchDetail, type SideDetail } from "@/lib/queries";
import { getTz } from "@/lib/request";
import { SPORTS, type SportId } from "@/lib/sports";
import { formatInTz, timeAgo } from "@/lib/time";

export const dynamic = "force-dynamic";
export const metadata = { title: "Match detail" };

const COMPONENT_LABEL: Record<string, string> = {
  strength: "League standing / ranking strength",
  elo: "Elo rating",
  h2h: "Head-to-head",
  form: "Recent form",
};

function StandingCell({ side, individual }: { side: SideDetail; individual: boolean }) {
  const s = side.standing;
  if (!s) return <span className="muted">no {individual ? "ranking" : "standing"} stored</span>;
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-sm">
      <dt className="muted">{individual ? "Ranking" : "Position"}</dt>
      <dd className="font-semibold">#{s.position}</dd>
      <dt className="muted">Points</dt>
      <dd>{s.points ?? "–"}</dd>
      {!individual ? (
        <>
          <dt className="muted">Played</dt>
          <dd>{s.played ?? "–"}</dd>
          <dt className="muted">W-D-L</dt>
          <dd>
            {s.wins ?? "–"}-{s.draws ?? "–"}-{s.losses ?? "–"}
          </dd>
          <dt className="muted">Goals / points for-against</dt>
          <dd>
            {s.goalsFor ?? "–"}-{s.goalsAgainst ?? "–"}
          </dd>
        </>
      ) : null}
      <dt className="muted">Source</dt>
      <dd className="text-xs">
        {s.source} · {timeAgo(s.capturedAt)}
      </dd>
    </dl>
  );
}

export default async function MatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await matchDetail(id);
  if (!d) notFound();
  const tz = await getTz();
  const { match, home, away, meetings, h2hRecord } = d;
  const sport = SPORTS[match.sportId as SportId];
  const pred = match.prediction;
  const comps = (pred?.components ?? {}) as unknown as PredictionOutput["components"];
  const bestOdds = match.odds.reduce(
    (acc, o) => ({ HOME: Math.max(acc.HOME, o.home ?? 0), DRAW: Math.max(acc.DRAW, o.draw ?? 0), AWAY: Math.max(acc.AWAY, o.away ?? 0) }),
    { HOME: 0, DRAW: 0, AWAY: 0 },
  );

  const sideOf = (m: (typeof meetings)[number], which: "HOME" | "AWAY") => (which === "HOME" ? m.homeName : m.awayName);
  const homeId = match.homeTeamId ?? match.homePlayerId;
  const awayId = match.awayTeamId ?? match.awayPlayerId;
  const winnerId = (m: (typeof meetings)[number]) => (m.winner === "HOME" ? (m.homeTeamId ?? m.homePlayerId) : m.winner === "AWAY" ? (m.awayTeamId ?? m.awayPlayerId) : null);
  const homeWins = meetings.filter((m) => winnerId(m) === homeId).length;
  const awayWins = meetings.filter((m) => winnerId(m) === awayId).length;
  const draws = meetings.filter((m) => m.winner === "DRAW").length;

  return (
    <div className="space-y-6">
      <div>
        <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
          <SportBadge sport={match.sportId} />
          <span className="muted">{match.league.name}</span>
          {match.surface ? <span className="chip">{match.surface}</span> : null}
          {match.round ? <span className="muted">· {match.round}</span> : null}
        </div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl" data-testid="match-title">
          {home.name} <span className="muted">vs</span> {away.name}
        </h1>
        <p className="mt-1 text-sm muted">
          <KickOff at={match.startsAt} tz={tz} /> · {match.status === "SCHEDULED" ? "scheduled" : match.status.toLowerCase()}
          {match.status === "FINISHED" && match.homeScore != null ? ` · final ${match.homeScore}–${match.awayScore}` : ""}
          {" · "}
          <Link href={`/sport/${sport.slug}`} className="underline">
            {sport.name}
          </Link>
        </p>
      </div>

      <section className="card space-y-4 p-4" aria-labelledby="pick-h" data-testid="pick-card">
        <h2 id="pick-h" className="text-lg font-semibold">
          Model pick
        </h2>
        {pred?.eligible && pred.pick && pred.pickProb != null ? (
          <>
            <div className="flex flex-wrap items-center gap-6">
              <div>
                <div className="text-2xl font-bold">{pickLabel(pred.pick, home.name, away.name)}</div>
                <div className="mt-1">
                  <ProbBar p={pred.pickProb} />
                </div>
              </div>
              <dl className="grid grid-cols-3 gap-x-6 text-center text-sm">
                <div>
                  <dt className="muted truncate">{home.name}</dt>
                  <dd className="text-lg font-semibold">
                    <Pct p={pred.pHome} />
                  </dd>
                </div>
                {pred.pDraw != null ? (
                  <div>
                    <dt className="muted">Draw</dt>
                    <dd className="text-lg font-semibold">
                      <Pct p={pred.pDraw} />
                    </dd>
                  </div>
                ) : null}
                <div>
                  <dt className="muted truncate">{away.name}</dt>
                  <dd className="text-lg font-semibold">
                    <Pct p={pred.pAway} />
                  </dd>
                </div>
              </dl>
              {bestOdds.HOME || bestOdds.AWAY ? (
                <div className="text-sm">
                  <div className="muted">Best bookmaker odds</div>
                  <div className="tabular-nums">
                    {bestOdds.HOME ? bestOdds.HOME.toFixed(2) : "–"} / {sport.hasDraw ? `${bestOdds.DRAW ? bestOdds.DRAW.toFixed(2) : "–"} / ` : ""}
                    {bestOdds.AWAY ? bestOdds.AWAY.toFixed(2) : "–"}
                  </div>
                </div>
              ) : null}
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm" data-testid="components-table">
                <caption className="mb-1 text-left text-xs muted">
                  Why this pick – log-odds in favour of {home.name} (positive = favours the home side). Model {pred.modelVersion ?? MODEL_VERSION}, computed {timeAgo(pred.computedAt)}.
                </caption>
                <thead>
                  <tr>
                    <th className="th">Component</th>
                    <th className="th">Evidence</th>
                    <th className="th text-right">Weight</th>
                    <th className="th text-right">Contribution</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {(["strength", "elo", "h2h", "form"] as const).map((k) =>
                    comps[k] ? (
                      <tr key={k}>
                        <td className="td font-medium">{COMPONENT_LABEL[k]}</td>
                        <td className="td muted">{comps[k]!.summary}</td>
                        <td className="td text-right tabular-nums">{comps[k]!.weight.toFixed(2)}</td>
                        <td className="td text-right tabular-nums">{comps[k]!.contribution >= 0 ? "+" : ""}{comps[k]!.contribution.toFixed(2)}</td>
                      </tr>
                    ) : (
                      <tr key={k}>
                        <td className="td font-medium">{COMPONENT_LABEL[k]}</td>
                        <td className="td muted" colSpan={3}>
                          Not available for this match – excluded and the remaining weights renormalised.
                        </td>
                      </tr>
                    ),
                  )}
                  {comps.homeAdvantage ? (
                    <tr>
                      <td className="td font-medium">{match.neutralVenue ? "Neutral venue" : "Home advantage"}</td>
                      <td className="td muted">{comps.homeAdvantage.summary}</td>
                      <td className="td" />
                      <td className="td text-right tabular-nums">{comps.homeAdvantage.logit >= 0 ? "+" : ""}{comps.homeAdvantage.logit.toFixed(2)}</td>
                    </tr>
                  ) : null}
                  {comps.combined ? (
                    <tr className="font-semibold">
                      <td className="td">Combined</td>
                      <td className="td muted font-normal">Temperature {comps.combined.temperature} applied to damp over-confidence</td>
                      <td className="td" />
                      <td className="td text-right tabular-nums">{comps.combined.z >= 0 ? "+" : ""}{comps.combined.z.toFixed(2)}</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            <p className="text-xs muted">
              Weights (configurable): strength {MODEL.weights.strength}, Elo {MODEL.weights.elo}, H2H {MODEL.weights.h2h}, form {MODEL.weights.form}. See{" "}
              <Link href="/about-model" className="underline">
                about the model
              </Link>
              .
            </p>
          </>
        ) : (
          <p className="text-sm" data-testid="no-pick">
            No pick for this match{pred?.reason ? `: ${pred.reason}` : pred ? "." : " – not analysed yet."} A pick needs rating, standing or form data for both sides; head-to-head alone is not enough.
          </p>
        )}
      </section>

      <section aria-labelledby="sides-h" className="grid gap-4 md:grid-cols-2">
        <h2 id="sides-h" className="sr-only">
          Standings, form and ratings
        </h2>
        {[home, away].map((s, i) => (
          <div key={i} className="card space-y-3 p-4" data-testid="side-card">
            <h3 className="font-semibold">
              {s.name} <span className="text-xs font-normal muted">{i === 0 ? "(home)" : "(away)"}</span>
            </h3>
            <StandingCell side={s} individual={sport.individual} />
            <div>
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide muted">Form (latest first)</div>
              <FormPills results={s.form?.results} />
              {s.form?.details?.length ? (
                <ul className="mt-2 space-y-0.5 text-xs muted">
                  {s.form.details.slice(0, 5).map((f, j) => (
                    <li key={j}>
                      {f.date} · {f.home ? "vs" : "@"} {f.opponent} · <strong>{f.result}</strong>
                      {f.score ? ` ${f.score}` : ""}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            <div className="text-sm">
              <span className="muted">Elo: </span>
              {s.elo.overall ? (
                <>
                  <strong className="tabular-nums">{Math.round(s.elo.overall)}</strong> <span className="muted">({s.elo.overallMatches} matches)</span>
                  {s.elo.surface && match.surface ? (
                    <>
                      {" · "}
                      {match.surface}: <strong className="tabular-nums">{Math.round(s.elo.surface)}</strong> <span className="muted">({s.elo.surfaceMatches})</span>
                    </>
                  ) : null}
                </>
              ) : (
                <span className="muted">no rating yet</span>
              )}
            </div>
          </div>
        ))}
      </section>

      <section aria-labelledby="h2h-h" className="space-y-2" data-testid="h2h">
        <h2 id="h2h-h" className="text-lg font-semibold">
          Head-to-head
        </h2>
        {meetings.length === 0 ? (
          <p className="text-sm muted">No previous meetings stored{d.excludedSources.length ? " (commercial mode excludes non-commercial data sources)" : ""}.</p>
        ) : (
          <>
            <p className="text-sm" data-testid="h2h-summary">
              {meetings.length} stored meeting{meetings.length === 1 ? "" : "s"}: <strong>{home.name}</strong> {homeWins} · <strong>{away.name}</strong> {awayWins}
              {sport.hasDraw ? ` · draws ${draws}` : ""}
              {h2hRecord ? <span className="muted"> · cached {timeAgo(h2hRecord.fetchedAt)} from {h2hRecord.source}</span> : null}
            </p>
            <div className="card overflow-x-auto">
              <table className="min-w-full">
                <thead>
                  <tr>
                    <th className="th">Date</th>
                    <th className="th">Competition</th>
                    <th className="th">Home</th>
                    <th className="th">Score</th>
                    <th className="th">Away</th>
                    {sport.individual ? <th className="th">Surface</th> : null}
                    <th className="th">Winner</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {meetings.map((m) => (
                    <tr key={m.id} data-testid="h2h-row">
                      <td className="td whitespace-nowrap">{formatInTz(m.startsAt, tz, { weekday: undefined, hour: undefined, minute: undefined, year: "numeric" })}</td>
                      <td className="td muted">{m.league.name}</td>
                      <td className="td">{m.homeName}</td>
                      <td className="td tabular-nums">{m.homeScore != null ? `${m.homeScore}–${m.awayScore}` : "–"}</td>
                      <td className="td">{m.awayName}</td>
                      {sport.individual ? <td className="td">{m.surface ?? "–"}</td> : null}
                      <td className="td font-medium">{m.winner === "DRAW" ? "Draw" : m.winner ? sideOf(m, m.winner) : "–"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {match.odds.length > 0 ? (
        <section aria-labelledby="odds-h" className="space-y-2">
          <h2 id="odds-h" className="text-lg font-semibold">
            Bookmaker odds
          </h2>
          <div className="card overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr>
                  <th className="th">Bookmaker</th>
                  <th className="th">{home.name}</th>
                  {sport.hasDraw ? <th className="th">Draw</th> : null}
                  <th className="th">{away.name}</th>
                  <th className="th">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {match.odds.map((o) => (
                  <tr key={o.id}>
                    <td className="td">
                      {o.bookmaker} <span className="text-xs muted">({o.provider})</span>
                    </td>
                    <td className="td tabular-nums">{o.home?.toFixed(2) ?? "–"}</td>
                    {sport.hasDraw ? <td className="td tabular-nums">{o.draw?.toFixed(2) ?? "–"}</td> : null}
                    <td className="td tabular-nums">{o.away?.toFixed(2) ?? "–"}</td>
                    <td className="td muted">{timeAgo(o.fetchedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}

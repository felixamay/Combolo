import { COMBO, MODEL, MODEL_VERSION } from "@config/admin";
import { Empty, PageTitle } from "@/components/ui";
import { latestBacktests } from "@/lib/queries";
import { SPORTS, type SportId } from "@/lib/sports";
import { formatInTz } from "@/lib/time";

export const dynamic = "force-dynamic";
export const metadata = { title: "About the model" };

interface Bin {
  low: number;
  high: number;
  n: number;
  predicted: number;
  actual: number;
}

export default async function AboutModelPage() {
  const results = await latestBacktests();
  return (
    <div className="max-w-4xl space-y-8">
      <PageTitle title="About the model" subtitle={`Version ${MODEL_VERSION}. A transparent, rule-based statistical model – not a machine-learning black box and not betting advice.`} />

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">What goes in</h2>
        <p className="text-sm">
          For every upcoming match the model estimates a win probability for each side (plus a draw probability in football, rugby and handball). Four components are each converted to log-odds in favour of the home side, then blended with fixed, documented weights. A missing component is simply dropped and the remaining weights renormalised – nothing is invented.
        </p>
        <div className="card overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr>
                <th className="th">Component</th>
                <th className="th">What it measures</th>
                <th className="th text-right">Weight</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
              <tr>
                <td className="td font-medium">Standing / ranking strength</td>
                <td className="td muted">League table position, points per game or win rate and goal / point margin; ATP/WTA rank and points for tennis.</td>
                <td className="td text-right tabular-nums">{MODEL.weights.strength}</td>
              </tr>
              <tr>
                <td className="td font-medium">Elo rating</td>
                <td className="td muted">
                  Computed by us from every stored finished match (K = {MODEL.elo.k}, tennis K = {MODEL.elo.kTennis}); tennis blends overall and per-surface Elo ({Math.round(MODEL.elo.surfaceBlend * 100)}% surface). Shrunk toward the mean when few matches exist.
                </td>
                <td className="td text-right tabular-nums">{MODEL.weights.elo}</td>
              </tr>
              <tr>
                <td className="td font-medium">Head-to-head</td>
                <td className="td muted">
                  Recency-weighted past meetings (half-life {MODEL.h2hHalfLifeMeetings} meetings, prior of {MODEL.h2hPrior} pseudo-meetings at 50/50), surface-specific for tennis and home/away aware for team sports. H2H alone never produces a pick.
                </td>
                <td className="td text-right tabular-nums">{MODEL.weights.h2h}</td>
              </tr>
              <tr>
                <td className="td font-medium">Recent form</td>
                <td className="td muted">Last {MODEL.formWindow} results with a prior of {MODEL.formPrior} pseudo-games.</td>
                <td className="td text-right tabular-nums">{MODEL.weights.form}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-sm muted">
          Home advantage is added per sport (and skipped at neutral venues). A final temperature of {MODEL.temperature} shrinks probabilities slightly toward 50/50 to curb over-confidence, and no probability is reported outside {MODEL.clamp[0] * 100}%–{MODEL.clamp[1] * 100}%. A match without enough data (no standing, rating or form for both sides) gets <em>no pick</em> and cannot appear in a combo. All weights live in <code className="font-mono">config/admin.ts</code>.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">How combos are built</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>Only matches that start after now and before the end of the 3rd calendar day in your time zone are eligible; started matches drop out automatically.</li>
          <li>
            Combos have {COMBO.MIN_SIZE}–{COMBO.MAX_SIZE} legs; generated sizes are {COMBO.SIZES.join(", ")}, and any custom size in range can be built live.
          </li>
          <li>One leg per match – never two legs from the same match and never both sides.</li>
          <li>If fewer eligible matches exist than the combo needs, the site says so instead of padding.</li>
          <li>The <strong>top-probability</strong> selection takes the legs with the highest probabilities (this maximises the combined probability). The <strong>diversified</strong> selection caps how many legs one sport or league can contribute.</li>
          <li>The combined probability is the product of leg probabilities and assumes legs are independent. Combined odds are shown only when every leg has a real stored bookmaker price.</li>
        </ul>
      </section>

      <section className="space-y-3" aria-labelledby="bt-h" data-testid="backtest">
        <h2 id="bt-h" className="text-lg font-semibold">Measured accuracy (walk-forward back-test)</h2>
        <p className="text-sm">
          For each sport, stored finished matches are replayed in date order. Each match is predicted using only Elo, form and head-to-head built from <em>earlier</em> matches, then compared with what happened. Standings are not back-tested because historical league tables are not stored, so live picks (which also use standings) may differ from these figures. The baseline is always picking the most common result. Brier is the sum of squared errors over the home/draw/away outcomes (lower is better; a coin flip between two outcomes scores 0.5), log loss is the average negative log of the probability given to what happened.
        </p>
        {results.length === 0 ? (
          <Empty>
            No back-test has been run yet (n = 0). It needs a history of finished matches and runs weekly via the <code className="font-mono">backtest</code> job. No accuracy figure is claimed until then.
          </Empty>
        ) : (
          <div className="space-y-4">
            <div className="card overflow-x-auto">
              <table className="min-w-full" data-testid="backtest-table">
                <thead>
                  <tr>
                    <th className="th">Sport</th>
                    <th className="th text-right">Matches scored</th>
                    <th className="th text-right">Accuracy</th>
                    <th className="th text-right">Baseline</th>
                    <th className="th text-right">Brier</th>
                    <th className="th text-right">Log loss</th>
                    <th className="th">Period</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {results.map((r) => (
                    <tr key={r.id}>
                      <td className="td font-medium">{SPORTS[r.sportId as SportId]?.name ?? r.sportId}</td>
                      <td className="td text-right tabular-nums">{r.sample.toLocaleString("en-US")}</td>
                      <td className="td text-right font-semibold tabular-nums">{(r.accuracy * 100).toFixed(1)}%</td>
                      <td className="td text-right tabular-nums">{(r.baselineAccuracy * 100).toFixed(1)}%</td>
                      <td className="td text-right tabular-nums">{r.brier.toFixed(3)}</td>
                      <td className="td text-right tabular-nums">{r.logLoss.toFixed(3)}</td>
                      <td className="td text-xs muted">
                        {r.periodFrom ? formatInTz(r.periodFrom, "UTC", { weekday: undefined, hour: undefined, minute: undefined, year: "numeric" }) : "–"} → {r.periodTo ? formatInTz(r.periodTo, "UTC", { weekday: undefined, hour: undefined, minute: undefined, year: "numeric" }) : "–"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <details className="card p-3 text-sm">
              <summary className="cursor-pointer font-medium">Calibration (predicted vs. actual win rate)</summary>
              <div className="mt-3 grid gap-4 md:grid-cols-2">
                {results.map((r) => (
                  <div key={r.id}>
                    <div className="mb-1 font-medium">{SPORTS[r.sportId as SportId]?.name ?? r.sportId}</div>
                    <table className="min-w-full text-xs">
                      <thead>
                        <tr>
                          <th className="th">Predicted</th>
                          <th className="th text-right">n</th>
                          <th className="th text-right">Avg predicted</th>
                          <th className="th text-right">Actual</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(r.calibration as unknown as Bin[]).map((b) => (
                          <tr key={b.low}>
                            <td className="td">
                              {Math.round(b.low * 100)}–{Math.round(b.high * 100)}%
                            </td>
                            <td className="td text-right tabular-nums">{b.n}</td>
                            <td className="td text-right tabular-nums">{(b.predicted * 100).toFixed(0)}%</td>
                            <td className="td text-right tabular-nums">{(b.actual * 100).toFixed(0)}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            </details>
          </div>
        )}
      </section>

      <section className="space-y-2 text-sm">
        <h2 className="text-lg font-semibold">Limits you should know about</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>Probabilities are estimates from public statistics; they cannot account for injuries, line-ups, weather or motivation.</li>
          <li>Even a model with good single-match accuracy produces very small combined probabilities for long combos. A 20-leg combo of 70% legs wins about 0.08% of the time (roughly 1 in 1,250).</li>
          <li>Bookmaker odds include a margin; this site does not claim any combo is good value.</li>
        </ul>
      </section>
    </div>
  );
}

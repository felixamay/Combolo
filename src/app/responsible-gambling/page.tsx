import { HELP_RESOURCES } from "@config/admin";
import { PageTitle } from "@/components/ui";
import { getEnv } from "@/lib/env";

export const metadata = { title: "Responsible gambling" };

export default function ResponsibleGamblingPage() {
  const env = getEnv();
  return (
    <div className="max-w-3xl space-y-5 text-sm">
      <PageTitle title="Responsible gambling" />
      <p>
        {env.SITE_NAME} publishes statistical analysis of sports matches. It is <strong>informational only</strong>: it does not accept bets, hold money or link you to an operator. Probabilities are estimates, not guarantees, and past performance does not predict future results.
      </p>
      <ul className="list-disc space-y-1 pl-5">
        <li>Multi-leg combinations are very unlikely to win. A 10-leg combo of 75% legs wins about 5.6% of the time; a 20-leg combo of 70% legs about 0.08%.</li>
        <li>Bookmakers build a margin into their prices, so even favourable-looking statistics do not imply positive value.</li>
        <li>Only gamble if you are of legal age in your jurisdiction (18+ or 21+ depending on where you live), only with money you can afford to lose, and set limits before you start.</li>
        <li>If gambling stops being fun, stop. Self-exclusion tools are offered by licensed operators.</li>
      </ul>
      <h2 className="text-lg font-semibold">Get help</h2>
      <ul className="space-y-2">
        {HELP_RESOURCES.map((h) => (
          <li key={h.name} className="card p-3">
            <a href={h.url} target="_blank" rel="noopener noreferrer" className="font-medium underline">
              {h.name}
            </a>
            {h.phone ? <div className="muted">{h.phone}</div> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

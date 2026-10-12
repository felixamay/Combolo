import { HELP_RESOURCES } from "@config/admin";

/** Responsible-gambling notice. `compact` is shown on every combo; the footer uses the full version. */
export function RgNotice({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-200" data-testid="rg-notice">
        <strong>Statistical estimate, not a guarantee.</strong> Long combinations almost always lose; this site does not accept bets. Gambling problem? Call 1-800-GAMBLER (US) or see{" "}
        <a className="underline" href="/responsible-gambling">
          help resources
        </a>
        . 18+/21+ depending on your jurisdiction.
      </p>
    );
  }
  return (
    <div data-testid="rg-footer">
      <p className="text-sm">
        <strong>Play responsibly.</strong> All probabilities are statistical estimates, not guarantees. This site is informational only and does not accept bets. Only people of legal gambling age in their jurisdiction (18+ or 21+) should use betting products. Never bet more than you can afford to lose.
      </p>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {HELP_RESOURCES.map((h) => (
          <li key={h.name}>
            <a className="underline" href={h.url} target="_blank" rel="noopener noreferrer">
              {h.name}
            </a>
            {h.phone ? <span className="muted"> – {h.phone}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

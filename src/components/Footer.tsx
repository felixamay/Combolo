import Link from "next/link";
import { ATTRIBUTIONS } from "@config/admin";
import { getEnv } from "@/lib/env";
import { RgNotice } from "./RgNotice";

export function Footer() {
  const env = getEnv();
  const sackmann = ATTRIBUTIONS.find((a) => a.id === "sackmann")!;
  return (
    <footer className="mt-12 border-t border-slate-200 bg-white py-8 dark:border-slate-800 dark:bg-slate-900">
      <div className="mx-auto max-w-6xl space-y-4 px-4">
        <RgNotice />
        <p className="text-xs muted">
          {!env.TENNIS_COMMERCIAL_MODE ? (
            <>
              Tennis data includes{" "}
              <a className="underline" href={sackmann.url} target="_blank" rel="noopener noreferrer">
                Jeff Sackmann / Tennis Abstract
              </a>{" "}
              ({sackmann.licence}, non-commercial use).{" "}
            </>
          ) : null}
          Data from API-Sports, football-data.org, Highlightly, TheSportsDB, API-Tennis, Live Tennis API and (optionally) The Odds API.
        </p>
        <nav className="flex flex-wrap gap-4 text-sm" aria-label="Footer">
          <Link href="/data-sources" className="underline">
            Data sources &amp; attribution
          </Link>
          <Link href="/about-model" className="underline">
            About the model
          </Link>
          <Link href="/responsible-gambling" className="underline">
            Responsible gambling
          </Link>
        </nav>
        <p className="text-xs muted">
          © {new Date().getFullYear()} {env.SITE_NAME}. Statistical estimates only – no guarantee of any outcome. We do not accept or facilitate bets.
        </p>
      </div>
    </footer>
  );
}

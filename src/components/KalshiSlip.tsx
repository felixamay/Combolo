"use client";

import { useState } from "react";

export interface KalshiSlipLeg {
  matchId: string;
  pick: "HOME" | "DRAW" | "AWAY";
  /** "Chelsea vs Arsenal" as shown on this site. */
  matchLabel: string;
  seriesTicker: string;
  eventTicker: string;
  marketTicker: string;
  eventTitle: string;
  marketTitle: string;
  yesAsk: number | null;
}

type Created = { marketTicker: string; eventTicker: string; yesAsk: number | null; reused: boolean };

const cents = (p: number) => `${Math.round(p * 100)}¢`;

function slipText(legs: KalshiSlipLeg[]): string {
  const lines = legs.map((l, i) => `${i + 1}. ${l.eventTitle} — ${l.marketTitle} YES${l.yesAsk ? ` (${cents(l.yesAsk)})` : ""}  [${l.marketTicker}]`);
  return [`Kalshi combo – ${legs.length} legs (all YES)`, ...lines].join("\n");
}

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Every leg of a combo mapped to its Kalshi game-winner market, a copyable slip, and (when the operator configured
 * a Kalshi API key) a button that creates the combo market on Kalshi so the user can trade it from their own account.
 */
/** `canCreate`: Kalshi key configured. `signInHref`: set when sign-in is required first (creation is then hidden behind it). */
export function KalshiSlip({ legs, canCreate, signInHref }: { legs: KalshiSlipLeg[]; canCreate: boolean; signInHref?: string }) {
  const [copied, setCopied] = useState<"slip" | "ticker" | "failed" | null>(null);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<Created | null>(null);
  const [error, setError] = useState<string | null>(null);
  const allPriced = legs.every((l) => l.yesAsk);
  const legProduct = allPriced ? legs.reduce((p, l) => p * (l.yesAsk as number), 1) : null;

  const onCopy = async (what: "slip" | "ticker", text: string) => {
    setCopied((await copy(text)) ? what : "failed");
    setTimeout(() => setCopied(null), 2500);
  };

  const onCreate = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/kalshi/combo", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ legs: legs.map((l) => ({ matchId: l.matchId, pick: l.pick })) }) });
      const json = await res.json();
      if (!res.ok) setError(json.error ?? `Request failed (${res.status}).`);
      else setCreated(json as Created);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card space-y-4 p-4" aria-labelledby="kalshi-h" data-testid="kalshi-slip">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="kalshi-h" className="text-lg font-semibold">
            Place this combo on Kalshi
          </h2>
          <p className="mt-1 text-sm muted">
            Every leg is a Kalshi game-winner market. Buy <strong>YES</strong> on each one in a single Kalshi combo. Prices are Kalshi&apos;s best YES offer at the last sync and change constantly.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn" onClick={() => onCopy("slip", slipText(legs))} data-testid="kalshi-copy">
            {copied === "slip" ? "Copied" : "Copy combo"}
          </button>
          {canCreate && signInHref ? (
            <a className="btn btn-primary" href={signInHref} data-testid="kalshi-sign-in">
              Sign in to create on Kalshi
            </a>
          ) : canCreate ? (
            <button type="button" className="btn btn-primary" onClick={onCreate} disabled={busy || !!created} data-testid="kalshi-create">
              {busy ? "Creating…" : created ? "Created on Kalshi" : "Create on Kalshi"}
            </button>
          ) : null}
        </div>
      </div>
      {copied === "failed" ? <p className="text-sm text-red-700 dark:text-red-300">Copying was blocked by the browser. Select the legs below and copy them by hand.</p> : null}

      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-800">
          <thead>
            <tr>
              <th className="th">#</th>
              <th className="th">Kalshi game</th>
              <th className="th">Buy YES on</th>
              <th className="th">YES price</th>
              <th className="th">Market ticker</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {legs.map((l, i) => (
              <tr key={l.marketTicker} data-testid="kalshi-leg">
                <td className="td tabular-nums muted">{i + 1}</td>
                <td className="td">
                  <a href={`https://kalshi.com/markets/${l.seriesTicker.toLowerCase()}`} target="_blank" rel="noopener noreferrer" className="font-medium hover:underline">
                    {l.eventTitle}
                  </a>
                  {l.eventTitle !== l.matchLabel ? <div className="text-xs muted">{l.matchLabel}</div> : null}
                </td>
                <td className="td font-semibold">{l.marketTitle}</td>
                <td className="td tabular-nums">{l.yesAsk ? cents(l.yesAsk) : <span className="muted">no offer</span>}</td>
                <td className="td font-mono text-xs">{l.marketTicker}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-sm">
        {legProduct ? (
          <>
            Product of the leg prices: <strong className="tabular-nums">{(legProduct * 100).toFixed(legProduct < 0.01 ? 3 : 2)}¢</strong> per $1 contract{" "}
            <span className="muted">(about {Math.floor(1 / legProduct).toLocaleString("en-US")}× payout). Kalshi quotes combos separately, so its price will differ.</span>
          </>
        ) : (
          <span className="muted">Some legs have no YES offer right now, so there is no price estimate.</span>
        )}
      </p>

      {created ? (
        <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200" role="status" data-testid="kalshi-created">
          <p className="font-semibold">{created.reused ? "This combo already exists on Kalshi." : "Combo created on Kalshi."}</p>
          <p className="mt-1">
            Market ticker <code className="font-mono">{created.marketTicker}</code>{" "}
            <button type="button" className="btn ml-1 px-2 py-0.5 text-xs" onClick={() => onCopy("ticker", created.marketTicker)}>
              {copied === "ticker" ? "Copied" : "Copy ticker"}
            </button>
          </p>
          {created.yesAsk ? <p className="mt-1">Kalshi&apos;s current YES offer: {cents(created.yesAsk)}</p> : null}
          <p className="mt-1">Open Kalshi, add the same legs to a combo (or search for the ticker), review Kalshi&apos;s quote and place it from your own account.</p>
        </div>
      ) : null}
      {error ? (
        <p className="text-sm text-red-700 dark:text-red-300" role="alert">
          {error}
        </p>
      ) : null}
      <p className="text-xs muted">This site never places trades or touches your Kalshi account. Kalshi is a CFTC-regulated exchange; availability depends on your state.</p>
    </section>
  );
}

import Link from "next/link";
import type { ReactNode } from "react";
import { COMBO } from "@config/admin";
import { oneInN, probabilityLabel } from "@/lib/combos/engine";
import { SPORTS, type SportId } from "@/lib/sports";
import { formatInTz, timeAgo } from "@/lib/time";
import type { Freshness } from "@/lib/queries";

export function SportBadge({ sport, short = false }: { sport: string; short?: boolean }) {
  const s = SPORTS[sport as SportId];
  if (!s) return <span className="chip">{sport}</span>;
  return (
    <span className="chip border-transparent text-white" style={{ backgroundColor: s.color }} title={s.name}>
      <span aria-hidden>{s.icon}</span>
      {short ? null : s.name}
    </span>
  );
}

export function Pct({ p, digits = 0 }: { p: number | null | undefined; digits?: number }) {
  if (p == null) return <span className="muted">–</span>;
  return <span>{(p * 100).toFixed(digits)}%</span>;
}

export function ProbBar({ p }: { p: number }) {
  const high = p >= COMBO.HIGH_CONFIDENCE;
  return (
    <div className="flex items-center gap-2" aria-label={`Probability ${(p * 100).toFixed(0)}%`}>
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
        <div className={`h-full ${high ? "bg-brand-500" : "bg-amber-500"}`} style={{ width: `${Math.round(p * 100)}%` }} />
      </div>
      <span className="tabular-nums text-sm font-medium">{(p * 100).toFixed(0)}%</span>
    </div>
  );
}

export function FormPills({ results }: { results: string | null | undefined }) {
  if (!results) return <span className="muted text-xs">no form data</span>;
  return (
    <span className="inline-flex gap-0.5" aria-label={`Form, most recent first: ${results.split("").join(" ")}`}>
      {results
        .slice(0, 8)
        .split("")
        .map((r, i) => (
          <span
            key={i}
            className={`inline-flex h-5 w-5 items-center justify-center rounded text-[11px] font-bold text-white ${r === "W" ? "bg-emerald-600" : r === "L" ? "bg-red-600" : "bg-slate-500"}`}
          >
            {r}
          </span>
        ))}
    </span>
  );
}

export function pickLabel(pick: string, home: string, away: string): string {
  return pick === "HOME" ? home : pick === "AWAY" ? away : "Draw";
}

export function PageTitle({ title, subtitle, right }: { title: string; subtitle?: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm muted">{subtitle}</p> : null}
      </div>
      {right}
    </div>
  );
}

export function FreshnessBar({ f }: { f: Freshness }) {
  return (
    <p className="mb-4 text-xs muted" data-testid="freshness">
      Data refreshed {f.lastRefreshAt ? timeAgo(f.lastRefreshAt) : "– never (run the refresh job)"}
      {f.lastStandingsAt ? ` · standings ${timeAgo(f.lastStandingsAt)}` : ""}
      {f.lastResultsAt ? ` · results ${timeAgo(f.lastResultsAt)}` : ""}
      {f.lastOddsAt ? ` · odds ${timeAgo(f.lastOddsAt)}` : ""}.{" "}
      <Link href="/data-sources" className="underline">
        Sources
      </Link>
    </p>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="card p-6 text-center text-sm" role="status">
      {children}
    </div>
  );
}

export function KickOff({ at, tz }: { at: Date; tz: string }) {
  return <time dateTime={at.toISOString()}>{formatInTz(at, tz)}</time>;
}

/** The combined probability, shown prominently and honestly ("1 in N"). */
export function CombinedProb({ p, odds, priced, size, large = false }: { p: number; odds: number | null; priced: number; size: number; large?: boolean }) {
  return (
    <div>
      <div className={`${large ? "text-4xl" : "text-2xl"} font-bold tabular-nums`} data-testid="combined-prob">
        {probabilityLabel(p)}
      </div>
      <div className="text-xs muted">combined win probability · {oneInN(p)}</div>
      {odds ? (
        <div className="mt-1 text-sm">
          Combined odds <strong className="tabular-nums">{odds.toFixed(odds >= 100 ? 0 : 2)}</strong> <span className="muted">(best available prices)</span>
        </div>
      ) : (
        <div className="mt-1 text-xs muted">{priced > 0 ? `Odds available for ${priced}/${size} legs – no combined odds.` : "No bookmaker odds stored."}</div>
      )}
    </div>
  );
}

export function StatusChip({ status }: { status: string }) {
  const map: Record<string, string> = {
    ACTIVE: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
    LOCKED: "border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-700 dark:bg-sky-950 dark:text-sky-300",
    WON: "border-emerald-500 bg-emerald-600 text-white",
    LOST: "border-red-500 bg-red-600 text-white",
    VOID: "border-slate-400 bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
    SUPERSEDED: "border-slate-300 bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
    PENDING: "border-slate-300 bg-slate-50 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
  };
  const label: Record<string, string> = { LOCKED: "In play / awaiting results", ACTIVE: "Active" };
  return <span className={`chip ${map[status] ?? ""}`}>{label[status] ?? status.charAt(0) + status.slice(1).toLowerCase()}</span>;
}

import { COMBO } from "@config/admin";
import { SPORTS } from "@/lib/sports";
import { WINDOW_DAYS } from "@/lib/time";

export interface FilterValues {
  sports: string[];
  league?: string;
  days: string[];
  minConf?: string;
  size?: string;
  strategy: string;
  kalshi: boolean;
}

export function ComboFilters({ values, leagues }: { values: FilterValues; leagues: Array<{ id: string; name: string; sportId: string }> }) {
  return (
    <form method="get" action="/combos" className="card space-y-4 p-4" aria-label="Combo filters" data-testid="combo-filters">
      <div className="grid gap-4 md:grid-cols-4">
        <fieldset>
          <legend className="mb-1 text-xs font-semibold uppercase tracking-wide muted">Sports (none = all)</legend>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1">
            {Object.values(SPORTS).map((s) => (
              <label key={s.id} className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" name="sport" value={s.id} defaultChecked={values.sports.includes(s.id)} />
                <span aria-hidden>{s.icon}</span>
                {s.name}
              </label>
            ))}
          </div>
        </fieldset>
        {WINDOW_DAYS > 1 ? (
          <fieldset>
            <legend className="mb-1 text-xs font-semibold uppercase tracking-wide muted">Day</legend>
            <div className="flex flex-col gap-1">
              {["1", "2", "3"].slice(0, WINDOW_DAYS).map((d) => (
                <label key={d} className="flex items-center gap-1.5 text-sm">
                  <input type="checkbox" name="day" value={d} defaultChecked={values.days.includes(d)} />
                  Day {d} {d === "1" ? "(today)" : d === "2" ? "(tomorrow)" : "(day after)"}
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}
        <div className="space-y-3">
          <label className="block text-sm">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide muted">League</span>
            <select name="league" className="field" defaultValue={values.league ?? ""}>
              <option value="">All leagues</option>
              {leagues.map((l) => (
                <option key={l.id} value={l.id}>
                  {SPORTS[l.sportId as keyof typeof SPORTS]?.icon} {l.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide muted">Minimum leg confidence</span>
            <select name="minConf" className="field" defaultValue={values.minConf ?? ""}>
              <option value="">Any</option>
              {[50, 55, 60, 65, 70, 75, 80, 85, 90].map((p) => (
                <option key={p} value={p}>
                  {p}%+
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="space-y-3">
          <label className="block text-sm">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide muted">
              Legs ({COMBO.MIN_SIZE}–{COMBO.MAX_SIZE})
            </span>
            <input name="size" type="number" min={COMBO.MIN_SIZE} max={COMBO.MAX_SIZE} step={1} placeholder="e.g. 10" className="field" defaultValue={values.size ?? ""} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide muted">Selection</span>
            <select name="strategy" className="field" defaultValue={values.strategy}>
              <option value="TOP">Top probability</option>
              <option value="DIVERSIFIED">Diversified (spread over sports/leagues)</option>
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" name="kalshi" value="1" defaultChecked={values.kalshi} data-testid="kalshi-only" />
            Only games listed on Kalshi
          </label>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="submit" className="btn btn-primary">
          Build combo
        </button>
        <a href="/combos" className="btn">
          Reset
        </a>
      </div>
    </form>
  );
}

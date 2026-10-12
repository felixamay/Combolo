import Link from "next/link";
import { SPORTS } from "@/lib/sports";
import { getEnv } from "@/lib/env";
import { TIMEZONE_OPTIONS } from "@/lib/timezones";
import { ThemeToggle } from "./ThemeToggle";
import { TimezoneSelect } from "./TimezoneSelect";

const nav = [
  { href: "/", label: "Home" },
  { href: "/combos", label: "Combos" },
  { href: "/rankings", label: "Rankings" },
  { href: "/history", label: "History" },
  { href: "/about-model", label: "Model" },
];

export function Header({ tz }: { tz: string }) {
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur dark:border-slate-800 dark:bg-slate-950/90">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <Link href="/" className="text-lg font-bold tracking-tight text-brand-700 dark:text-brand-500">
          {getEnv().SITE_NAME}
        </Link>
        <nav aria-label="Main" className="flex flex-wrap gap-x-4 gap-y-1 text-sm font-medium">
          {nav.map((n) => (
            <Link key={n.href} href={n.href} className="text-slate-700 hover:text-brand-700 dark:text-slate-300 dark:hover:text-brand-500">
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <TimezoneSelect current={tz} options={TIMEZONE_OPTIONS} />
          <ThemeToggle />
        </div>
      </div>
      <nav aria-label="Sports" className="border-t border-slate-100 dark:border-slate-900">
        <ul className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4 py-1.5 text-sm">
          {Object.values(SPORTS).map((s) => (
            <li key={s.id}>
              <Link href={`/sport/${s.slug}`} className="flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 hover:bg-slate-100 dark:hover:bg-slate-800">
                <span aria-hidden>{s.icon}</span>
                {s.name}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}

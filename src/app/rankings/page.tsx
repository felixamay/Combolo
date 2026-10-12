import Link from "next/link";
import { FreshnessBar, PageTitle } from "@/components/ui";
import { getFreshness } from "@/lib/queries";
import { SPORTS } from "@/lib/sports";

export const dynamic = "force-dynamic";
export const metadata = { title: "Rankings & standings" };

export default async function RankingsIndex() {
  const fresh = await getFreshness();
  return (
    <div>
      <PageTitle title="Rankings & standings" subtitle="League tables for team sports, ATP / WTA rankings for tennis. Snapshots are stored daily." />
      <FreshnessBar f={fresh} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Object.values(SPORTS).map((s) => (
          <Link key={s.id} href={`/rankings/${s.slug}`} className="card flex items-center gap-3 p-4 hover:border-brand-500">
            <span className="text-2xl" aria-hidden>
              {s.icon}
            </span>
            <span className="font-semibold">{s.name}</span>
            <span className="ml-auto text-sm muted">{s.individual ? "Rankings" : "Standings"}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

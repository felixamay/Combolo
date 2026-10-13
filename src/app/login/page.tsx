import { redirect } from "next/navigation";
import { LoginForm } from "@/components/LoginForm";
import { PageTitle } from "@/components/ui";
import { authEnabled } from "@/lib/auth/firebase-admin";
import { currentUser } from "@/lib/auth/session";
import { single } from "@/lib/request";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const next = single((await searchParams).next);
  if (await currentUser()) redirect(next && next.startsWith("/") && !next.startsWith("//") ? next : "/");
  return (
    <div className="space-y-5">
      <PageTitle title="Sign in" subtitle="An account lets you create combos on Kalshi from this site. Browsing and copying combos needs no account." />
      {authEnabled() ? <LoginForm next={next} /> : <p className="card p-4 text-sm">Sign-in is not configured on this site.</p>}
    </div>
  );
}

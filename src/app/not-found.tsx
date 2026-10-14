import Link from "next/link";

export default function NotFound() {
  return (
    <div className="card mx-auto max-w-md p-6 text-center">
      <h1 className="text-xl font-semibold">Not found</h1>
      <p className="mt-2 text-sm muted">That page, match or combo does not exist (matches and superseded combos are pruned after a while).</p>
      <Link href="/" className="btn btn-primary mt-4">
        Back to home
      </Link>
    </div>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function AgeGate({ minAge, siteName }: { minAge: number; siteName: string }) {
  const router = useRouter();
  const [denied, setDenied] = useState(false);
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="age-title" className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/90 p-4" data-testid="age-gate">
      <div className="card max-w-md p-6 text-center">
        <h2 id="age-title" className="text-xl font-semibold">
          Are you {minAge} or older?
        </h2>
        <p className="mt-2 text-sm muted">
          {siteName} shows statistical estimates about sports combinations. It is intended for adults aged {minAge}+ only and does not accept bets.
        </p>
        {denied ? (
          <p className="mt-4 text-sm text-red-600 dark:text-red-400" role="alert">
            Sorry, you must be {minAge} or older to use this site.
          </p>
        ) : (
          <div className="mt-5 flex justify-center gap-3">
            <button
              className="btn btn-primary"
              onClick={() => {
                document.cookie = "combolo_age_ok=1; path=/; max-age=31536000; samesite=lax";
                router.refresh();
              }}
            >
              Yes, I am {minAge}+
            </button>
            <button className="btn" onClick={() => setDenied(true)}>
              No
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

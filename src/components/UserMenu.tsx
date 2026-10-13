"use client";

import { useState } from "react";

export function SignOutButton() {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="btn"
      disabled={busy}
      data-testid="sign-out"
      onClick={async () => {
        setBusy(true);
        await fetch("/api/auth/session", { method: "DELETE" }).catch(() => null);
        window.location.reload();
      }}
    >
      Sign out
    </button>
  );
}

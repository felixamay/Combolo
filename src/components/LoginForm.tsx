"use client";

import { useState } from "react";
import { FirebaseError } from "firebase/app";
import { GoogleAuthProvider, createUserWithEmailAndPassword, sendPasswordResetEmail, signInWithEmailAndPassword, signInWithPopup, updateProfile } from "firebase/auth";
import { clientAuth, establishSession } from "@/lib/auth/firebase-client";

const MESSAGES: Record<string, string> = {
  "auth/invalid-credential": "Wrong email or password.",
  "auth/user-not-found": "Wrong email or password.",
  "auth/wrong-password": "Wrong email or password.",
  "auth/invalid-email": "That email address is not valid.",
  "auth/email-already-in-use": "An account with this email already exists. Sign in instead.",
  "auth/weak-password": "Use a password of at least 6 characters.",
  "auth/popup-closed-by-user": "The Google window was closed before signing in.",
  "auth/popup-blocked": "Your browser blocked the Google window. Allow pop-ups for this site and try again.",
  "auth/too-many-requests": "Too many attempts. Wait a moment and try again.",
  "auth/user-disabled": "This account has been disabled.",
};

function message(e: unknown): string {
  if (e instanceof FirebaseError) return MESSAGES[e.code] ?? "Sign-in failed. Please try again.";
  return e instanceof Error ? e.message : "Sign-in failed. Please try again.";
}

/** Only same-site paths are allowed as a post-login destination. */
function safeNext(next: string | undefined): string {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

export function LoginForm({ next }: { next?: string }) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const finish = async () => {
    await establishSession();
    window.location.assign(safeNext(next));
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
    } catch (e) {
      setError(message(e));
      setBusy(false);
    }
  };

  const google = () =>
    run(async () => {
      await signInWithPopup(clientAuth(), new GoogleAuthProvider());
      await finish();
    });

  const submit = (ev: React.FormEvent) => {
    ev.preventDefault();
    void run(async () => {
      if (mode === "signup") {
        const cred = await createUserWithEmailAndPassword(clientAuth(), email, password);
        if (name.trim()) await updateProfile(cred.user, { displayName: name.trim() });
        await cred.user.getIdToken(true);
      } else {
        await signInWithEmailAndPassword(clientAuth(), email, password);
      }
      await finish();
    });
  };

  const reset = () =>
    run(async () => {
      if (!email) throw new Error("Enter your email address first.");
      await sendPasswordResetEmail(clientAuth(), email);
      setNotice("If an account exists for that email, a reset link is on its way.");
      setBusy(false);
    });

  return (
    <div className="card mx-auto max-w-sm space-y-4 p-5" data-testid="login-form">
      <button type="button" className="btn w-full" onClick={google} disabled={busy} data-testid="login-google">
        Continue with Google
      </button>
      <div className="flex items-center gap-3 text-xs muted">
        <span className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
        or with email
        <span className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
      </div>
      <form onSubmit={submit} className="space-y-3">
        {mode === "signup" ? (
          <label className="block text-sm">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide muted">Name (optional)</span>
            <input className="field" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          </label>
        ) : null}
        <label className="block text-sm">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide muted">Email</span>
          <input className="field" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" data-testid="login-email" />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide muted">Password</span>
          <input className="field" type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "signup" ? "new-password" : "current-password"} data-testid="login-password" />
        </label>
        <button type="submit" className="btn btn-primary w-full" disabled={busy} data-testid="login-submit">
          {busy ? "Please wait…" : mode === "signup" ? "Create account" : "Sign in"}
        </button>
      </form>
      {error ? (
        <p className="text-sm text-red-700 dark:text-red-300" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="text-sm text-emerald-800 dark:text-emerald-300" role="status">
          {notice}
        </p>
      ) : null}
      <div className="flex flex-wrap justify-between gap-2 text-sm">
        <button type="button" className="underline" onClick={() => setMode(mode === "signin" ? "signup" : "signin")} data-testid="login-toggle">
          {mode === "signin" ? "Create an account" : "I already have an account"}
        </button>
        {mode === "signin" ? (
          <button type="button" className="underline muted" onClick={reset} disabled={busy}>
            Forgot password?
          </button>
        ) : null}
      </div>
    </div>
  );
}

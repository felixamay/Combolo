"use client";

import { getApp, getApps, initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth, inMemoryPersistence, setPersistence, type Auth } from "firebase/auth";

/**
 * Browser Firebase Auth. The browser only signs in to obtain an ID token; the server turns it into an httpOnly
 * session cookie, so Firebase's own client persistence is disabled (in-memory).
 */
let auth: Auth | undefined;

export function clientAuth(): Auth {
  if (auth) return auth;
  const app = getApps().length
    ? getApp()
    : initializeApp({
        apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
        authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
        projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
        appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
      });
  auth = getAuth(app);
  const emulator = process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST;
  if (emulator) connectAuthEmulator(auth, `http://${emulator}`, { disableWarnings: true });
  void setPersistence(auth, inMemoryPersistence);
  return auth;
}

/** Post the fresh ID token to the server to start a session, then drop the client-side Firebase state. */
export async function establishSession(): Promise<void> {
  const a = clientAuth();
  const user = a.currentUser;
  if (!user) throw new Error("Not signed in");
  const idToken = await user.getIdToken();
  const res = await fetch("/api/auth/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ idToken }) });
  await a.signOut();
  if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `Sign-in failed (${res.status})`);
}

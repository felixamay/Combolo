import { cache } from "react";
import { cookies } from "next/headers";
import type { User } from "@prisma/client";
import { prisma } from "../db";
import { getEnv } from "../env";
import { log } from "../log";
import { adminAuth, authEnabled } from "./firebase-admin";

export const SESSION_COOKIE = "combolo_session";

/** A fresh sign-in is required to start a session (Firebase's recommendation against replayed ID tokens). */
const MAX_SIGN_IN_AGE_S = 5 * 60;

export interface SessionStart {
  cookie: string;
  maxAgeS: number;
  user: User;
}

/** Exchange a Firebase ID token from a fresh sign-in for a session cookie and upsert the user row. */
export async function startSession(idToken: string, nowS = Math.floor(Date.now() / 1000)): Promise<SessionStart> {
  const auth = adminAuth();
  const decoded = await auth.verifyIdToken(idToken, true);
  if (nowS - decoded.auth_time > MAX_SIGN_IN_AGE_S) throw new Error("sign-in is too old; sign in again");
  const maxAgeS = getEnv().SESSION_DAYS * 86400;
  const cookie = await auth.createSessionCookie(idToken, { expiresIn: maxAgeS * 1000 });
  const profile = { email: decoded.email ?? null, name: (decoded.name as string | undefined) ?? null, photoUrl: decoded.picture ?? null };
  const user = await prisma.user.upsert({
    where: { firebaseUid: decoded.uid },
    create: { firebaseUid: decoded.uid, ...profile },
    update: { ...profile, lastLoginAt: new Date() },
  });
  return { cookie, maxAgeS, user };
}

/** Revoke every session of the user behind a cookie (sign out everywhere). Invalid cookies are ignored. */
export async function endSession(cookie: string | undefined): Promise<void> {
  if (!cookie || !authEnabled()) return;
  try {
    const decoded = await adminAuth().verifySessionCookie(cookie);
    await adminAuth().revokeRefreshTokens(decoded.sub);
  } catch {
    // already invalid
  }
}

/** The signed-in user for this request, or null. Revoked or expired sessions count as signed out. */
export const currentUser = cache(async (): Promise<User | null> => {
  if (!authEnabled()) return null;
  const cookie = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!cookie) return null;
  try {
    const decoded = await adminAuth().verifySessionCookie(cookie, true);
    return await prisma.user.findUnique({ where: { firebaseUid: decoded.uid } });
  } catch (e) {
    log.debug(`session rejected: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
});

/** Same-origin check for cookie-setting POST/DELETE requests (CSRF defence on top of SameSite=Lax). */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

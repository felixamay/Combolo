import { NextResponse } from "next/server";
import { z } from "zod";
import { authEnabled } from "@/lib/auth/firebase-admin";
import { SESSION_COOKIE, endSession, sameOrigin, startSession } from "@/lib/auth/session";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";

const body = z.object({ idToken: z.string().min(20) });

/** Sign in: the browser posts the Firebase ID token of a fresh sign-in and receives an httpOnly session cookie. */
export async function POST(req: Request) {
  if (!authEnabled()) return NextResponse.json({ error: "Sign-in is not configured." }, { status: 503 });
  if (!sameOrigin(req)) return NextResponse.json({ error: "Cross-site request refused." }, { status: 403 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  try {
    const { cookie, maxAgeS, user } = await startSession(parsed.data.idToken);
    const res = NextResponse.json({ user: { email: user.email, name: user.name } });
    res.cookies.set(SESSION_COOKIE, cookie, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: maxAgeS });
    return res;
  } catch (e) {
    log.warn(`sign-in refused: ${e instanceof Error ? e.message : String(e)}`);
    return NextResponse.json({ error: "Sign-in could not be verified. Please try again." }, { status: 401 });
  }
}

/** Sign out: revoke the user's Firebase sessions and clear the cookie. */
export async function DELETE(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "Cross-site request refused." }, { status: 403 });
  const cookie = req.headers.get("cookie")?.match(new RegExp(`(?:^|; )${SESSION_COOKIE}=([^;]+)`))?.[1];
  await endSession(cookie ? decodeURIComponent(cookie) : undefined);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 0 });
  return res;
}

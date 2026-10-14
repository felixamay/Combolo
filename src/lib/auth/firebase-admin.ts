import { readFileSync } from "node:fs";
import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getEnv } from "../env";

/**
 * Firebase Admin, used only to verify sign-ins and mint/verify session cookies. Credentials come from either
 * FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY or a service-account JSON file (FIREBASE_SERVICE_ACCOUNT_PATH).
 * With FIREBASE_AUTH_EMULATOR_HOST set, the Auth emulator is used and no credentials are needed.
 */

function projectId(): string | undefined {
  const env = getEnv();
  return env.FIREBASE_PROJECT_ID ?? env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
}

/** Sign-in is offered only when both the browser config and server credentials (or the emulator) are present. */
export function authEnabled(): boolean {
  const env = getEnv();
  const server = !!env.FIREBASE_AUTH_EMULATOR_HOST || !!env.FIREBASE_SERVICE_ACCOUNT_PATH || (!!env.FIREBASE_CLIENT_EMAIL && !!env.FIREBASE_PRIVATE_KEY);
  return !!env.NEXT_PUBLIC_FIREBASE_API_KEY && !!projectId() && server;
}

let app: App | undefined;

export function adminAuth(): Auth {
  if (!app) {
    const env = getEnv();
    const existing = getApps().find((a) => a.name === "combolo");
    if (existing) app = existing;
    else if (env.FIREBASE_AUTH_EMULATOR_HOST) app = initializeApp({ projectId: projectId() }, "combolo");
    else if (env.FIREBASE_SERVICE_ACCOUNT_PATH) app = initializeApp({ credential: cert(JSON.parse(readFileSync(env.FIREBASE_SERVICE_ACCOUNT_PATH, "utf8"))), projectId: projectId() }, "combolo");
    else
      app = initializeApp(
        { credential: cert({ projectId: projectId(), clientEmail: env.FIREBASE_CLIENT_EMAIL, privateKey: env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n") }), projectId: projectId() },
        "combolo",
      );
  }
  return getAuth(app);
}

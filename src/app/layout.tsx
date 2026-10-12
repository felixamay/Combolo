import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AgeGate } from "@/components/AgeGate";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { getEnv } from "@/lib/env";
import { ageGateRequired, getTz } from "@/lib/request";
import "./globals.css";

export function generateMetadata(): Metadata {
  const env = getEnv();
  return {
    title: { default: `${env.SITE_NAME} – data-driven combo analysis`, template: `%s · ${env.SITE_NAME}` },
    description: "Multi-leg combo (accumulator / parlay) analysis built from real head-to-head statistics, rankings and form. Informational only – no bets are taken.",
    metadataBase: new URL(env.SITE_URL),
  };
}

const themeScript = `try{var t=localStorage.getItem('theme');if(t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.classList.add('dark')}catch(e){}`;

export default async function RootLayout({ children }: { children: ReactNode }) {
  const env = getEnv();
  const tz = await getTz();
  const gate = await ageGateRequired();
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-screen">
        {gate ? <AgeGate minAge={env.AGE_GATE_MIN_AGE} siteName={env.SITE_NAME} /> : null}
        <Header tz={tz} />
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
        <Footer />
      </body>
    </html>
  );
}

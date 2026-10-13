import { createHash, createPrivateKey, sign, constants, type KeyObject } from "node:crypto";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { getEnv } from "../env";
import { callProvider } from "./http";
import { parseDate } from "./util";

/**
 * Kalshi trade API v2. Market data (series, events, markets, combo collections) is public and needs no key.
 * Creating a combo market (POST /multivariate_event_collections/{ticker}) is authenticated: every request is
 * signed with the operator's API key (RSA-PSS SHA-256 or Ed25519 over `timestamp + METHOD + path`).
 * Kalshi caps combo creation at 5,000 per user per week.
 */

export function kalshiEnabled(): boolean {
  return getEnv().FEATURE_KALSHI;
}

/** True when an API key id and a private key are configured, i.e. combos can be created on Kalshi. */
export function kalshiCanCreate(): boolean {
  const env = getEnv();
  return env.FEATURE_KALSHI && !!env.KALSHI_API_KEY_ID && !!(env.KALSHI_PRIVATE_KEY || env.KALSHI_PRIVATE_KEY_PATH);
}

let cachedKey: KeyObject | undefined;

function privateKey(): KeyObject {
  if (cachedKey) return cachedKey;
  const env = getEnv();
  const pem = env.KALSHI_PRIVATE_KEY ? env.KALSHI_PRIVATE_KEY.replace(/\\n/g, "\n") : env.KALSHI_PRIVATE_KEY_PATH ? readFileSync(env.KALSHI_PRIVATE_KEY_PATH, "utf8") : undefined;
  if (!pem) throw new Error("Kalshi private key is not configured (KALSHI_PRIVATE_KEY or KALSHI_PRIVATE_KEY_PATH)");
  cachedKey = createPrivateKey(pem);
  return cachedKey;
}

/** Kalshi request signature: base64 of the key's signature over `timestamp + METHOD + path` (path without query). */
export function signRequest(key: KeyObject, timestampMs: string, method: string, path: string): string {
  const message = Buffer.from(`${timestampMs}${method.toUpperCase()}${path}`);
  if (key.asymmetricKeyType === "ed25519") return sign(null, message, key).toString("base64");
  return sign("sha256", message, { key, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: constants.RSA_PSS_SALTLEN_DIGEST }).toString("base64");
}

function authHeaders(method: string, url: URL): Record<string, string> {
  const ts = String(Date.now());
  return {
    "KALSHI-ACCESS-KEY": getEnv().KALSHI_API_KEY_ID ?? "",
    "KALSHI-ACCESS-TIMESTAMP": ts,
    "KALSHI-ACCESS-SIGNATURE": signRequest(privateKey(), ts, method, url.pathname),
  };
}

/* ------------------------------------------------------------------------ */
/* Combo collection                                                          */
/* ------------------------------------------------------------------------ */

const collectionSchema = z.object({
  multivariate_contract: z.looseObject({
    collection_ticker: z.string(),
    size_min: z.number().nullish(),
    size_max: z.number().nullish(),
    associated_event_tickers: z.array(z.string()).nullish(),
    associated_events: z.array(z.looseObject({ ticker: z.string() })).nullish(),
  }),
});

export interface KalshiCollection {
  ticker: string;
  /** Inclusive leg bounds; null = no limit. */
  sizeMin: number | null;
  sizeMax: number | null;
  eventTickers: Set<string>;
}

export async function fetchCollection(ticker = getEnv().KALSHI_COLLECTION): Promise<KalshiCollection> {
  const res = await callProvider({
    provider: "kalshi",
    scope: "read",
    url: `${getEnv().KALSHI_API_BASE}/multivariate_event_collections/${encodeURIComponent(ticker)}`,
    endpoint: "/multivariate_event_collections/{ticker}",
    schema: collectionSchema,
    maxWaitMs: 60_000,
  });
  const c = res.data.multivariate_contract;
  const tickers = c.associated_events?.map((e) => e.ticker) ?? c.associated_event_tickers ?? [];
  return {
    ticker: c.collection_ticker,
    sizeMin: c.size_min && c.size_min > 0 ? c.size_min : null,
    sizeMax: c.size_max && c.size_max > 0 ? c.size_max : null,
    eventTickers: new Set(tickers),
  };
}

/* ------------------------------------------------------------------------ */
/* Game events                                                               */
/* ------------------------------------------------------------------------ */

const marketRow = z.looseObject({
  ticker: z.string(),
  event_ticker: z.string(),
  status: z.string(),
  yes_sub_title: z.string().nullish(),
  yes_ask_dollars: z.union([z.string(), z.number()]).nullish(),
  yes_bid_dollars: z.union([z.string(), z.number()]).nullish(),
  occurrence_datetime: z.string().nullish(),
  expected_expiration_time: z.string().nullish(),
  close_time: z.string().nullish(),
});

const eventsSchema = z.object({
  events: z.array(z.looseObject({ event_ticker: z.string(), series_ticker: z.string(), title: z.string(), markets: z.array(marketRow).nullish() })),
  cursor: z.string().nullish(),
});

export interface KalshiOutcome {
  ticker: string;
  /** Participant name ("Chelsea", "Los Angeles D", "Tommy Paul") or "Tie". */
  name: string;
  yesAsk: number | null;
  yesBid: number | null;
}

export interface KalshiGame {
  seriesTicker: string;
  eventTicker: string;
  title: string;
  /** Scheduled start as published by Kalshi (tennis uses a date placeholder, so matching allows a wide window). */
  startsAt: Date;
  outcomes: KalshiOutcome[];
}

/** Dollar price in (0, 1); 0 / 1 / missing mean "no offer". */
export function price(v: string | number | null | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 && n < 1 ? n : null;
}

export async function fetchGames(series: string): Promise<KalshiGame[]> {
  const out: KalshiGame[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 10; page++) {
    const res = await callProvider({
      provider: "kalshi",
      scope: "read",
      url: `${getEnv().KALSHI_API_BASE}/events`,
      endpoint: "/events",
      query: { series_ticker: series, status: "open", with_nested_markets: "true", limit: 200, cursor },
      schema: eventsSchema,
      maxWaitMs: 60_000,
    });
    for (const e of res.data.events) {
      const markets = (e.markets ?? []).filter((m) => m.status === "active" && m.yes_sub_title);
      const when = markets.map((m) => parseDate(m.occurrence_datetime ?? m.expected_expiration_time ?? m.close_time ?? "")).find((d): d is Date => !!d);
      if (!when || markets.length < 2) continue;
      out.push({
        seriesTicker: e.series_ticker,
        eventTicker: e.event_ticker,
        title: e.title,
        startsAt: when,
        outcomes: markets.map((m) => ({ ticker: m.ticker, name: m.yes_sub_title as string, yesAsk: price(m.yes_ask_dollars), yesBid: price(m.yes_bid_dollars) })),
      });
    }
    cursor = res.data.cursor || undefined;
    if (!cursor) break;
  }
  return out;
}

/* ------------------------------------------------------------------------ */
/* Combo creation                                                            */
/* ------------------------------------------------------------------------ */

export interface ComboLegInput {
  eventTicker: string;
  marketTicker: string;
}

const createSchema = z.looseObject({
  event_ticker: z.string(),
  market_ticker: z.string(),
  market: z.looseObject({ yes_ask_dollars: z.union([z.string(), z.number()]).nullish() }).nullish(),
});

export interface CreatedCombo {
  eventTicker: string;
  marketTicker: string;
  yesAsk: number | null;
}

/** Stable key for a set of legs (order-independent; the sports collection is unordered). */
export function legsKey(legs: ComboLegInput[]): string {
  return createHash("sha1").update(legs.map((l) => l.marketTicker).sort().join(",")).digest("hex");
}

export async function createCombo(legs: ComboLegInput[], collection = getEnv().KALSHI_COLLECTION): Promise<CreatedCombo> {
  if (!kalshiCanCreate()) throw new Error("Kalshi API key is not configured");
  const res = await callProvider({
    provider: "kalshi",
    scope: "create",
    method: "POST",
    url: `${getEnv().KALSHI_API_BASE}/multivariate_event_collections/${encodeURIComponent(collection)}`,
    endpoint: "POST /multivariate_event_collections/{ticker}",
    body: { selected_markets: legs.map((l) => ({ event_ticker: l.eventTicker, market_ticker: l.marketTicker, side: "yes" })), with_market_payload: true },
    signHeaders: authHeaders,
    schema: createSchema,
    maxWaitMs: 10_000,
  });
  return { eventTicker: res.data.event_ticker, marketTicker: res.data.market_ticker, yesAsk: price(res.data.market?.yes_ask_dollars) };
}

/** Public Kalshi page for a series (event-level deep links need a title slug Kalshi does not expose in the API). */
export function seriesUrl(seriesTicker: string): string {
  return `https://kalshi.com/markets/${seriesTicker.toLowerCase()}`;
}

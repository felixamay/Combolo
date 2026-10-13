import { z } from "zod";

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? def : ["1", "true", "yes", "on"].includes(v.toLowerCase())));

const optStr = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== "" ? v.trim() : undefined));

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  DEFAULT_TIMEZONE: z.string().default("America/Chicago"),
  SITE_NAME: z.string().default("Combolo"),
  SITE_URL: z.string().default("http://localhost:3000"),

  APISPORTS_KEY: optStr,
  APISPORTS_SHARED_QUOTA: bool(false),
  APISPORTS_DAILY_LIMIT: z.coerce.number().int().positive().default(100),
  APISPORTS_MINUTE_LIMIT: z.coerce.number().int().positive().default(10),
  FOOTBALL_DATA_KEY: optStr,
  FOOTBALL_DATA_MINUTE_LIMIT: z.coerce.number().int().positive().default(10),
  HIGHLIGHTLY_KEY: optStr,
  HIGHLIGHTLY_DAILY_LIMIT: z.coerce.number().int().positive().default(100),
  HIGHLIGHTLY_MINUTE_LIMIT: z.coerce.number().int().positive().default(20),
  THESPORTSDB_KEY: z.string().default("3"),
  THESPORTSDB_MINUTE_LIMIT: z.coerce.number().int().positive().default(25),
  API_TENNIS_KEY: optStr,
  API_TENNIS_MONTHLY_LIMIT: z.coerce.number().int().positive().default(1000),
  API_TENNIS_DAILY_BUDGET: z.coerce.number().int().positive().default(30),
  LIVE_TENNIS_API_KEY: optStr,
  LIVE_TENNIS_DAILY_LIMIT: z.coerce.number().int().positive().default(100),
  LIVE_TENNIS_MINUTE_LIMIT: z.coerce.number().int().positive().default(30),

  TENNIS_COMMERCIAL_MODE: bool(false),
  SACKMANN_ATP_BASE_URL: z.string().default("https://raw.githubusercontent.com/JeffSackmann/tennis_atp/master"),
  SACKMANN_WTA_BASE_URL: z.string().default("https://raw.githubusercontent.com/JeffSackmann/tennis_wta/master"),
  TENNIS_BACKFILL_DAYS: z.coerce.number().int().min(0).max(1500).default(120),
  TENNIS_BACKFILL_CALLS_PER_RUN: z.coerce.number().int().min(0).max(100).default(6),
  SACKMANN_HISTORY_YEARS: z.coerce.number().int().min(1).max(30).default(6),

  FEATURE_ODDS: bool(false),
  ODDS_API_KEY: optStr,
  ODDS_API_MONTHLY_LIMIT: z.coerce.number().int().positive().default(500),
  ODDS_API_DAILY_BUDGET: z.coerce.number().int().positive().default(15),
  ODDS_API_REGIONS: z.string().default("us,eu"),

  FEATURE_KALSHI: bool(true),
  KALSHI_API_BASE: z.string().default("https://api.elections.kalshi.com/trade-api/v2"),
  KALSHI_COLLECTION: z.string().default("KXMVESPORTSMULTIGAMEEXTENDED-R"),
  KALSHI_API_KEY_ID: optStr,
  /** PEM text (literal "\n" sequences are accepted) – or use KALSHI_PRIVATE_KEY_PATH. */
  KALSHI_PRIVATE_KEY: optStr,
  KALSHI_PRIVATE_KEY_PATH: optStr,
  KALSHI_MINUTE_LIMIT: z.coerce.number().int().positive().default(300),
  /** Kalshi allows 5,000 combo creations per week per user; this keeps a daily share of that. */
  KALSHI_DAILY_CREATE_LIMIT: z.coerce.number().int().positive().default(600),

  AGE_GATE_ENABLED: bool(true),
  AGE_GATE_MIN_AGE: z.coerce.number().int().min(18).max(25).default(18),
  CRON_SECRET: optStr,
  QUOTA_SAFETY_RESERVE: z.coerce.number().int().min(0).default(3),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function getEnv(): Env {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      throw new Error(
        "Invalid environment configuration: " +
          parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
      );
    }
    cached = parsed.data;
  }
  return cached;
}

export function resetEnvCache() {
  cached = undefined;
}

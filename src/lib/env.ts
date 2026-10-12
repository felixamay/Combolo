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
  SACKMANN_HISTORY_YEARS: z.coerce.number().int().min(1).max(30).default(6),

  FEATURE_ODDS: bool(false),
  ODDS_API_KEY: optStr,
  ODDS_API_MONTHLY_LIMIT: z.coerce.number().int().positive().default(500),
  ODDS_API_DAILY_BUDGET: z.coerce.number().int().positive().default(15),
  ODDS_API_REGIONS: z.string().default("us,eu"),

  AGE_GATE_ENABLED: bool(true),
  AGE_GATE_MIN_AGE: z.coerce.number().int().min(18).max(25).default(18),
  CRON_SECRET: optStr,
  RUN_WORKER_JOBS: bool(true),
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

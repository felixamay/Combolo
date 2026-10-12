/**
 * Admin configuration. Everything an operator may want to tune without touching code lives here:
 * league priority (which leagues get API quota first), model weights, combo defaults and
 * provider product definitions.
 */
import type { SportId } from "../src/lib/sports";

/* ------------------------------------------------------------------------ */
/* League / tournament priority                                              */
/* ------------------------------------------------------------------------ */

export interface LeaguePriorityRule {
  sport: SportId;
  /** Case-insensitive regular expression tested against "<country> <league name>". */
  pattern: string;
  /** Higher = served first when quota is scarce. */
  score: number;
}

export const LEAGUE_PRIORITY: LeaguePriorityRule[] = [
  // Football
  { sport: "football", pattern: "uefa champions league", score: 100 },
  { sport: "football", pattern: "england.*premier league|^premier league", score: 98 },
  { sport: "football", pattern: "spain.*la liga|primera division|laliga", score: 96 },
  { sport: "football", pattern: "italy.*serie a", score: 94 },
  { sport: "football", pattern: "germany.*bundesliga(?!\\s*2)|^bundesliga$", score: 93 },
  { sport: "football", pattern: "france.*ligue 1", score: 92 },
  { sport: "football", pattern: "uefa europa league", score: 90 },
  { sport: "football", pattern: "conference league", score: 85 },
  { sport: "football", pattern: "world cup|euro championship|nations league", score: 88 },
  { sport: "football", pattern: "netherlands.*eredivisie|portugal.*primeira|primeira liga", score: 80 },
  { sport: "football", pattern: "usa.*(major league soccer|mls)|^mls", score: 78 },
  { sport: "football", pattern: "brazil.*serie a|campeonato brasileiro", score: 76 },
  { sport: "football", pattern: "england.*championship", score: 74 },
  { sport: "football", pattern: "copa libertadores|copa sudamericana", score: 72 },
  { sport: "football", pattern: "argentina.*(liga profesional|primera)|mexico.*liga mx", score: 65 },
  // Basketball
  { sport: "basketball", pattern: "\\bnba\\b", score: 100 },
  { sport: "basketball", pattern: "euroleague", score: 90 },
  { sport: "basketball", pattern: "wnba|ncaa|ncaab", score: 80 },
  { sport: "basketball", pattern: "acb|liga endesa|bbl|lnb|lega a|nbl|eurocup|vtb|bsl", score: 65 },
  // Ice hockey
  { sport: "hockey", pattern: "\\bnhl\\b", score: 100 },
  { sport: "hockey", pattern: "khl|shl|liiga|del\\b|ahl", score: 75 },
  // Baseball
  { sport: "baseball", pattern: "\\bmlb\\b|major league baseball", score: 100 },
  { sport: "baseball", pattern: "npb|kbo|cpbl|ncaa", score: 70 },
  // American football
  { sport: "american-football", pattern: "\\bnfl\\b", score: 100 },
  { sport: "american-football", pattern: "ncaa|college", score: 80 },
  // Rugby / volleyball / handball
  { sport: "rugby", pattern: "six nations|rugby championship|world cup|premiership|top 14|urc|united rugby|super rugby|champions cup", score: 80 },
  { sport: "volleyball", pattern: "champions league|serie a|superliga|plusliga|nations league", score: 70 },
  { sport: "handball", pattern: "champions league|bundesliga|starligue|asobal|ehf", score: 70 },
  // Tennis
  { sport: "tennis", pattern: "grand slam|australian open|roland garros|french open|wimbledon|us open", score: 100 },
  { sport: "tennis", pattern: "masters|atp finals|wta finals|wta 1000|atp 1000", score: 90 },
  { sport: "tennis", pattern: "atp|wta", score: 70 },
];

export const DEFAULT_LEAGUE_SCORE = 10;

export function leaguePriority(sport: SportId, leagueName: string, country?: string | null): number {
  const hay = `${country ?? ""} ${leagueName}`.toLowerCase();
  let best = DEFAULT_LEAGUE_SCORE;
  for (const r of LEAGUE_PRIORITY) {
    if (r.sport !== sport) continue;
    if (r.score > best && new RegExp(r.pattern, "i").test(hay)) best = r.score;
  }
  return best;
}

/* ------------------------------------------------------------------------ */
/* Provider products                                                         */
/* ------------------------------------------------------------------------ */

export interface ApiSportsProduct {
  scope: string;
  sport: SportId;
  host: string;
  /** Path used for the by-date listing. */
  listPath: "/fixtures" | "/games";
  h2hPath: "/fixtures/headtohead" | "/games/h2h";
  /** Max standings calls per day for this product. */
  standingsBudget: number;
  /** Max H2H calls per day for this product. */
  h2hBudget: number;
}

export const APISPORTS_PRODUCTS: ApiSportsProduct[] = [
  { scope: "football", sport: "football", host: "v3.football.api-sports.io", listPath: "/fixtures", h2hPath: "/fixtures/headtohead", standingsBudget: 25, h2hBudget: 45 },
  { scope: "basketball", sport: "basketball", host: "v1.basketball.api-sports.io", listPath: "/games", h2hPath: "/games/h2h", standingsBudget: 10, h2hBudget: 60 },
  { scope: "hockey", sport: "hockey", host: "v1.hockey.api-sports.io", listPath: "/games", h2hPath: "/games/h2h", standingsBudget: 10, h2hBudget: 60 },
  { scope: "baseball", sport: "baseball", host: "v1.baseball.api-sports.io", listPath: "/games", h2hPath: "/games/h2h", standingsBudget: 10, h2hBudget: 60 },
  { scope: "american-football", sport: "american-football", host: "v1.american-football.api-sports.io", listPath: "/games", h2hPath: "/games/h2h", standingsBudget: 10, h2hBudget: 60 },
  { scope: "rugby", sport: "rugby", host: "v1.rugby.api-sports.io", listPath: "/games", h2hPath: "/games/h2h", standingsBudget: 10, h2hBudget: 60 },
  { scope: "handball", sport: "handball", host: "v1.handball.api-sports.io", listPath: "/games", h2hPath: "/games/h2h", standingsBudget: 10, h2hBudget: 60 },
  { scope: "volleyball", sport: "volleyball", host: "v1.volleyball.api-sports.io", listPath: "/games", h2hPath: "/games/h2h", standingsBudget: 10, h2hBudget: 60 },
];

export interface HighlightlyProduct {
  scope: string;
  sport: SportId;
  host: string;
  standingsBudget: number;
  h2hBudget: number;
}

/** One Highlightly subscription (and therefore one free 100/day bucket) per host. */
export const HIGHLIGHTLY_PRODUCTS: HighlightlyProduct[] = [
  { scope: "soccer", sport: "football", host: "soccer.highlightly.net", standingsBudget: 15, h2hBudget: 40 },
  { scope: "nba", sport: "basketball", host: "nba.highlightly.net", standingsBudget: 4, h2hBudget: 40 },
  { scope: "basketball", sport: "basketball", host: "basketball.highlightly.net", standingsBudget: 10, h2hBudget: 40 },
  { scope: "nhl", sport: "hockey", host: "nhl.highlightly.net", standingsBudget: 4, h2hBudget: 40 },
  { scope: "hockey", sport: "hockey", host: "hockey.highlightly.net", standingsBudget: 10, h2hBudget: 40 },
  { scope: "baseball", sport: "baseball", host: "baseball.highlightly.net", standingsBudget: 10, h2hBudget: 40 },
  { scope: "american-football", sport: "american-football", host: "american-football.highlightly.net", standingsBudget: 10, h2hBudget: 40 },
  { scope: "rugby", sport: "rugby", host: "rugby.highlightly.net", standingsBudget: 10, h2hBudget: 40 },
  { scope: "volleyball", sport: "volleyball", host: "volleyball.highlightly.net", standingsBudget: 10, h2hBudget: 40 },
  { scope: "handball", sport: "handball", host: "handball.highlightly.net", standingsBudget: 10, h2hBudget: 40 },
];

/** The 12 competitions of football-data.org's free tier. */
export const FOOTBALL_DATA_FREE_COMPETITIONS = ["WC", "CL", "BL1", "DED", "BSA", "PD", "FL1", "ELC", "PPL", "EC", "SA", "PL"] as const;

/** TheSportsDB sport names (used for schedules, badges and names only). */
export const THESPORTSDB_SPORTS: Record<SportId, string> = {
  football: "Soccer",
  basketball: "Basketball",
  tennis: "Tennis",
  hockey: "Ice Hockey",
  baseball: "Baseball",
  "american-football": "American Football",
  rugby: "Rugby",
  volleyball: "Volleyball",
  handball: "Handball",
};

/** The Odds API sport-key prefixes we are willing to spend credits on, per sport, in priority order. */
export const ODDS_API_SPORT_KEYS: Array<{ sport: SportId; keyPattern: string }> = [
  { sport: "football", keyPattern: "^soccer_(epl|spain_la_liga|italy_serie_a|germany_bundesliga|france_ligue_one|uefa_champs_league|uefa_europa_league|usa_mls|netherlands_eredivisie|efl_champ)$" },
  { sport: "basketball", keyPattern: "^basketball_(nba|euroleague|wnba)$" },
  { sport: "hockey", keyPattern: "^icehockey_nhl$" },
  { sport: "baseball", keyPattern: "^baseball_mlb$" },
  { sport: "american-football", keyPattern: "^americanfootball_(nfl|ncaaf)$" },
  { sport: "tennis", keyPattern: "^tennis_(atp|wta)_" },
  { sport: "rugby", keyPattern: "^rugbyunion_" },
  { sport: "handball", keyPattern: "^handball_" },
];

/* ------------------------------------------------------------------------ */
/* Prediction model                                                          */
/* ------------------------------------------------------------------------ */

export const MODEL_VERSION = "combolo-1.0";

export interface ModelConfig {
  /** Blend weights (logit space). Missing components are dropped and weights renormalised. */
  weights: { strength: number; elo: number; h2h: number; form: number };
  /** Home advantage in log-odds per sport. */
  homeAdvantage: Record<SportId, number>;
  /** Base draw probability for draw sports when teams are evenly matched. */
  drawBase: Partial<Record<SportId, number>>;
  /** Controls how fast draw probability falls as the rating gap grows. */
  drawDecay: number;
  /** Recency half-life (in meetings) for H2H weighting. */
  h2hHalfLifeMeetings: number;
  /** Prior strength (pseudo-meetings at 50/50) that shrinks small H2H samples. */
  h2hPrior: number;
  /** Form window (last N results) and prior strength. */
  formWindow: number;
  formPrior: number;
  /** Final temperature on the combined logit (<1 shrinks toward 50/50 to curb over-confidence). */
  temperature: number;
  /** Probability never reported beyond these bounds. */
  clamp: [number, number];
  /** Elo parameters. */
  elo: { initial: number; k: number; kTennis: number; surfaceBlend: number; homeAdvantagePoints: number; scale: number };
  /** Minimum number of data components needed to publish a pick. */
  minComponents: number;
}

export const MODEL: ModelConfig = {
  weights: { strength: 0.6, elo: 0.85, h2h: 0.35, form: 0.4 },
  homeAdvantage: {
    football: 0.28,
    basketball: 0.3,
    tennis: 0,
    hockey: 0.18,
    baseball: 0.14,
    "american-football": 0.24,
    rugby: 0.35,
    volleyball: 0.25,
    handball: 0.3,
  },
  drawBase: { football: 0.27, rugby: 0.04, handball: 0.08 },
  drawDecay: 0.55,
  h2hHalfLifeMeetings: 4,
  h2hPrior: 2,
  formWindow: 8,
  formPrior: 3,
  temperature: 0.95,
  clamp: [0.03, 0.97],
  elo: { initial: 1500, k: 24, kTennis: 32, surfaceBlend: 0.6, homeAdvantagePoints: 55, scale: 400 },
  minComponents: 1,
};

/* ------------------------------------------------------------------------ */
/* Combos                                                                    */
/* ------------------------------------------------------------------------ */

export const COMBO = {
  MIN_SIZE: 7,
  MAX_SIZE: 32,
  /** Sizes generated automatically after every refresh. */
  SIZES: [7, 10, 12, 15, 20, 25, 32],
  WINDOW_DAYS: 3,
  /** Probability threshold used for the "banker" tag in the UI only. */
  HIGH_CONFIDENCE: 0.7,
} as const;

/** Help resources shown on the responsible-gambling page, footer and every combo. */
export const HELP_RESOURCES = [
  { name: "National Problem Gambling Helpline (US)", phone: "1-800-GAMBLER (1-800-426-2537)", url: "https://www.ncpgambling.org/help-treatment/" },
  { name: "GamCare (UK)", phone: "0808 8020 133", url: "https://www.gamcare.org.uk/" },
  { name: "Gamblers Anonymous", phone: "", url: "https://www.gamblersanonymous.org/" },
  { name: "BeGambleAware", phone: "", url: "https://www.begambleaware.org/" },
];

/** Provider attribution as required by their terms. */
export const ATTRIBUTIONS = [
  { id: "sackmann", name: "Jeff Sackmann – Tennis Abstract (tennis_atp / tennis_wta / Match Charting Project)", url: "https://github.com/JeffSackmann", licence: "CC BY-NC-SA 4.0", note: "Non-commercial use only. Attribution required; derived data must be shared alike. Disabled when TENNIS_COMMERCIAL_MODE=true." },
  { id: "apisports", name: "API-Sports", url: "https://api-sports.io", licence: "Provider terms", note: "Fixtures, standings and head-to-head data for football and other sports." },
  { id: "footballdata", name: "football-data.org", url: "https://www.football-data.org", licence: "Provider terms", note: "Football fixtures, standings and head-to-head data." },
  { id: "highlightly", name: "Highlightly", url: "https://highlightly.net", licence: "Provider terms", note: "Multi-sport matches, standings and head-to-head data." },
  { id: "thesportsdb", name: "TheSportsDB", url: "https://www.thesportsdb.com", licence: "Provider terms / CC BY-NC", note: "Team names, badges and schedules." },
  { id: "apitennis", name: "API-Tennis.com", url: "https://api-tennis.com", licence: "Provider terms", note: "Tennis results, rankings and odds." },
  { id: "livetennis", name: "Live Tennis API", url: "https://livetennisapi.com", licence: "Provider terms", note: "Tennis fixtures, surfaces and player rankings." },
  { id: "oddsapi", name: "The Odds API", url: "https://the-odds-api.com", licence: "Provider terms", note: "Bookmaker odds (only when enabled)." },
];

# Combolo

Multi-leg combo (accumulator / parlay) analysis built from **real** head-to-head statistics, standings/rankings and
form across nine sports. It shows every number behind a pick and **takes no bets** – it is an informational tool.

* Stack: Next.js 16 (App Router) · TypeScript · Tailwind 4 · PostgreSQL + Prisma 6 · Firebase Auth (optional) · node-cron / Vercel Cron · Zod · Vitest · Playwright
* No mock data anywhere in the production path. Test fixtures live only under `tests/`.
* All page reads come from the database. Pages never call a provider; scheduled jobs do, through one quota manager.

## What it does

| Rule | How it is enforced |
|------|--------------------|
| Window: matches starting after now and before **midnight today** in the viewer's time zone (same-day combos; `WINDOW_DAYS` in `src/lib/time.ts`) (default `America/Chicago`, selectable in the header) | `src/lib/time.ts` + `filterEligible`/`validateCombo` in `src/lib/combos/engine.ts`; started matches are locked out of active combos by `expireStarted` on every results/refresh run |
| 7–32 legs; sizes 7, 10, 12, 15, 20, 25, 32 are generated automatically, any size 7–32 can be built in the custom builder | `COMBO` in `config/admin.ts`, `isValidSize`, `generateStoredCombos`, `buildLive` |
| One leg per match, never both sides | engine keeps one candidate per match; `ComboLeg @@unique([comboId, matchId])` in the database; `validateCombo` before every insert |
| Single-sport and mixed combos, sport-labelled legs, filters (sport, league, day 1/2/3, min confidence, size, strategy) | `/combos`, `/sport/[slug]` |
| Not enough eligible matches → say so, never pad | e.g. *"Only 9 eligible tennis matches today – a 12-leg combo needs 12. Nothing was padded."* |
| Pick + probability per leg, prominent combined probability ("1 in N"), combined odds only if **every** leg has a real stored price | `CombinedProb`, `summarise` |
| Regenerated after every refresh, stored with timestamps, history kept, legs marked won/lost | `Combo` lifecycle `ACTIVE → SUPERSEDED / LOCKED → WON / LOST / VOID`; `/history` shows hit rate per size |

Pages: Home · per-sport pages (fixtures by day and league, picks, combos) · Combos (mixed + custom builder with filters) ·
Combo detail · Match detail (standings, form, Elo, full H2H table, model breakdown, odds) · Rankings/standings ·
History (hit rate per combo size) · About the model (measured back-test accuracy) · Data sources & attribution ·
Responsible gambling. Responsive, dark/light mode, age gate (`AGE_GATE_ENABLED`, `AGE_GATE_MIN_AGE=18|21`), responsible-gambling
notice in the footer and on every combo.

## Quick start (local)

Requirements: Node 22+, PostgreSQL 14+.

```bash
git clone <repo> && cd Combolo
npm install
cp .env.example .env              # set DATABASE_URL and the provider keys you have
createdb combolo                  # or point DATABASE_URL at Supabase / Neon
npm run setup                     # migrate + bootstrap: history, fixtures, standings, H2H, ratings, predictions, combos
npm run dev                       # http://localhost:3000
npm run worker                    # (separate terminal) keeps data fresh on the schedule below
```

`npm run setup` is idempotent. It prints which provider keys are missing and ends with a summary such as
*"71 upcoming matches in the 3-day window, 31 with an eligible prediction, 16 active combos"*. A run with **no keys at all** only
loads TheSportsDB schedules (names/times, no standings or H2H), so it correctly reports zero eligible predictions and zero
combos – combos need at least standings, ratings or form on both sides of a match.

Run any single job: `npm run job -- <name>` where `<name>` is one of
`refresh results fixtures standings h2h form model odds kalshi combos backtest tennis-history tennis-backfill cleanup bootstrap`.

## Provider keys – where to get them

| Provider | Used for | Get a key | Free-tier limits the app respects |
|----------|----------|-----------|-----------------------------------|
| football-data.org v4 | football fixtures/results/standings/H2H (12 competitions) | https://www.football-data.org/client/register | 10 requests/minute, unlimited per day. `FOOTBALL_DATA_KEY` |
| API-Sports | fixtures, standings, H2H for football, basketball, hockey, baseball, american football, rugby, handball, volleyball | https://dashboard.api-sports.io/register | 100 requests/day **per sport API**, 10/min. `APISPORTS_KEY`, set `APISPORTS_SHARED_QUOTA=true` if your dashboard shows one shared counter |
| Highlightly | fallback/gap filler for matches, standings, H2H, last-five | https://highlightly.net/documentation | 100 requests/day per product subscription. `HIGHLIGHTLY_KEY` |
| TheSportsDB | names, badges and schedules only | free public key `3` (no signup) | ~15 events per day per sport on the free key (premium key lifts it). `THESPORTSDB_KEY` |
| API-Tennis | tennis fixtures/results (history backfill), rankings, H2H, odds | https://api-tennis.com | ~1,000 requests/month → daily budget `API_TENNIS_DAILY_BUDGET=30`. `API_TENNIS_KEY` |
| Live Tennis API | tennis fixtures, surfaces, player rankings | https://livetennisapi.com | 100/day, 30/min. `LIVE_TENNIS_API_KEY` |
| Jeff Sackmann CSVs | tennis history (optional) | no key | CC BY-NC-SA 4.0 – **non-commercial only**; see below |
| Kalshi | game-winner market prices and combo (multivariate) markets | public data: no key. Creating combos: API key from kalshi.com → Account & security | combo creation is capped by Kalshi at 5,000/week → `KALSHI_DAILY_CREATE_LIMIT=600`. `KALSHI_API_KEY_ID`, `KALSHI_PRIVATE_KEY` |
| The Odds API (optional) | bookmaker odds, only with `FEATURE_ODDS=true` | https://the-odds-api.com | 500 credits/month → `ODDS_API_DAILY_BUDGET=15`. `ODDS_API_KEY` |

Every limit is configurable in `.env`; the values above are the documented/reported free-tier numbers at the time of writing
(verify them in your dashboard – providers change plans).

### Quota strategy

* `src/lib/quota/` is a central manager. **Every** outbound call goes through `callProvider()` (`src/lib/providers/http.ts`) which
  acquires quota first. Buckets are per provider/product with minute (rolling), day (UTC) and month (UTC) windows plus a safety reserve;
  acquisition is all-or-nothing across buckets and atomic across processes (Postgres advisory lock), so concurrent cron lambdas
  cannot overshoot.
* Rate-limit response headers are read (`x-ratelimit-*`, `X-Requests-Available-Minute`, `x-requests-remaining`, …); they can only
  *tighten* the local count. An HTTP 429 blocks the bucket until its window resets.
* Everything is cached in the database. H2H is fetched **once per pair** and refetched only when a new meeting is ingested (the
  record is flagged `stale`). Standings are fetched once per UTC day per league, highest-priority leagues first
  (`config/admin.ts → LEAGUE_PRIORITY`). Per-product budgets are in `APISPORTS_PRODUCTS` / `HIGHLIGHTLY_PRODUCTS`.
* Every call is logged to `ApiCallLog` (provider, endpoint, status, duration, remaining quota). `/data-sources` shows last success,
  calls today and last error per provider; pages show data freshness.

## Scheduled jobs

Defined once in `config/schedule.ts` (UTC):

| Job | Schedule | What it does |
|-----|----------|--------------|
| `refresh` | every 6 h (4×/day) | fixtures → standings/rankings → H2H → form gap fill → Elo/form/predictions → odds → Kalshi links → regenerate combos |
| `results` | hourly (:20) | football-data + API-Tennis results, lock combos whose first match started, settle legs/combos, refresh Kalshi prices |
| `tennis-backfill` | daily 03:30 | resumable API-Tennis history backfill (a few calls per run) |
| `tennis-history` | weekly | Sackmann CSV refresh (no-op in commercial mode or if the files are unavailable) |
| `backtest` | weekly | walk-forward back-test shown on "About the model" |
| `cleanup` | daily | prune old API logs, job runs and superseded combos |

* **Self-hosted / VPS / Docker:** `npm run worker` (node-cron, same definitions). On start it runs `refresh` if the last one is older than 7 h.
* **Vercel Cron:** `vercel.json` calls `/api/cron/<job>` (`Authorization: Bearer $CRON_SECRET`, which Vercel adds automatically when
  `CRON_SECRET` is set). **Vercel Hobby only allows one cron run per day** – on Hobby either upgrade, use the worker elsewhere, or use the
  bundled GitHub Actions workflow `.github/workflows/cron.yml` (set repo variable `USE_GITHUB_CRON=true` and secrets `APP_URL`, `CRON_SECRET`).
* Jobs are incremental and deadline-aware, overlapping runs of the same job are refused, and a failing step never stops the next one
  (combos are always rebuilt from whatever is stored).

## Deployment (Vercel + Supabase or Neon)

1. Create a Postgres database. **Supabase:** Project settings → Database → connection string (use the *pooled* string for the app;
   transaction-mode pooling is fine – the quota lock is transaction-scoped). **Neon:** copy the connection string (`?sslmode=require`).
2. Apply migrations from your machine or CI with the **direct** (non-pooled) URL: `DATABASE_URL="<direct url>" npm run db:migrate`.
3. Import the repo in Vercel, set the env vars from `.env.example` (at least `DATABASE_URL`, `CRON_SECRET`, `SITE_URL`, your provider keys).
   The build command is `npm run build` (generates the Prisma client, then `next build`).
4. Deploy, then seed the first data: run `DATABASE_URL="<url>" npm run setup` once from your machine (long-running; it can take minutes
   because of provider rate limits), or call `GET /api/cron/refresh` and `GET /api/cron/tennis-backfill` a few times with the bearer secret.
5. Make sure a scheduler is running (Vercel Cron on Pro, GitHub Actions, or `npm run worker` somewhere).

Function duration: cron endpoints set `maxDuration = 300`; jobs stop at their deadline and resume on the next run.

## Tennis data and the commercial-mode flag

* Tennis history is accumulated in our own database from **API-Tennis** results and (optionally) the **Jeff Sackmann** datasets
  (© Jeff Sackmann / Tennis Abstract, CC BY-NC-SA 4.0 – attribution is shown in the footer and on `/data-sources`; derived data must be shared alike).
* Set `TENNIS_COMMERCIAL_MODE=true` for any commercial deployment. The Sackmann importer is then skipped and rows from that source are
  excluded from Elo, H2H, predictions and every page. Elo is always computed by us from stored matches, never fetched.
* **Important finding (12 Oct 2026):** `github.com/JeffSackmann/tennis_atp` and `tennis_wta` currently return HTTP 404. The importer is kept
  and configurable (`SACKMANN_*_BASE_URL`, e.g. a mirror or fork) and logs the unavailability instead of failing, but with the default URLs
  tennis history comes from API-Tennis only (`TENNIS_BACKFILL_*`). `docs/INTEGRATION_PLAN.md` lists all provider findings.

## Kalshi combos

* The `kalshi` job (part of `refresh`, and of the hourly `results` run) reads Kalshi's sports combo collection
  (`KALSHI_COLLECTION`) and the open game-winner events of every series in `config/admin.ts → KALSHI_SERIES`, then links each
  event to one stored match by both participants' names and a plausible start time (`src/lib/ingest/kalshi-match.ts`). Kalshi
  uses short names ("Los Angeles D", "Sporting CP"); a pairing is only accepted when both sides agree and exactly one match fits.
  Links and YES prices are stored in `KalshiMarket` and replaced on every run.
* `/combos` → **Only games listed on Kalshi** builds combos solely from linked legs and shows the Kalshi slip: the market for
  each pick, its YES price, a **Copy combo** button and, when `KALSHI_API_KEY_ID` + private key are set, **Create on Kalshi**
  (`POST /api/kalshi/combo`), which creates the combo market with the operator's key (signed RSA-PSS/Ed25519 requests) and shows
  its ticker. Each exact set of legs is created once (`KalshiCombo`). Stored combo pages show the slip when every leg is listed.
* The site never places trades: users review Kalshi's own quote and buy from their own account.
* Kalshi covers NFL, NCAAF, NBA, WNBA, EuroLeague, NHL, MLB/KBO/NPB, major football leagues and ATP/WTA tennis — not rugby,
  handball or volleyball. Kalshi's API exposes no title slug for event pages, so leg links open the series page.

## Sign-in (Firebase Auth)

* Optional. With the `NEXT_PUBLIC_FIREBASE_*` web config and a service account (`FIREBASE_SERVICE_ACCOUNT_PATH`, or
  `FIREBASE_CLIENT_EMAIL` + `FIREBASE_PRIVATE_KEY`) set, the header shows **Sign in** and `/login` offers Google and
  email/password sign-in (with sign-up and password reset). Without them, the site runs exactly as before with no accounts.
* The browser signs in with the Firebase JS SDK only to get an ID token; `POST /api/auth/session` verifies it with
  Firebase Admin (fresh sign-ins only), sets an httpOnly `combolo_session` cookie (up to 14 days) and upserts a `User` row.
  `DELETE /api/auth/session` revokes the user's sessions. Both routes refuse cross-site requests.
* **Create on Kalshi** requires a signed-in user when sign-in is configured (it spends the operator's weekly Kalshi creation
  allowance); browsing and copying combos stay public. Created Kalshi combos record who created them.
* Local testing: run the Auth emulator and set `FIREBASE_AUTH_EMULATOR_HOST` / `NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST`
  (see `.env.example`); no Firebase project or credentials are needed.

## The model (`src/lib/model`, config in `config/admin.ts`)

Isolated, pure and unit-tested. Four components are converted to log-odds for the home side and blended with documented weights
(strength 0.6, Elo 0.85, H2H 0.35, form 0.4), plus per-sport home advantage and a 0.95 temperature:

* **Strength** – league points-per-game/win % and margin (team sports) or ATP/WTA rank + points (tennis).
* **Elo** – computed from every stored finished match; tennis blends overall and per-surface Elo; shrunk when few matches.
* **H2H** – recency-weighted (half-life 4 meetings) with a 2-meeting prior; surface-specific for tennis, home/away aware for team sports.
* **Form** – last 8 results with a prior.
* Football (and rugby/handball) get a three-way split; the draw probability shrinks as the rating gap grows.
* A match gets a pick only if standing/ranking, Elo or form exists for **both** sides – H2H alone never produces one. The component
  breakdown is stored and shown on the match page.

`npm run job -- backtest` replays stored finished matches walk-forward (Elo/form/H2H only from earlier matches) and records accuracy, Brier
score, log loss, the "most common result" baseline and calibration bins; "About the model" shows the latest values, or "No back-test has been
run yet (n = 0)" when there is no history. Standings are not back-tested (historical tables are not stored).

Combo selection: **top-probability** takes the highest-probability legs (this maximises the combined probability);
**diversified** caps legs per sport (⌈N / #sports⌉) and per league (max(2, 30 %)) and fills any shortfall with the next best legs.

## Tests

```bash
npm run typecheck
npm test                      # unit tests: quota manager, time window, combo rules, model, parsers, odds matching, name resolution
npm run test:integration      # Postgres-backed: combo lifecycle/settlement, ingestion merging, quota store (uses the *_test database)
npm run build && npm run test:e2e   # Playwright against a seeded *_test database (set CHROME_PATH to use a system Chrome)
```

* Integration and e2e tests **only** touch a database whose name ends in `_test` (`TEST_DATABASE_URL`, or `DATABASE_URL` + `_test`).
  Create it once: `createdb combolo_test && DATABASE_URL=postgresql://…/combolo_test npx prisma migrate deploy`.
* `tests/support/seed.ts` writes deterministic fixture inputs (teams, history, standings, schedule) and then runs the **real** ratings,
  prediction, combo-generation and settlement code. Nothing in `src/` or `scripts/` imports it.
* Covered: window rules (incl. DST), 7–32 size bounds, one leg per match (engine and DB constraint), never padding with the exact
  "Only 9 eligible tennis matches" message, started matches leaving active combos, settlement rules (any lost leg ⇒ LOST, cancelled leg ⇒ VOID),
  hit-rate statistics, quota never exceeded under concurrency (memory and Postgres stores), cross-provider merging, model sanity and back-test.

## Layout

```
config/            admin.ts (league priority, model weights, combo sizes, attribution), schedule.ts
prisma/            schema + migrations
scripts/           setup.ts, run-job.ts, worker.ts
src/app/           pages and /api/cron/[job]
src/components/    UI
src/jobs/          scheduled jobs and the runJob() registry
src/lib/combos/    pure engine + DB service (generate, lock, settle, history)
src/lib/ingest/    cross-provider entity resolution, upserts, H2H, odds matching
src/lib/model/     Elo, prediction, back-test, DB service
src/lib/providers/ one adapter per provider (Zod-validated)
src/lib/quota/     quota manager + Postgres store
tests/             unit/, integration/, e2e/, fixtures/, support/ (seed lives here only)
docs/              INTEGRATION_PLAN.md – provider verification and daily budgets
```

## Known limitations and honest caveats

* **API-Sports** documentation sits behind a Cloudflare challenge and could not be fetched automatically; its adapter follows the public
  v3 conventions with tolerant schemas and logs every validation failure. Check your first `refresh` run in `/data-sources` /
  `ApiCallLog` and report anything it rejects. The other providers were verified against their current documentation.
* The provider adapters were verified with fixture-based unit tests (shaped from the documentation), not against live paid APIs from
  this repository's CI – only TheSportsDB's free key was exercised live. Expect to tune parsing on your first real run.
* TheSportsDB's free key returns ~15 events per day per sport, so schedules alone are incomplete; use the keyed providers for full coverage.
* Combined probabilities multiply leg probabilities and therefore assume independence between matches.
* Combo `VOID` handling: a combo with a cancelled/postponed leg (or no result 72 h after kick-off) and no lost legs is recorded as VOID and
  excluded from hit-rate statistics.
* Probabilities are statistical estimates, not guarantees; the site does not accept bets or recommend operators.

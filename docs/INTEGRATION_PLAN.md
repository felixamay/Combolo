# Stage 1 – Provider verification and integration plan

Every provider below was checked against its **current** documentation on 12 Oct 2026
(OpenAPI documents where the provider publishes one). Where a provider's docs could not be
fetched (API-Sports sits behind a Cloudflare challenge) this is stated explicitly and the
integration is written defensively (tolerant Zod schemas, errors logged and surfaced).

## Findings that change the original brief

| # | Finding | Consequence |
|---|---------|-------------|
| 1 | `github.com/JeffSackmann/tennis_atp` and `tennis_wta` return **HTTP 404** (the account now only exposes `tennis_MatchChartingProject`). | The Sackmann importer is kept (CC BY-NC-SA, configurable `SACKMANN_*_BASE_URL`, auto-skips on 404 and logs it) but **tennis history is primarily built from API-Tennis `get_fixtures` results**, accumulated into our own `Match` table. Elo is computed from that table. If the Sackmann repos are restored or you point the env vars at a mirror, the importer loads them with zero code changes. |
| 2 | Live Tennis API free tier has **no completed-match history, no H2H, no rankings listing** (history = Basic $9.99+). It does expose free `/fixtures` (with surface, round, tournament) and `/players/{id}` (ranking, ranking points, ratings). | Used only for upcoming tennis fixtures + surface + player ranking. Never relied on for H2H. |
| 3 | Highlightly now has **one host per sport** (`soccer.`, `basketball.`, `hockey.`, `nba.`, `nhl.`, `baseball.`, `american-football.`, `rugby.`, `volleyball.`, `handball.` + `.highlightly.net`), header `x-rapidapi-key`, and **a free 100 req/day plan per product** (each subscription is independent). Matches / `head-2-head` / `last-five-games` / `standings` exist on every sport. | One generic adapter, one quota bucket per product host. |
| 4 | API-Tennis exposes `get_odds` (real bookmaker odds, key in query string `APIKey`). | Tennis odds come from API-Tennis when `FEATURE_ODDS=true` and the key has the odds entitlement. |
| 5 | TheSportsDB free events carry `idAPIfootball` (API-Football team/fixture id). | Used as a free cross-provider ID hint when mapping teams. |

## Provider matrix

| Provider | Base URL | Auth | Endpoints used | Free quota (verified / reported) | Daily budget used by app |
|----------|----------|------|----------------|----------------------------------|--------------------------|
| **API-Sports – football** | `https://v3.football.api-sports.io` | header `x-apisports-key` | `GET /fixtures?date=YYYY-MM-DD&timezone=UTC`, `GET /standings?league&season`, `GET /fixtures/headtohead?h2h=a-b&last=10` | 100/day **per product (each sport API has its own counter)**, 10/min – *not verifiable offline; manager also reads `x-ratelimit-requests-remaining` + `X-RateLimit-Remaining` headers and self-corrects; set `APISPORTS_SHARED_QUOTA=true` if your dashboard shows one shared counter* | 12 fixtures + 2 results + ≤25 standings + rest H2H, 10 reserved |
| **API-Sports – basketball / hockey / baseball / american-football / rugby / handball / volleyball** | `https://v1.<sport>.api-sports.io` | `x-apisports-key` | `GET /games?date=`, `GET /standings?league&season`, `GET /games/h2h?h2h=a-b` | same, per product | 8 fixtures + 2 results + ≤10 standings + H2H |
| **football-data.org v4** | `https://api.football-data.org/v4` | header `X-Auth-Token` | `GET /matches?dateFrom&dateTo` (all subscribed competitions in **one** call), `GET /competitions/{code}/standings`, `GET /matches/{id}/head2head?limit=10` | 10/min (free forever, 12 competitions) – reads `X-Requests-Available-Minute` | ~3 + 12 standings + H2H, minute-throttled |
| **Highlightly** | `https://<product>.highlightly.net` | header `x-rapidapi-key` | `GET /matches?date&timezone&limit&offset`, `GET /head-2-head?teamIdOne&teamIdTwo`, `GET /standings?leagueId&season`, `GET /last-five-games?teamId` | 100/day per product; response headers `x-ratelimit-requests-limit/remaining`; `limit` ≤ 100 | gap-filler / fallback |
| **TheSportsDB** | `https://www.thesportsdb.com/api/v1/json/{key}` | key in path (`3` free) | `GET /eventsday.php?d=&s=<Sport>` (fixtures, names, badges only) | ~30/min | ≤ 40/day |
| **API-Tennis** | `https://api.api-tennis.com/tennis/` | query `APIkey` | `?method=get_fixtures` (date range, optional `event_type_key`), `get_standings&event_type=ATP\|WTA`, `get_H2H`, `get_odds` | ~1,000 / **month** (as reported; verify in your dashboard) | ≤ 30/day, hard monthly cap |
| **Live Tennis API** | `https://api.livetennisapi.com/api/public/v1` | header `X-API-Key` | `GET /fixtures`, `GET /players/{id}`, `GET /usage` (quota-exempt) | 100/day, 30/min | ≤ 60/day |
| **Sackmann CSV** | `raw.githubusercontent.com/JeffSackmann/tennis_{atp,wta}/master` | none | `atp_matches_YYYY.csv`, `atp_players.csv`, `atp_rankings_current.csv` (same for WTA) | static files | 1 per file per day (ETag-checked) |
| **The Odds API** (optional, flagged) | `https://api.the-odds-api.com/v4` | query `apiKey` | `GET /sports` (free), `GET /sports/{key}/odds?regions&markets=h2h&oddsFormat=decimal` | 500 credits / month; headers `x-requests-remaining` | ≤ 15 credits/day |

## Request priority

1. Fixtures for UTC dates *today … today+3* (this always covers the 3-calendar-day window in any timezone) – 2–4 refreshes/day.
2. Standings/rankings for leagues in `config/admin.ts → LEAGUE_PRIORITY` (highest priority first), once per day.
3. H2H for upcoming matches with no cached record (or a stale one), ordered by league priority then kick-off.
4. Results catch-up (yesterday + today dates) which doubles as settlement input.

## Cross-provider merging

* `ExternalId(provider, scope, entityType, externalId) → entityId` maps every provider ID to one internal row.
* Teams/players resolve by (a) existing external ID, (b) TheSportsDB→API-Football ID hint, (c) normalised name within sport (+ tour for tennis), otherwise a new row is created.
* The same fixture from two providers is merged on `(sport, home, away, kick-off ± 3 h)`; the first provider to create it is `primarySource`, others only add IDs / fill gaps.

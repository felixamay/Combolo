/**
 * Deterministic TEST FIXTURES. Lives under tests/ on purpose: nothing in src/ or scripts/ imports this file.
 * It writes raw inputs (teams, history, standings, upcoming schedule) and then runs the REAL pipeline
 * (ratings -> predictions -> combo generation -> settlement), so the tests exercise production code.
 */
import "./test-db";
import { prisma } from "../../src/lib/db";
import { entityKey } from "../../src/lib/ingest/keys";
import { normName, playerKey } from "../../src/lib/ingest/names";
import { storeH2H } from "../../src/lib/ingest/h2h";
import { generateStoredCombos, settleCombos } from "../../src/lib/combos/service";
import { predictUpcoming, refreshRatings } from "../../src/lib/model/service";
import { ensureSports } from "../../src/lib/seed";
import { SPORTS, type SportId } from "../../src/lib/sports";
import { getComboWindow } from "../../src/lib/time";

export const SEED_TZ = "America/Chicago";

function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

export async function resetDatabase() {
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  const list = tables.map((t) => `"${t.tablename}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
}

interface TeamSpec {
  sport: SportId;
  teams: string[];
  upcoming: number;
  leagueName: string;
}

const TEAM_SPECS: TeamSpec[] = [
  { sport: "football", leagueName: "Test Premier Division", upcoming: 10, teams: ["Riverside", "Hillcrest", "Lakeview", "Northgate", "Southport", "Eastbrook", "Westfield", "Oakdale", "Stonebridge", "Fairhaven", "Ashford", "Kingsmere"].map((n) => `${n} FC`) },
  { sport: "basketball", leagueName: "Test Basketball League", upcoming: 8, teams: ["Harbor", "Summit", "Prairie", "Canyon", "Delta", "Ridge", "Valley", "Coast"].map((n) => `${n} Hoops`) },
  { sport: "hockey", leagueName: "Test Hockey League", upcoming: 4, teams: ["Glacier", "Frost", "Blizzard", "Tundra", "Aurora", "Polar"].map((n) => `${n} HC`) },
];

const PLAYERS = ["Adrian Vale", "Bruno Keller", "Caleb Marsh", "Diego Ferro", "Emil Novak", "Felix Hart", "Gustav Lind", "Hugo Brandt", "Ivan Petrov", "Jonas Weber", "Kian Moreau", "Luca Santoro"];

export interface SeedSummary {
  now: Date;
  upcoming: Record<string, number>;
  eligible: number;
  combos: Awaited<ReturnType<typeof generateStoredCombos>>;
}

export async function seedTestData(now = new Date()): Promise<SeedSummary> {
  await resetDatabase();
  await ensureSports();
  const rng = mulberry32(20261012);
  const window = getComboWindow(now, SEED_TZ);
  const snapshotDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const upcoming: Record<string, number> = {};
  const recentFinished: string[] = [];

  const slotTime = (i: number): Date => {
    const day = i % 3;
    if (day === 0) return new Date(now.getTime() + (window.days[0].end.getTime() - now.getTime()) / 2 + Math.floor(i / 3) * 60_000);
    return new Date(window.days[day].start.getTime() + 10 * 3600_000 + Math.floor(i / 3) * 25 * 60_000);
  };

  let slot = 0;
  for (const spec of TEAM_SPECS) {
    const meta = SPORTS[spec.sport];
    const league = await prisma.league.create({ data: { sportId: spec.sport, key: normName(spec.leagueName), name: spec.leagueName, country: "Testland", priority: 100 } });
    const teams = await Promise.all(spec.teams.map((name) => prisma.team.create({ data: { sportId: spec.sport, name, normName: normName(name) } })));
    const strength = teams.map(() => (rng() - 0.5) * 2.4);
    const table = teams.map(() => ({ w: 0, d: 0, l: 0, gf: 0, ga: 0, p: 0, form: [] as string[] }));

    const nHist = 220;
    for (let k = 0; k < nHist; k++) {
      const hi = Math.floor(rng() * teams.length);
      let ai = Math.floor(rng() * teams.length);
      if (ai === hi) ai = (ai + 1) % teams.length;
      const pHome = sigmoid(0.9 * (strength[hi] - strength[ai]) + 0.25);
      const pDraw = meta.hasDraw ? 0.24 : 0;
      const u = rng();
      const winner = u < pDraw ? "DRAW" : rng() < pHome ? "HOME" : "AWAY";
      const base = spec.sport === "football" ? 1 : spec.sport === "hockey" ? 2 : 90;
      const spread = spec.sport === "basketball" ? 12 : 2;
      let hs = Math.max(0, Math.round(base + rng() * spread + (winner === "HOME" ? 1 : 0)));
      let as = Math.max(0, Math.round(base + rng() * spread + (winner === "AWAY" ? 1 : 0)));
      if (winner === "DRAW") as = hs;
      else if (winner === "HOME" && hs <= as) hs = as + 1;
      else if (winner === "AWAY" && as <= hs) as = hs + 1;
      const startsAt = k < 8 && spec.sport === "football" ? new Date(now.getTime() - (2 + k * 3) * 3600_000) : new Date(now.getTime() - (1 + (k / nHist) * 120) * 86400_000 - rng() * 3600_000);
      const m = await prisma.match.create({
        data: { sportId: spec.sport, leagueId: league.id, startsAt, status: "FINISHED", homeTeamId: teams[hi].id, awayTeamId: teams[ai].id, homeName: teams[hi].name, awayName: teams[ai].name, homeScore: hs, awayScore: as, winner, primarySource: "test-fixture", isHistorical: true },
      });
      if (spec.sport === "football" && k < 8) recentFinished.push(m.id);
      const H = table[hi];
      const A = table[ai];
      H.gf += hs;
      H.ga += as;
      A.gf += as;
      A.ga += hs;
      if (winner === "DRAW") {
        H.d++;
        A.d++;
        H.p++;
        A.p++;
      } else if (winner === "HOME") {
        H.w++;
        A.l++;
        H.p += meta.hasDraw ? 3 : 2;
      } else {
        A.w++;
        H.l++;
        A.p += meta.hasDraw ? 3 : 2;
      }
    }
    const order = table.map((t, i) => ({ t, i })).sort((a, b) => b.t.p - a.t.p || b.t.gf - b.t.ga - (a.t.gf - a.t.ga));
    for (const [pos, { t, i }] of order.entries()) {
      await prisma.rankingSnapshot.create({
        data: { sportId: spec.sport, scopeKey: `league:${league.id}`, leagueId: league.id, entityType: "TEAM", entityKey: entityKey("TEAM", teams[i].id), name: teams[i].name, position: pos + 1, points: t.p, played: t.w + t.d + t.l, wins: t.w, draws: t.d, losses: t.l, goalsFor: t.gf, goalsAgainst: t.ga, season: "test", source: "test-fixture", snapshotDate },
      });
    }

    const used = new Set<string>();
    for (let k = 0; k < spec.upcoming; k++) {
      let hi = 0;
      let ai = 0;
      do {
        hi = Math.floor(rng() * teams.length);
        ai = Math.floor(rng() * teams.length);
      } while (hi === ai || used.has(`${hi}-${ai}`));
      used.add(`${hi}-${ai}`);
      await prisma.match.create({
        data: { sportId: spec.sport, leagueId: league.id, startsAt: slotTime(slot++), status: "SCHEDULED", homeTeamId: teams[hi].id, awayTeamId: teams[ai].id, homeName: teams[hi].name, awayName: teams[ai].name, primarySource: "test-fixture" },
      });
      await storeH2H(spec.sport, "TEAM", teams[hi].id, teams[ai].id, "test-fixture");
    }
    upcoming[spec.sport] = spec.upcoming;
  }

  // Tennis: 12 ATP players, surface-aware history, nine upcoming singles matches.
  const tennisLeague = await prisma.league.create({ data: { sportId: "tennis", key: "test open|atp", name: "Test Open", tour: "ATP", country: "Testland", priority: 100 } });
  const players = await Promise.all(PLAYERS.map((name) => prisma.player.create({ data: { sportId: "tennis", name, normKey: playerKey(name, "ATP"), tour: "ATP" } })));
  const skill = players.map(() => (rng() - 0.5) * 3);
  const surfaces = ["Hard", "Clay", "Grass"];
  for (let k = 0; k < 260; k++) {
    const a = Math.floor(rng() * players.length);
    let b = Math.floor(rng() * players.length);
    if (a === b) b = (b + 1) % players.length;
    const win = rng() < sigmoid(1.1 * (skill[a] - skill[b]));
    await prisma.match.create({
      data: {
        sportId: "tennis", leagueId: tennisLeague.id, startsAt: new Date(now.getTime() - (3 + (k / 260) * 200) * 86400_000), status: "FINISHED",
        homePlayerId: players[a].id, awayPlayerId: players[b].id, homeName: players[a].name, awayName: players[b].name,
        homeScore: win ? 2 : 1, awayScore: win ? 1 : 2, winner: win ? "HOME" : "AWAY", surface: surfaces[k % 3], neutralVenue: true, primarySource: "test-fixture", isHistorical: true,
      },
    });
  }
  const rankOrder = players.map((p, i) => ({ p, s: skill[i] })).sort((x, y) => y.s - x.s);
  for (const [pos, { p }] of rankOrder.entries()) {
    await prisma.rankingSnapshot.create({
      data: { sportId: "tennis", scopeKey: "tennis:ATP", entityType: "PLAYER", entityKey: entityKey("PLAYER", p.id), name: p.name, position: pos + 1, points: 9000 - pos * 600, source: "test-fixture", snapshotDate },
    });
  }
  const tennisUsed = new Set<string>();
  for (let k = 0; k < 9; k++) {
    let a = 0;
    let b = 0;
    do {
      a = Math.floor(rng() * players.length);
      b = Math.floor(rng() * players.length);
    } while (a === b || tennisUsed.has(`${a}-${b}`) || tennisUsed.has(`${b}-${a}`));
    tennisUsed.add(`${a}-${b}`);
    await prisma.match.create({
      data: { sportId: "tennis", leagueId: tennisLeague.id, startsAt: slotTime(slot++), status: "SCHEDULED", homePlayerId: players[a].id, awayPlayerId: players[b].id, homeName: players[a].name, awayName: players[b].name, surface: surfaces[k % 3], neutralVenue: true, primarySource: "test-fixture" },
    });
    await storeH2H("tennis", "PLAYER", players[a].id, players[b].id, "test-fixture");
  }
  upcoming.tennis = 9;

  for (const sport of ["football", "basketball", "hockey", "tennis"] as SportId[]) await refreshRatings(sport);
  const pred = await predictUpcoming(now, 5);
  const combos = await generateStoredCombos(now, SEED_TZ);

  // Two combos that already started and finished, settled by the real settlement code.
  const finished = await prisma.match.findMany({ where: { id: { in: recentFinished } } });
  if (finished.length >= 7) {
    const make = async (wrongLeg: boolean) => {
      const legs = finished.slice(0, 7);
      const times = legs.map((m) => m.startsAt.getTime());
      await prisma.combo.create({
        data: {
          kind: "SINGLE_SPORT", sportId: "football", size: 7, requestedSize: 7, strategy: "TOP", signature: `test-${wrongLeg ? "lost" : "won"}`,
          combinedProb: 0.05, minLegProb: 0.6, timezone: SEED_TZ, windowStart: new Date(Math.min(...times) - 86400_000), windowEnd: new Date(Math.max(...times) + 86400_000),
          firstLegStartsAt: new Date(Math.min(...times)), lastLegStartsAt: new Date(Math.max(...times)), status: "LOCKED",
          legs: { create: legs.map((m, i) => ({ matchId: m.id, position: i + 1, sportId: "football", leagueId: m.leagueId, pick: wrongLeg && i === 0 ? (m.winner === "HOME" ? "AWAY" : "HOME") : (m.winner as "HOME" | "AWAY" | "DRAW"), prob: 0.6, startsAt: m.startsAt })) },
        },
      });
    };
    await make(false);
    await make(true);
    await settleCombos(now);
  }

  await prisma.jobRun.create({ data: { name: "refresh", status: "ok", finishedAt: new Date(), summary: { seeded: "test fixtures" } } });
  return { now, upcoming, eligible: pred.eligible, combos };
}

if (process.argv[1]?.endsWith("seed.ts")) {
  seedTestData()
    .then((s) => {
      console.log(JSON.stringify(s, null, 2));
      return prisma.$disconnect();
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}

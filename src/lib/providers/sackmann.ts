import { parse } from "csv-parse/sync";
import { prisma } from "../db";
import { getEnv } from "../env";
import { log } from "../log";
import { bucketsFor, getQuotaManager } from "../quota/rules";
import type { NormFixture, NormParticipant } from "./types";

/**
 * Jeff Sackmann's tennis_atp / tennis_wta CSV datasets (CC BY-NC-SA 4.0 – non-commercial).
 *
 * NOTE (verified 12 Oct 2026): the upstream repositories currently answer HTTP 404. The loader is
 * therefore tolerant: a missing file is logged and skipped, and base URLs are configurable
 * (SACKMANN_ATP_BASE_URL / SACKMANN_WTA_BASE_URL) so a mirror can be used.
 * Files: `<tour>_matches_<year>.csv`, `<tour>_players.csv`, `<tour>_rankings_current.csv`.
 */

export type Tour = "atp" | "wta";

export function sackmannEnabled(): boolean {
  return !getEnv().TENNIS_COMMERCIAL_MODE;
}

function baseUrl(tour: Tour): string {
  const env = getEnv();
  return (tour === "atp" ? env.SACKMANN_ATP_BASE_URL : env.SACKMANN_WTA_BASE_URL).replace(/\/$/, "");
}

export type FetchTextResult = { status: "ok"; text: string; etag?: string } | { status: "not-modified" } | { status: "missing" } | { status: "denied"; reason: string };

async function fetchCsv(url: string): Promise<FetchTextResult> {
  const quota = getQuotaManager();
  const acquired = await quota.acquire(bucketsFor("sackmann", "csv"));
  if (!acquired.ok) return { status: "denied", reason: acquired.message };
  const kv = await prisma.keyValue.findUnique({ where: { key: `sackmann:etag:${url}` } });
  const etag = kv && typeof kv.value === "object" && kv.value && "etag" in kv.value ? String((kv.value as { etag: string }).etag) : undefined;
  const started = Date.now();
  let status: number | undefined;
  try {
    const res = await fetch(url, { headers: etag ? { "if-none-match": etag } : {} });
    status = res.status;
    if (res.status === 304) {
      await logCall(url, status, true, started);
      return { status: "not-modified" };
    }
    if (res.status === 404) {
      await logCall(url, status, false, started, "404 not found");
      return { status: "missing" };
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const newEtag = res.headers.get("etag") ?? undefined;
    if (newEtag) await prisma.keyValue.upsert({ where: { key: `sackmann:etag:${url}` }, create: { key: `sackmann:etag:${url}`, value: { etag: newEtag } }, update: { value: { etag: newEtag } } });
    await logCall(url, status, true, started);
    return { status: "ok", text, etag: newEtag };
  } catch (e) {
    await logCall(url, status, false, started, e instanceof Error ? e.message : String(e));
    throw e;
  }
}

async function logCall(url: string, httpStatus: number | undefined, ok: boolean, started: number, error?: string) {
  const u = new URL(url);
  await prisma.apiCallLog.create({ data: { provider: "sackmann", scope: "csv", endpoint: u.pathname.split("/").slice(-1)[0], params: u.hostname, httpStatus, ok, durationMs: Date.now() - started, error } });
}

const ROUND_DAY: Record<string, number> = { Q1: 0, Q2: 1, Q3: 2, RR: 0, R128: 0, R64: 1, R32: 2, R16: 3, QF: 5, SF: 6, BR: 6, F: 7 };

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function intOrNull(s: string | undefined): number | null {
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Count sets won from a Sackmann score string like "6-4 3-6 7-6(5)"; null when retired/walkover. */
export function setsFromScore(score: string): { winner: number; loser: number } | null {
  if (!score || /W\/O|DEF|ABD|UNP/i.test(score)) return null;
  let w = 0;
  let l = 0;
  for (const part of score.split(/\s+/)) {
    const m = part.match(/^(\d+)-(\d+)/);
    if (!m) continue;
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a > b) w++;
    else if (b > a) l++;
  }
  return w + l > 0 ? { winner: w, loser: l } : null;
}

export function parseMatchesCsv(tour: Tour, text: string): NormFixture[] {
  const records = parse(text, { columns: true, skip_empty_lines: true, relax_column_count: true, bom: true }) as Array<Record<string, string>>;
  const out: NormFixture[] = [];
  for (const r of records) {
    const date = r.tourney_date;
    if (!date || date.length !== 8 || !r.winner_id || !r.loser_id || !r.winner_name || !r.loser_name) continue;
    if (/W\/O/i.test(r.score ?? "")) continue;
    const id = `${r.tourney_id}-${r.match_num}`;
    const base = Date.UTC(Number(date.slice(0, 4)), Number(date.slice(4, 6)) - 1, Number(date.slice(6, 8)), 12);
    const startsAt = new Date(base + (ROUND_DAY[r.round] ?? 3) * 86400000 + (Number(r.match_num) || 0) * 1000);
    const winner: NormParticipant = { externalId: r.winner_id, name: r.winner_name, country: r.winner_ioc || null };
    const loser: NormParticipant = { externalId: r.loser_id, name: r.loser_name, country: r.loser_ioc || null };
    // Side assignment is hashed so the dataset does not systematically make the winner "home".
    const winnerHome = hash(id) % 2 === 0;
    const sets = setsFromScore(r.score ?? "");
    out.push({
      provider: "sackmann",
      scope: tour,
      externalId: id,
      sport: "tennis",
      league: { externalId: r.tourney_id.replace(/^\d{4}-/, ""), name: r.tourney_name, tour: tour.toUpperCase(), season: r.tourney_id.slice(0, 4) },
      round: r.round || null,
      startsAt,
      status: "FINISHED",
      home: winnerHome ? winner : loser,
      away: winnerHome ? loser : winner,
      homeScore: sets ? (winnerHome ? sets.winner : sets.loser) : null,
      awayScore: sets ? (winnerHome ? sets.loser : sets.winner) : null,
      winner: winnerHome ? "HOME" : "AWAY",
      surface: r.surface || null,
      bestOf: intOrNull(r.best_of),
      individual: true,
      neutralVenue: true,
      historical: true,
    });
  }
  return out;
}

export interface SackmannLoadResult {
  tour: Tour;
  year: number;
  status: FetchTextResult["status"];
  fixtures: NormFixture[];
  reason?: string;
}

/** Download (ETag-aware) and parse one season of one tour. */
export async function loadSeason(tour: Tour, year: number): Promise<SackmannLoadResult> {
  const url = `${baseUrl(tour)}/${tour}_matches_${year}.csv`;
  const res = await fetchCsv(url);
  if (res.status === "ok") return { tour, year, status: "ok", fixtures: parseMatchesCsv(tour, res.text) };
  if (res.status === "missing") log.warn(`Sackmann file not available: ${url}`);
  return { tour, year, status: res.status, fixtures: [], reason: res.status === "denied" ? res.reason : undefined };
}

export interface SackmannRankingRow {
  externalId: string;
  name: string;
  country: string | null;
  hand: string | null;
  birthDate: Date | null;
  position: number;
  points: number | null;
  rankingDate: string;
}

export async function loadRankings(tour: Tour): Promise<{ status: FetchTextResult["status"]; rows: SackmannRankingRow[] }> {
  const rankingsRes = await fetchCsv(`${baseUrl(tour)}/${tour}_rankings_current.csv`);
  if (rankingsRes.status !== "ok") return { status: rankingsRes.status, rows: [] };
  const playersRes = await fetchCsv(`${baseUrl(tour)}/${tour}_players.csv`);
  const players = new Map<string, Record<string, string>>();
  if (playersRes.status === "ok") {
    for (const p of parse(playersRes.text, { columns: true, skip_empty_lines: true, relax_column_count: true, bom: true }) as Array<Record<string, string>>) players.set(p.player_id, p);
  }
  const recs = parse(rankingsRes.text, { columns: true, skip_empty_lines: true, relax_column_count: true, bom: true }) as Array<Record<string, string>>;
  let latest = "";
  for (const r of recs) if (r.ranking_date > latest) latest = r.ranking_date;
  const rows: SackmannRankingRow[] = [];
  for (const r of recs) {
    if (r.ranking_date !== latest) continue;
    const p = players.get(r.player);
    if (!p) continue;
    const dob = p.dob && p.dob.length === 8 ? new Date(Date.UTC(+p.dob.slice(0, 4), +p.dob.slice(4, 6) - 1, +p.dob.slice(6, 8))) : null;
    rows.push({
      externalId: r.player,
      name: `${p.name_first} ${p.name_last}`.trim(),
      country: p.ioc || null,
      hand: p.hand || null,
      birthDate: dob,
      position: Number(r.rank),
      points: intOrNull(r.points),
      rankingDate: latest,
    });
  }
  return { status: "ok", rows };
}

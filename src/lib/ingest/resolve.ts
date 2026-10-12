import type { EntityType, Prisma } from "@prisma/client";
import { prisma } from "../db";
import type { NormLeague, NormParticipant } from "../providers/types";
import { LEAGUE_ALIASES, leaguePriority } from "../../../config/admin";
import type { ProviderId } from "../quota/rules";
import type { SportId } from "../sports";
import { leagueIdentity, normName, playerKey } from "./names";

/** Cross-provider entity resolution: provider IDs -> one internal entity. */
export class Resolver {
  private extCache = new Map<string, string>();

  private key(provider: string, scope: string, type: EntityType, externalId: string) {
    return `${provider}|${scope}|${type}|${externalId}`;
  }

  async lookupExternal(provider: ProviderId, scope: string, type: EntityType, externalId: string): Promise<string | null> {
    const k = this.key(provider, scope, type, externalId);
    const hit = this.extCache.get(k);
    if (hit) return hit;
    const row = await prisma.externalId.findUnique({ where: { provider_scope_entityType_externalId: { provider, scope, entityType: type, externalId } } });
    if (row) this.extCache.set(k, row.entityId);
    return row?.entityId ?? null;
  }

  async linkExternal(provider: ProviderId, scope: string, type: EntityType, externalId: string, entityId: string): Promise<void> {
    const k = this.key(provider, scope, type, externalId);
    if (this.extCache.get(k) === entityId) return;
    await prisma.externalId.upsert({
      where: { provider_scope_entityType_externalId: { provider, scope, entityType: type, externalId } },
      create: { provider, scope, entityType: type, externalId, entityId },
      update: {},
    });
    const row = await prisma.externalId.findUnique({ where: { provider_scope_entityType_externalId: { provider, scope, entityType: type, externalId } } });
    this.extCache.set(k, row!.entityId);
  }

  async league(provider: ProviderId, scope: string, sport: SportId, l: NormLeague): Promise<string> {
    const existing = await this.lookupExternal(provider, scope, "LEAGUE", l.externalId);
    if (existing) {
      if (l.logo || l.country) {
        await prisma.league.update({ where: { id: existing }, data: { ...(l.logo ? { logo: l.logo } : {}), ...(l.country ? { country: l.country } : {}) } }).catch(() => undefined);
      }
      return existing;
    }
    const id = leagueIdentity(l.name, l.country, LEAGUE_ALIASES);
    const tourPart = l.tour ? `|${l.tour.toLowerCase()}` : "";
    const key = `${id.base}${id.country ? `@${id.country}` : ""}${tourPart}`;
    const plainKey = `${id.base}${tourPart}`;
    const patch = { ...(l.logo ? { logo: l.logo } : {}), ...(l.country ? { country: l.country } : {}) };
    let row = await prisma.league.findUnique({ where: { sportId_key: { sportId: sport, key } } });
    if (!row && id.country) {
      // An earlier provider may have created the league before the country was known: adopt it.
      const bare = await prisma.league.findUnique({ where: { sportId_key: { sportId: sport, key: plainKey } } });
      if (bare) row = await prisma.league.update({ where: { id: bare.id }, data: { key, ...patch } });
    } else if (!row) {
      // No country known: reuse a country-qualified league only when the name identifies exactly one.
      const candidates = await prisma.league.findMany({ where: { sportId: sport, key: { startsWith: `${id.base}@` }, ...(l.tour ? { tour: l.tour } : {}) }, take: 2 });
      if (candidates.length === 1) row = candidates[0];
    }
    row ??= await prisma.league.create({
      data: { sportId: sport, key, name: l.name, country: l.country ?? null, tour: l.tour ?? null, logo: l.logo ?? null, priority: leaguePriority(sport, l.name, l.country) },
    });
    if (Object.keys(patch).length && row.country == null) row = await prisma.league.update({ where: { id: row.id }, data: patch });
    await this.linkExternal(provider, scope, "LEAGUE", l.externalId, row.id);
    return row.id;
  }

  /** Team (team sports) – resolves by external id, then normalised name within the sport. */
  async team(provider: ProviderId, scope: string, sport: SportId, p: NormParticipant): Promise<string> {
    const existing = await this.lookupExternal(provider, scope, "TEAM", p.externalId);
    if (existing) {
      if (p.logo) await prisma.team.updateMany({ where: { id: existing, logo: null }, data: { logo: p.logo } });
      return existing;
    }
    const nn = normName(p.name);
    let team = await prisma.team.findFirst({ where: { sportId: sport, normName: nn } });
    if (!team) {
      team = await prisma.team.create({ data: { sportId: sport, name: p.name, normName: nn, logo: p.logo ?? null, country: p.country ?? null } });
    } else if (p.logo && !team.logo) {
      await prisma.team.update({ where: { id: team.id }, data: { logo: p.logo } });
    }
    await this.linkExternal(provider, scope, "TEAM", p.externalId, team.id);
    return team.id;
  }

  /** Tennis player – resolves by external id, then by `<tour>|<initial>|<surname>` key. */
  async player(provider: ProviderId, scope: string, tour: string | null | undefined, p: NormParticipant): Promise<string> {
    const existing = await this.lookupExternal(provider, scope, "PLAYER", p.externalId);
    if (existing) {
      await this.enrichPlayer(existing, p);
      return existing;
    }
    const key = playerKey(p.name, tour);
    const candidates = await prisma.player.findMany({ where: { sportId: "tennis", normKey: key } });
    let player = candidates[0];
    if (!player) {
      player = await prisma.player.create({ data: { sportId: "tennis", name: p.name, normKey: key, tour: tour ?? null, country: p.country ?? null, photo: p.logo ?? null } });
    } else {
      await this.enrichPlayer(player.id, p, player.name);
    }
    await this.linkExternal(provider, scope, "PLAYER", p.externalId, player.id);
    return player.id;
  }

  private async enrichPlayer(id: string, p: NormParticipant, currentName?: string) {
    const data: Prisma.PlayerUpdateInput = {};
    if (p.country) data.country = p.country;
    if (p.logo) data.photo = p.logo;
    // Prefer a full first name over an abbreviated "M. Navone".
    const abbreviated = (n: string) => /^[A-Za-z]\.\s/.test(n);
    if (currentName && abbreviated(currentName) && !abbreviated(p.name)) data.name = p.name;
    if (Object.keys(data).length) await prisma.player.update({ where: { id }, data }).catch(() => undefined);
  }
}

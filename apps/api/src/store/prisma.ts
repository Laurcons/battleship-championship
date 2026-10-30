import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import type { GameEvent, GameSummary, Heatmap, Ruleset, Seat } from '@bsc/engine';
import { PrismaClient } from '../generated/prisma/client.js';
import type {
  AuditRow,
  ConnectionRow,
  GameMeta,
  GameRow,
  LobbyRow,
  ParticipantRow,
  RulesetRow,
  SeatOwnerRow,
  SeriesRow,
  Store,
  WebSessionRole,
  WebSessionRow,
} from './store.js';

const num = (v: bigint | number | null): number | null => (v === null ? null : Number(v));
const json = (v: unknown): string => JSON.stringify(v);

export interface PrismaStoreOptions {
  /** `mysql://user:password@host:port/database` */
  databaseUrl: string;
  connectionLimit?: number;
}

/** MariaDB persistence. Structured blobs are serialized by us, not stored in JSON columns. */
export class PrismaStore implements Store {
  private readonly prisma: PrismaClient;

  constructor(options: PrismaStoreOptions) {
    const url = new URL(options.databaseUrl);
    const adapter = new PrismaMariaDb({
      host: url.hostname,
      port: Number(url.port || 3306),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database: url.pathname.slice(1),
      connectionLimit: options.connectionLimit ?? 5,
    });
    this.prisma = new PrismaClient({ adapter });
  }

  async init(): Promise<void> {
    await this.prisma.$connect();
  }

  async close(): Promise<void> {
    await this.prisma.$disconnect();
  }

  // --- participants ----------------------------------------------------------------------------

  async listParticipants(): Promise<ParticipantRow[]> {
    const rows = await this.prisma.participant.findMany({ orderBy: { createdAt: 'asc' } });
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      tokenHash: r.tokenHash,
      tokenPreview: r.tokenPreview,
      tokenCreatedAt: num(r.tokenCreatedAt),
      tokenReplaced: r.tokenReplaced,
      tokenNoticeAt: num(r.tokenNoticeAt),
      allowInsecure: r.allowInsecure,
      activityReviewedAt: Number(r.activityReviewedAt),
      createdAt: Number(r.createdAt),
    }));
  }

  async saveParticipant(row: ParticipantRow): Promise<void> {
    const data = { ...row };
    await this.prisma.participant.upsert({ where: { id: row.id }, create: data, update: data });
  }

  async deleteParticipant(id: string): Promise<void> {
    await this.prisma.participant.deleteMany({ where: { id } });
  }

  // --- rulesets and settings -------------------------------------------------------------------

  async listRulesets(): Promise<RulesetRow[]> {
    const rows = await this.prisma.ruleset.findMany();
    return rows.map((r) => ({ ruleset: JSON.parse(r.data) as Ruleset, enabled: r.enabled, createdAt: Number(r.createdAt) }));
  }

  async saveRuleset(row: RulesetRow): Promise<void> {
    const data = { id: row.ruleset.id, data: json(row.ruleset), enabled: row.enabled, createdAt: row.createdAt };
    await this.prisma.ruleset.upsert({ where: { id: data.id }, create: data, update: data });
  }

  async getSettings(): Promise<Record<string, string>> {
    const rows = await this.prisma.setting.findMany();
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }

  async setSetting(key: string, value: string): Promise<void> {
    await this.prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
  }

  // --- lobbies, series, games ------------------------------------------------------------------

  async listLobbies(): Promise<LobbyRow[]> {
    const rows = await this.prisma.lobby.findMany();
    return rows.map((r) => ({
      id: r.id,
      rulesetId: r.rulesetId,
      godMode: r.godMode,
      stopOnInfraction: r.stopOnInfraction,
      createdBy: r.createdBy,
      seats: [JSON.parse(r.seat1) as SeatOwnerRow, JSON.parse(r.seat2) as SeatOwnerRow],
      createdAt: Number(r.createdAt),
      lastActivityAt: Number(r.lastActivityAt),
    }));
  }

  async saveLobby(row: LobbyRow): Promise<void> {
    const data = {
      id: row.id,
      rulesetId: row.rulesetId,
      godMode: row.godMode,
      stopOnInfraction: row.stopOnInfraction,
      createdBy: row.createdBy,
      seat1: json(row.seats[0]),
      seat2: json(row.seats[1]),
      createdAt: row.createdAt,
      lastActivityAt: row.lastActivityAt,
    };
    await this.prisma.lobby.upsert({ where: { id: row.id }, create: data, update: data });
  }

  async deleteLobby(id: string): Promise<void> {
    await this.prisma.lobby.deleteMany({ where: { id } });
  }

  private seriesData(row: SeriesRow) {
    return {
      id: row.id,
      lobbyId: row.lobbyId,
      target: row.target,
      played: row.played,
      score1: row.score[1],
      score2: row.score[2],
      status: row.status,
      abortReason: row.abortReason,
      startedAt: row.startedAt,
      endedAt: row.endedAt,
      heatmap: json(row.heatmap),
    };
  }

  async listSeries(lobbyId: string): Promise<SeriesRow[]> {
    const rows = await this.prisma.series.findMany({ where: { lobbyId }, orderBy: { startedAt: 'asc' } });
    return rows.map((r) => ({
      id: r.id,
      lobbyId: r.lobbyId,
      target: r.target,
      played: r.played,
      score: { 1: r.score1, 2: r.score2 },
      status: r.status as SeriesRow['status'],
      abortReason: r.abortReason,
      startedAt: Number(r.startedAt),
      endedAt: num(r.endedAt),
      heatmap: JSON.parse(r.heatmap) as Heatmap,
    }));
  }

  async saveSeries(row: SeriesRow): Promise<void> {
    const data = this.seriesData(row);
    await this.prisma.series.upsert({ where: { id: row.id }, create: data, update: data });
  }

  async deleteSeries(seriesId: string): Promise<void> {
    await this.prisma.series.deleteMany({ where: { id: seriesId } });
  }

  async recordGame(game: GameRow, series: SeriesRow): Promise<void> {
    const seriesData = this.seriesData(series);
    await this.prisma.$transaction([
      this.prisma.game.create({
        data: {
          id: game.id,
          lobbyId: game.lobbyId,
          seriesId: game.seriesId,
          idx: game.index,
          first: game.first,
          status: game.status,
          winner: game.winner,
          reason: game.reason,
          startedAt: game.startedAt,
          endedAt: game.endedAt,
          shots1: game.shots[1],
          shots2: game.shots[2],
          infractions1: game.infractions[1],
          infractions2: game.infractions[2],
          events: json(game.events),
          times: json(game.times),
          summary: game.summary ? json(game.summary) : null,
        },
      }),
      this.prisma.series.upsert({ where: { id: series.id }, create: seriesData, update: seriesData }),
    ]);
  }

  async listGames(seriesId: string): Promise<GameMeta[]> {
    const rows = await this.prisma.game.findMany({
      where: { seriesId },
      orderBy: [{ idx: 'asc' }, { startedAt: 'asc' }],
      select: {
        id: true, lobbyId: true, seriesId: true, idx: true, first: true, status: true, winner: true,
        reason: true, startedAt: true, endedAt: true, shots1: true, shots2: true,
        infractions1: true, infractions2: true,
      },
    });
    return rows.map((r) => ({
      id: r.id,
      lobbyId: r.lobbyId,
      seriesId: r.seriesId,
      index: r.idx,
      first: r.first as Seat,
      status: r.status as GameMeta['status'],
      winner: r.winner as Seat | null,
      reason: r.reason,
      startedAt: Number(r.startedAt),
      endedAt: Number(r.endedAt),
      shots: { 1: r.shots1, 2: r.shots2 },
      infractions: { 1: r.infractions1, 2: r.infractions2 },
    }));
  }

  async getGame(lobbyId: string, gameId: string): Promise<GameRow | null> {
    const r = await this.prisma.game.findFirst({ where: { id: gameId, lobbyId } });
    if (!r) return null;
    return {
      id: r.id,
      lobbyId: r.lobbyId,
      seriesId: r.seriesId,
      index: r.idx,
      first: r.first as Seat,
      status: r.status as GameMeta['status'],
      winner: r.winner as Seat | null,
      reason: r.reason,
      startedAt: Number(r.startedAt),
      endedAt: Number(r.endedAt),
      shots: { 1: r.shots1, 2: r.shots2 },
      infractions: { 1: r.infractions1, 2: r.infractions2 },
      events: JSON.parse(r.events) as GameEvent[],
      times: JSON.parse(r.times) as number[],
      summary: r.summary ? (JSON.parse(r.summary) as GameSummary) : null,
    };
  }

  async listSummaries(seriesId: string): Promise<GameSummary[]> {
    const rows = await this.prisma.game.findMany({
      where: { seriesId, summary: { not: null } },
      orderBy: { idx: 'asc' },
      select: { summary: true },
    });
    return rows.map((r) => JSON.parse(r.summary as string) as GameSummary);
  }

  // --- audit and sessions ----------------------------------------------------------------------

  async appendAudit(row: Omit<AuditRow, 'id'>): Promise<void> {
    await this.prisma.auditLog.create({ data: row });
  }

  async listAudit(limit: number): Promise<AuditRow[]> {
    const rows = await this.prisma.auditLog.findMany({ orderBy: { id: 'desc' }, take: limit });
    return rows.map((r) => ({
      id: String(r.id),
      at: Number(r.at),
      actor: r.actor,
      action: r.action,
      target: r.target,
      detail: r.detail,
    }));
  }

  async addConnection(row: ConnectionRow): Promise<void> {
    await this.prisma.programConnection.create({ data: row });
  }

  async endConnection(id: string, endedAt: number, reason: string, takeoverIp: string | null): Promise<void> {
    await this.prisma.programConnection.updateMany({ where: { id, endedAt: null }, data: { endedAt, endReason: reason.slice(0, 200), takeoverIp } });
  }

  async endOpenConnections(endedAt: number, reason: string): Promise<void> {
    await this.prisma.programConnection.updateMany({ where: { endedAt: null }, data: { endedAt, endReason: reason } });
  }

  async listConnections(since: number): Promise<ConnectionRow[]> {
    const rows = await this.prisma.programConnection.findMany({ where: { at: { gte: since } }, orderBy: { at: 'asc' } });
    return rows.map((r) => ({
      id: r.id,
      participantId: r.participantId,
      kind: r.kind as ConnectionRow['kind'],
      at: Number(r.at),
      endedAt: num(r.endedAt),
      endReason: r.endReason,
      ip: r.ip,
      secure: r.secure,
      programName: r.programName,
      programVersion: r.programVersion,
      lobbyId: r.lobbyId,
      seat: r.seat,
      takeoverIp: r.takeoverIp,
    }));
  }

  async pruneConnections(before: number): Promise<void> {
    await this.prisma.programConnection.deleteMany({ where: { at: { lt: before } } });
  }

  async saveSession(row: WebSessionRow): Promise<void> {
    await this.prisma.webSession.upsert({ where: { idHash: row.idHash }, create: row, update: row });
  }

  async getSession(idHash: string): Promise<WebSessionRow | null> {
    const r = await this.prisma.webSession.findUnique({ where: { idHash } });
    if (!r) return null;
    return {
      idHash: r.idHash,
      role: r.role as WebSessionRole,
      participantId: r.participantId,
      adminUsername: r.adminUsername,
      createdAt: Number(r.createdAt),
      expiresAt: Number(r.expiresAt),
    };
  }

  async deleteSession(idHash: string): Promise<void> {
    await this.prisma.webSession.deleteMany({ where: { idHash } });
  }

  async deleteSessionsOf(participantId: string): Promise<void> {
    await this.prisma.webSession.deleteMany({ where: { participantId } });
  }

  async deleteExpiredSessions(now: number): Promise<void> {
    await this.prisma.webSession.deleteMany({ where: { expiresAt: { lte: now } } });
  }
}

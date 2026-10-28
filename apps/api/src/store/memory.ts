import type { GameSummary } from '@bsc/engine';
import type {
  AuditRow,
  GameMeta,
  GameRow,
  LobbyRow,
  ParticipantRow,
  RulesetRow,
  SeriesRow,
  Store,
  WebSessionRow,
} from './store.js';

const clone = <T>(value: T): T => structuredClone(value);

export class MemoryStore implements Store {
  private participants = new Map<string, ParticipantRow>();
  private rulesets = new Map<string, RulesetRow>();
  private settings = new Map<string, string>();
  private lobbies = new Map<string, LobbyRow>();
  private series = new Map<string, SeriesRow>();
  private games = new Map<string, GameRow>();
  private audit: AuditRow[] = [];
  private auditCounter = 0;
  private sessions = new Map<string, WebSessionRow>();

  async init(): Promise<void> {}
  async close(): Promise<void> {}

  async listParticipants(): Promise<ParticipantRow[]> {
    return [...this.participants.values()].map(clone);
  }

  async saveParticipant(row: ParticipantRow): Promise<void> {
    for (const other of this.participants.values()) {
      if (other.id === row.id) continue;
      if (other.name === row.name) throw new Error('unique constraint: participant name');
      if (row.tokenHash !== null && other.tokenHash === row.tokenHash) throw new Error('unique constraint: token hash');
    }
    this.participants.set(row.id, clone(row));
  }

  async deleteParticipant(id: string): Promise<void> {
    this.participants.delete(id);
  }

  async listRulesets(): Promise<RulesetRow[]> {
    return [...this.rulesets.values()].map(clone);
  }

  async saveRuleset(row: RulesetRow): Promise<void> {
    this.rulesets.set(row.ruleset.id, clone(row));
  }

  async getSettings(): Promise<Record<string, string>> {
    return Object.fromEntries(this.settings);
  }

  async setSetting(key: string, value: string): Promise<void> {
    this.settings.set(key, value);
  }

  async listLobbies(): Promise<LobbyRow[]> {
    return [...this.lobbies.values()].map(clone);
  }

  async saveLobby(row: LobbyRow): Promise<void> {
    this.lobbies.set(row.id, clone(row));
  }

  async deleteLobby(id: string): Promise<void> {
    this.lobbies.delete(id);
    for (const s of [...this.series.values()]) if (s.lobbyId === id) this.series.delete(s.id);
    for (const g of [...this.games.values()]) if (g.lobbyId === id) this.games.delete(g.id);
  }

  async listSeries(lobbyId: string): Promise<SeriesRow[]> {
    return [...this.series.values()]
      .filter((s) => s.lobbyId === lobbyId)
      .sort((a, b) => a.startedAt - b.startedAt)
      .map(clone);
  }

  async saveSeries(row: SeriesRow): Promise<void> {
    this.series.set(row.id, clone(row));
  }

  async deleteSeries(seriesId: string): Promise<void> {
    this.series.delete(seriesId);
    for (const g of [...this.games.values()]) if (g.seriesId === seriesId) this.games.delete(g.id);
  }

  async recordGame(game: GameRow, series: SeriesRow): Promise<void> {
    if (this.games.has(game.id)) throw new Error('unique constraint: game id');
    this.games.set(game.id, clone(game));
    this.series.set(series.id, clone(series));
  }

  async listGames(seriesId: string): Promise<GameMeta[]> {
    return [...this.games.values()]
      .filter((g) => g.seriesId === seriesId)
      .sort((a, b) => a.index - b.index || a.startedAt - b.startedAt)
      .map(({ events: _e, times: _t, summary: _s, ...meta }) => clone(meta));
  }

  async getGame(lobbyId: string, gameId: string): Promise<GameRow | null> {
    const game = this.games.get(gameId);
    return game && game.lobbyId === lobbyId ? clone(game) : null;
  }

  async listSummaries(seriesId: string): Promise<GameSummary[]> {
    return [...this.games.values()]
      .filter((g) => g.seriesId === seriesId && g.summary !== null)
      .sort((a, b) => a.index - b.index)
      .map((g) => clone(g.summary as GameSummary));
  }

  async appendAudit(row: Omit<AuditRow, 'id'>): Promise<void> {
    this.audit.push({ ...row, id: String(++this.auditCounter) });
  }

  async listAudit(limit: number): Promise<AuditRow[]> {
    return this.audit.slice(-limit).reverse().map(clone);
  }

  async saveSession(row: WebSessionRow): Promise<void> {
    this.sessions.set(row.idHash, clone(row));
  }

  async getSession(idHash: string): Promise<WebSessionRow | null> {
    const row = this.sessions.get(idHash);
    return row ? clone(row) : null;
  }

  async deleteSession(idHash: string): Promise<void> {
    this.sessions.delete(idHash);
  }

  async deleteSessionsOf(participantId: string): Promise<void> {
    for (const s of [...this.sessions.values()]) if (s.participantId === participantId) this.sessions.delete(s.idHash);
  }

  async deleteExpiredSessions(now: number): Promise<void> {
    for (const s of [...this.sessions.values()]) if (s.expiresAt <= now) this.sessions.delete(s.idHash);
  }
}

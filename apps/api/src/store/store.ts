import type { BotKind } from '@bsc/bots';
import type { GameEvent, GameSummary, Heatmap, Ruleset, Seat } from '@bsc/engine';

/** Persistent records. All times are epoch milliseconds. */

export interface ParticipantRow {
  id: string;
  name: string;
  tokenHash: string | null;
  tokenPreview: string | null;
  tokenCreatedAt: number | null;
  tokenReplaced: boolean;
  tokenNoticeAt: number | null;
  /** Admin policy: may this participant's programs connect over plain `ws://`? Off by default. */
  allowInsecure: boolean;
  createdAt: number;
}

export interface RulesetRow {
  ruleset: Ruleset;
  enabled: boolean;
  createdAt: number;
}

export type SeatOwnerRow = { kind: 'participant'; participantId: string } | { kind: 'bot'; bot: BotKind };

export interface LobbyRow {
  id: string;
  rulesetId: string;
  godMode: boolean;
  stopOnInfraction: boolean;
  createdBy: string;
  seats: [SeatOwnerRow, SeatOwnerRow];
  createdAt: number;
  lastActivityAt: number;
}

export interface SeriesRow {
  id: string;
  lobbyId: string;
  target: number;
  played: number;
  score: { 1: number; 2: number };
  status: 'running' | 'done' | 'aborted';
  abortReason: string | null;
  startedAt: number;
  endedAt: number | null;
  heatmap: Heatmap;
}

/** What lists need; the (large) event log is fetched separately. */
export interface GameMeta {
  id: string;
  lobbyId: string;
  seriesId: string;
  index: number;
  first: Seat;
  status: 'over' | 'void';
  winner: Seat | null;
  reason: string | null;
  startedAt: number;
  endedAt: number;
  shots: { 1: number; 2: number };
  infractions: { 1: number; 2: number };
}

export interface GameRow extends GameMeta {
  events: GameEvent[];
  /** Epoch ms of each event, aligned with `events`. */
  times: number[];
  summary: GameSummary | null;
}

export interface AuditRow {
  id: string;
  at: number;
  actor: string;
  action: string;
  target: string | null;
  detail: string | null;
}

export type WebSessionRole = 'gate' | 'participant' | 'admin';

export interface WebSessionRow {
  idHash: string;
  role: WebSessionRole;
  participantId: string | null;
  adminUsername: string | null;
  createdAt: number;
  expiresAt: number;
}

/**
 * Everything the platform persists. Implemented by `PrismaStore` (MariaDB) and `MemoryStore`
 * (tests, and local runs without a database); both are checked by the same contract test.
 */
export interface Store {
  init(): Promise<void>;
  close(): Promise<void>;

  listParticipants(): Promise<ParticipantRow[]>;
  /** Insert or update. Rejects if the name or token hash collides with another participant. */
  saveParticipant(row: ParticipantRow): Promise<void>;
  deleteParticipant(id: string): Promise<void>;

  listRulesets(): Promise<RulesetRow[]>;
  saveRuleset(row: RulesetRow): Promise<void>;

  getSettings(): Promise<Record<string, string>>;
  setSetting(key: string, value: string): Promise<void>;

  listLobbies(): Promise<LobbyRow[]>;
  saveLobby(row: LobbyRow): Promise<void>;
  /** Also deletes the lobby's series and games. */
  deleteLobby(id: string): Promise<void>;

  listSeries(lobbyId: string): Promise<SeriesRow[]>;
  saveSeries(row: SeriesRow): Promise<void>;
  /** Deletes a series and its games. */
  deleteSeries(seriesId: string): Promise<void>;

  /** Stores a finished or voided game and the updated series in one transaction. */
  recordGame(game: GameRow, series: SeriesRow): Promise<void>;
  listGames(seriesId: string): Promise<GameMeta[]>;
  getGame(lobbyId: string, gameId: string): Promise<GameRow | null>;
  listSummaries(seriesId: string): Promise<GameSummary[]>;

  appendAudit(row: Omit<AuditRow, 'id'>): Promise<void>;
  /** Newest first. */
  listAudit(limit: number): Promise<AuditRow[]>;

  saveSession(row: WebSessionRow): Promise<void>;
  getSession(idHash: string): Promise<WebSessionRow | null>;
  deleteSession(idHash: string): Promise<void>;
  deleteSessionsOf(participantId: string): Promise<void>;
  deleteExpiredSessions(now: number): Promise<void>;
}

export const STORE = Symbol('STORE');

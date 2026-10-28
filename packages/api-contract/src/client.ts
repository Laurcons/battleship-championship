import type {
  AdminParticipant,
  AuditEntry,
  Frame,
  GameDetail,
  GameListItem,
  LiveUpdate,
  LobbySummary,
  MyToken,
  OpponentChoice,
  ParticipantRef,
  PlatformInfo,
  PlatformSettings,
  Ruleset,
  RulesetInfo,
  Seat,
  SeriesInfo,
  SeriesReport,
  Session,
} from './types.js';

/**
 * Everything the web app needs from the backend. The mock implements it in memory; the real
 * implementation will call the NestJS API (HTTP for requests, SSE for `subscribeLobby`).
 * All methods reject with an `ApiError` on failure.
 */
export interface ApiClient {
  // --- session ---
  getSession(): Promise<Session | null>;
  /** Step 1 of participant login: verifies the shared password and returns the names to pick from. */
  verifySharedPassword(password: string): Promise<ParticipantRef[]>;
  /** Step 2: log in as a participant (requires step 1 to have succeeded). */
  loginParticipant(participantId: string): Promise<Session>;
  loginAdmin(username: string, password: string): Promise<Session>;
  logout(): Promise<void>;

  // --- my account ---
  getMyToken(): Promise<MyToken>;
  /**
   * Creates the participant's first token (conflict if one exists). Returns the full token: it is
   * shown once and never retrievable again.
   */
  createToken(): Promise<{ token: string }>;
  /** Replaces the existing token; programs using the old one are disconnected. Returns the new token. */
  replaceToken(): Promise<{ token: string }>;
  acknowledgeTokenNotice(): Promise<void>;

  // --- rulesets and participants (read) ---
  /** All rulesets, with an `enabled` flag: disabled ones stay readable (lobbies keep using them) but cannot be chosen for new lobbies. */
  listRulesets(): Promise<RulesetInfo[]>;
  listParticipants(): Promise<ParticipantRef[]>;
  getPlatformInfo(): Promise<PlatformInfo>;

  // --- lobbies ---
  listLobbies(): Promise<LobbySummary[]>;
  getLobby(id: string): Promise<LobbySummary>;
  /**
   * `godMode` is the creator's choice (both players see both fleets live) and defaults to on. It is
   * always on for lobbies against yourself or a practice bot, and rejected when the admin has turned
   * god mode off. It cannot change after creation.
   */
  createLobby(input: { opponent: OpponentChoice; rulesetId: string; godMode?: boolean }): Promise<LobbySummary>;
  deleteLobby(id: string): Promise<void>;
  startSeries(lobbyId: string, games: number): Promise<LobbySummary>;
  restartGame(lobbyId: string): Promise<LobbySummary>;
  resetSeries(lobbyId: string): Promise<LobbySummary>;

  // --- lobby data ---
  /** All series of a lobby, oldest first. */
  listSeries(lobbyId: string): Promise<SeriesInfo[]>;
  listGames(lobbyId: string, seriesId?: string): Promise<GameListItem[]>;
  getGame(lobbyId: string, gameId: string): Promise<GameDetail>;
  getSeriesReport(lobbyId: string, seriesId?: string): Promise<SeriesReport | null>;
  getFrameLog(lobbyId: string, seat: Seat): Promise<Frame[]>;
  /**
   * Live updates for a lobby (SSE in the real implementation). Never throws: a failure (for example
   * no access) is reported through `onError`. Returns an unsubscribe function.
   */
  subscribeLobby(lobbyId: string, onUpdate: (update: LiveUpdate) => void, onError?: (error: Error) => void): () => void;

  // --- admin ---
  admin: {
    listParticipants(): Promise<AdminParticipant[]>;
    createParticipant(name: string): Promise<AdminParticipant>;
    renameParticipant(id: string, name: string): Promise<AdminParticipant>;
    deleteParticipant(id: string): Promise<void>;
    createRuleset(ruleset: Ruleset): Promise<RulesetInfo>;
    setRulesetEnabled(id: string, enabled: boolean): Promise<RulesetInfo>;
    /** Makes an enabled ruleset the one preselected for new lobbies. */
    setDefaultRuleset(id: string): Promise<RulesetInfo>;
    getSettings(): Promise<PlatformSettings>;
    updateSettings(patch: { allowGodMode?: boolean; maxBatterySize?: number }): Promise<PlatformSettings>;
    listAuditLog(): Promise<AuditEntry[]>;
    listAllLobbies(): Promise<LobbySummary[]>;
  };
}

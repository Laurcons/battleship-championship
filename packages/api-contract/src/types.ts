import type {
  EndReason,
  GameSummary,
  Heatmap,
  Ruleset,
  Seat,
  SeriesStats,
  ViewEvent,
} from '@bsc/engine';
import type { BotKind } from '@bsc/bots';

export type { Seat, Ruleset, ViewEvent, SeriesStats, Heatmap, GameSummary, BotKind };

export type Session =
  | { role: 'participant'; participantId: string; name: string }
  | { role: 'admin'; username: string };

export interface ParticipantRef {
  id: string;
  name: string;
}

export type OpponentChoice =
  | { kind: 'participant'; participantId: string }
  | { kind: 'bot'; bot: BotKind };

export type ConnectionState = 'disconnected' | 'connected' | 'grace';

export type SeatOwner =
  | { kind: 'participant'; participantId: string; name: string }
  | { kind: 'bot'; bot: BotKind; name: string };

export interface SeatInfo {
  seat: Seat;
  owner: SeatOwner;
  connection: ConnectionState;
  program: { name: string; version: string } | null;
  /** Epoch ms at which the resume window ends, while in grace. */
  graceEndsAt: number | null;
  latencyMs: number | null;
  lastSeenAt: number | null;
}

/**
 * waiting: not every program is connected. ready: all connected, Start is available.
 * running: a battery is being played. paused: running, but a seat is in its resume window.
 * expired: idle for too long; read-only.
 */
export type LobbyStatus = 'waiting' | 'ready' | 'running' | 'paused' | 'expired';

export interface SeriesInfo {
  id: string;
  target: number;
  played: number;
  score: { 1: number; 2: number };
  status: 'running' | 'done' | 'aborted';
  abortReason: string | null;
  startedAt: number;
  endedAt: number | null;
  etaMs: number | null;
}

export type ViewerMode = 'god' | 'restricted';

export interface LobbySummary {
  /** The human-readable lobby id, e.g. K7QM-4XD2-7. */
  id: string;
  rulesetId: string;
  ruleset: Ruleset;
  /** Whether the lobby was created with god-mode. */
  godMode: boolean;
  /** Whether a battery ends, aborted, at the first infraction of either program. Fixed at creation. */
  stopOnInfraction: boolean;
  /** What this viewer sees. */
  viewerMode: ViewerMode;
  createdAt: number;
  createdBy: ParticipantRef;
  seats: [SeatInfo, SeatInfo];
  mySeats: Seat[];
  status: LobbyStatus;
  series: SeriesInfo | null;
  lastActivityAt: number;
  expiresAt: number;
  canStart: boolean;
}

export type GameStatus = 'live' | 'over' | 'void';

export interface GameListItem {
  id: string;
  seriesId: string;
  index: number;
  first: Seat;
  status: GameStatus;
  winner: Seat | null;
  reason: EndReason | null;
  shots: { 1: number; 2: number };
  infractions: { 1: number; 2: number };
  startedAt: number;
  durationMs: number;
}

export interface GameDetail extends GameListItem {
  viewerMode: ViewerMode;
  rules: Ruleset;
  events: ViewEvent[];
  /** Epoch ms of each event, aligned with `events`. */
  eventTimes: number[];
}

export interface LiveUpdate {
  lobby: LobbySummary;
  game: GameDetail | null;
}

export interface SeriesReport {
  seriesId: string;
  info: SeriesInfo;
  stats: SeriesStats;
  heatmap: Heatmap;
}

export interface Frame {
  at: number;
  /** to_program: platform to program. from_program: program to platform. note: platform-side remark. */
  dir: 'to_program' | 'from_program' | 'note';
  text: string;
}

export interface MyToken {
  /** False until the participant creates a token: new participants start without one. */
  exists: boolean;
  /** Masked fingerprint (the last 4 characters), e.g. bsc_••••••••a1b2. Null when there is no token. */
  preview: string | null;
  /** When the current token was created (or last replaced). */
  createdAt: number | null;
  /** Whether the current token replaced an earlier one. */
  replaced: boolean;
  /** Set when the token was replaced from another session since the owner last acknowledged. */
  notice: { at: number } | null;
}

export interface RulesetInfo {
  ruleset: Ruleset;
  enabled: boolean;
  createdAt: number;
  /** Number of lobbies using it. Only the admin sees this; null for participants. */
  lobbyCount: number | null;
  /** The ruleset preselected for new lobbies. Chosen by the admin; always enabled. */
  isDefault: boolean;
}

/** What every participant may know about the platform's limits. */
export interface PlatformInfo {
  maxBatterySize: number;
  /** Whether lobby creators may choose god mode (the admin can turn it off for a fair event). */
  allowGodMode: boolean;
  limits: { moveMs: number; placeMs: number; graceMs: number; maxStrikes: number; idleExpiryMs: number };
}

export type SignalSeverity = 'high' | 'notice' | 'info';

export type SignalKind =
  | 'concurrent_addresses'
  | 'taken_over'
  | 'foreign_lobby'
  | 'new_address'
  | 'many_addresses'
  | 'plain_ws'
  | 'shared_address';

/** Something about how a token was used that an admin may want to look at. Computed from the connection history. */
export interface ActivitySignal {
  id: string;
  kind: SignalKind;
  severity: SignalSeverity;
  participant: ParticipantRef;
  /** When the event that raised it happened. A signal is unreviewed while this is later than the participant's review time. */
  at: number;
  message: string;
  ips: string[];
  /** The connections that are the evidence for it. */
  connectionIds: string[];
  reviewed: boolean;
}

/** One program connection (or one denied attempt) as the admin sees it. */
export interface ConnectionRecord {
  id: string;
  participant: ParticipantRef;
  kind: 'connected' | 'denied';
  at: number;
  /** Null while the connection is open. */
  endedAt: number | null;
  ip: string;
  /** Whether it used TLS (wss://). */
  secure: boolean;
  program: { name: string; version: string } | null;
  lobbyId: string;
  seat: Seat | null;
  endReason: string | null;
  /** Set when a newer connection from this other address took this one over while it was active. */
  takeoverIp: string | null;
  /** Ids of the signals this connection is evidence for. */
  flaggedBy: string[];
}

export interface ActivitySummary {
  lastConnection: { at: number; ip: string; secure: boolean } | null;
  /** Unreviewed signals by severity. */
  unreviewed: { high: number; notice: number; info: number };
}

export interface AddressSummary {
  ip: string;
  firstSeen: number;
  lastSeen: number;
  connections: number;
  modes: ('wss' | 'ws')[];
  /** Other participants seen on this address in the last 7 days. */
  alsoUsedBy: ParticipantRef[];
}

export interface ParticipantActivity {
  participant: ParticipantRef;
  tokenCreatedAt: number | null;
  /** Signals raised before this moment count as reviewed. 0 if never reviewed. */
  reviewedAt: number;
  connections7d: number;
  addresses7d: number;
  lastConnection: ActivitySummary['lastConnection'];
  signals: ActivitySignal[];
  addresses: AddressSummary[];
  /** Newest first. */
  connections: ConnectionRecord[];
  denied: ConnectionRecord[];
}

export interface TokenMonitor {
  summary: { needsAttention: number; notices: number; infos: number; activeLast24h: number; participants: number };
  /** Newest first, reviewed ones included. */
  signals: ActivitySignal[];
  /** Set when the addresses look like the platform's own proxy, which would make every signal meaningless. */
  proxyWarning: string | null;
}

export interface AdminParticipant extends ParticipantRef {
  activity: ActivitySummary;
  createdAt: number;
  /** When the participant created their token; null if they have none yet. */
  tokenCreatedAt: number | null;
  lobbyCount: number;
  /** May this participant's programs connect over plain ws://? Off by default: only wss:// is accepted. */
  allowInsecure: boolean;
}

export interface PlatformSettings {
  /** Policy: may lobby creators choose god mode? Applies to lobbies created afterwards. */
  allowGodMode: boolean;
  maxBatterySize: number;
  /** Read-only platform constants (set through environment variables). */
  constants: { label: string; value: string }[];
}

export interface AuditEntry {
  id: string;
  at: number;
  actor: string;
  action: string;
  target: string | null;
  detail: string | null;
}

export type ApiErrorCode =
  | 'invalid_credentials'
  | 'rate_limited'
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'validation'
  | 'internal'
  | 'unavailable';

export class ApiError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

import type { BotKind } from '@bsc/bots';
import type { GameEvent, GameSummary, Heatmap, Ruleset, Seat } from '@bsc/engine';
import type { AuditEntry, ConnectionState, Frame, GameStatus, SeatOwner } from '../api/types';
import type { EndReason } from '@bsc/engine';

export type Fault = 'none' | 'invalid_moves' | 'repeat_shots' | 'bad_shape' | 'timeout' | 'crash';

/** How a simulated program behaves (mock only). */
export interface SimProfile {
  brain: BotKind;
  fault: Fault;
}

export interface ParticipantRec {
  id: string;
  name: string;
  /** Null until the participant creates one. */
  token: string | null;
  tokenCreatedAt: number | null;
  tokenReplaced: boolean;
  tokenNotice: { at: number } | null;
  createdAt: number;
}

export interface RulesetRec {
  ruleset: Ruleset;
  enabled: boolean;
  createdAt: number;
}

export interface SeatRec {
  seat: Seat;
  owner: SeatOwner;
  connection: ConnectionState;
  program: { name: string; version: string } | null;
  graceEndsAt: number | null;
  latencyMs: number | null;
  lastSeenAt: number | null;
  profile: SimProfile;
  /** Platform-side remarks and connection frames, newest last (capped). */
  notes: Frame[];
}

export interface GameRec {
  id: string;
  seriesId: string;
  index: number;
  first: Seat;
  status: GameStatus;
  winner: Seat | null;
  reason: EndReason | null;
  startedAt: number;
  endedAt: number | null;
  /** Null when the mock no longer keeps this game's events. */
  events: GameEvent[] | null;
  times: number[];
  summary: GameSummary | null;
}

export interface SeriesRec {
  id: string;
  target: number;
  played: number;
  score: { 1: number; 2: number };
  status: 'running' | 'done' | 'aborted';
  abortReason: string | null;
  startedAt: number;
  endedAt: number | null;
  summaries: GameSummary[];
  heatmap: Heatmap;
}

export interface LobbyRec {
  id: string;
  rulesetId: string;
  ruleset: Ruleset;
  godMode: boolean;
  /** Absent in state saved by earlier versions: treated as off. */
  stopOnInfraction?: boolean;
  createdAt: number;
  createdBy: string;
  seats: [SeatRec, SeatRec];
  seriesList: SeriesRec[];
  games: GameRec[];
  lastActivityAt: number;
}

export interface MockState {
  version: 1;
  sharedPassword: string;
  admin: { username: string; password: string };
  settings: { allowGodMode: boolean; maxBatterySize: number; /** Preselected for new lobbies; always an enabled ruleset. */ defaultRulesetId: string };
  participants: ParticipantRec[];
  rulesets: RulesetRec[];
  lobbies: LobbyRec[];
  audit: AuditEntry[];
  counter: number;
}

export const PLATFORM_CONSTANTS = {
  moveTimeoutMs: 10_000,
  placeTimeoutMs: 10_000,
  graceMs: 60_000,
  idleExpiryMs: 2 * 60 * 60 * 1000,
  maxOpenLobbies: 10,
  maxStrikes: 3,
} as const;

/** The mock keeps full event logs only for the most recent games of each lobby. */
export const MOCK_KEPT_GAMES = 30;

export function addNote(seat: SeatRec, at: number, dir: Frame['dir'], text: string): void {
  seat.notes.push({ at, dir, text });
  if (seat.notes.length > 200) seat.notes.splice(0, seat.notes.length - 200);
}

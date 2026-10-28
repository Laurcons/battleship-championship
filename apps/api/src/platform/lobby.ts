import type { GameEvent, GameState, Ruleset, Seat } from '@bsc/engine';
import type { ConnectionState, Frame } from '@bsc/api-contract';
import type { LobbyRow, SeriesRow } from '../store/store.js';

export const FRAME_LOG_CAP = 2000;

/** Capped ring buffer of the raw traffic of one seat (both directions), tokens already redacted. */
export class FrameLog {
  private frames: Frame[] = [];
  constructor(private cap = FRAME_LOG_CAP) {}

  add(frame: Frame): void {
    this.frames.push(frame);
    if (this.frames.length > this.cap) this.frames.splice(0, this.frames.length - this.cap);
  }

  list(): Frame[] {
    return [...this.frames];
  }
}

export interface SeatState {
  seat: Seat;
  connection: ConnectionState;
  program: { name: string; version: string } | null;
  /** Epoch ms at which the resume window ends, while in grace. */
  graceEndsAt: number | null;
  latencyMs: number | null;
  lastSeenAt: number | null;
  frames: FrameLog;
}

/** The game being played right now. Lives in memory only; it is persisted when it ends. */
export interface LiveGame {
  id: string;
  seriesId: string;
  index: number;
  first: Seat;
  startedAt: number;
  state: GameState;
  events: GameEvent[];
  times: number[];
}

export interface LobbyRuntimeHandle {
  isRunning(): boolean;
  stop(): void;
}

/** A lobby as the platform holds it in memory: the stored row plus connection and live-game state. */
export class Lobby {
  readonly seats: [SeatState, SeatState];
  series: SeriesRow[] = [];
  live: LiveGame | null = null;
  runtime: LobbyRuntimeHandle | null = null;

  constructor(
    public row: LobbyRow,
    readonly ruleset: Ruleset,
  ) {
    const seat = (n: Seat): SeatState => {
      const bot = row.seats[n - 1]?.kind === 'bot';
      return {
        seat: n,
        connection: bot ? 'connected' : 'disconnected',
        program: bot ? { name: `practice-${(row.seats[n - 1] as { bot: string }).bot}`, version: '1' } : null,
        graceEndsAt: null,
        latencyMs: bot ? 0 : null,
        lastSeenAt: null,
        frames: new FrameLog(),
      };
    };
    this.seats = [seat(1), seat(2)];
  }

  get id(): string {
    return this.row.id;
  }

  currentSeries(): SeriesRow | undefined {
    return this.series.at(-1);
  }

  isBotSeat(seat: Seat): boolean {
    return this.row.seats[seat - 1]?.kind === 'bot';
  }
}

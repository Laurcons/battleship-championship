export type Seat = 1 | 2;
export type Dir = 'h' | 'v';

export interface Ship {
  len: number;
  x: number;
  y: number;
  dir: Dir;
}

export type ShotResult = 'miss' | 'hit' | 'sunk' | 'repeat';

export type RepeatShot = 'invalid' | 'waste';

export interface Ruleset {
  id: string;
  description: string;
  width: number;
  height: number;
  /** Ship lengths. */
  fleet: number[];
  /** Whether ships may be adjacent (including diagonally). */
  touching: boolean;
  extraTurnOnHit: boolean;
  announceSunk: boolean;
  repeatShot: RepeatShot;
  /** Whether programs are shown the opponent's layout and shots when a game ends. */
  revealOnGameOver: boolean;
}

export interface Shot {
  x: number;
  y: number;
  result: ShotResult;
  /** Length of the sunk ship; present when `result` is `sunk`. */
  len?: number;
}

export type ForfeitReason = 'timeout' | 'strikes' | 'disconnect';
export type EndReason = 'sunk' | ForfeitReason;

/** Gameplay error codes; these match the protocol's `error.code` values. */
export type ErrorCode =
  | 'out_of_bounds'
  | 'already_fired'
  | 'bad_fleet'
  | 'ship_out_of_bounds'
  | 'ships_overlap'
  | 'ships_touching'
  | 'not_your_turn'
  | 'wrong_phase'
  | 'already_placed';

export interface GameError {
  code: ErrorCode;
  message: string;
}

/**
 * The append-only log of a game. `ms` is the program's think time, set by the platform.
 * `infraction` and `game_over` are informational: applying them never changes the state.
 */
export type GameEvent =
  | { type: 'placed'; seat: Seat; ships: Ship[]; ms?: number }
  | { type: 'shot'; seat: Seat; x: number; y: number; result: ShotResult; len?: number; ms?: number }
  | {
      type: 'infraction';
      seat: Seat;
      code: string;
      message: string;
      strikes: number;
      /** The offending frame as received, truncated by the platform. */
      raw?: string;
      ms?: number;
    }
  | { type: 'forfeit'; seat: Seat; reason: ForfeitReason }
  | { type: 'game_over'; winner: Seat; reason: EndReason };

export type Command =
  | { type: 'place'; seat: Seat; ships: Ship[] }
  | { type: 'fire'; seat: Seat; x: number; y: number }
  | { type: 'forfeit'; seat: Seat; reason: ForfeitReason };

export type Phase = 'placing' | 'playing' | 'over';

export interface GameState {
  rules: Ruleset;
  first: Seat;
  phase: Phase;
  /** Seat to move; null unless playing. */
  turn: Seat | null;
  ships: Record<Seat, Ship[] | null>;
  /** Shots fired BY each seat, in order. */
  shots: Record<Seat, Shot[]>;
  winner: Seat | null;
  endReason: EndReason | null;
}

export type Decision = { ok: true; events: GameEvent[] } | { ok: false; error: GameError };

export const otherSeat = (seat: Seat): Seat => (seat === 1 ? 2 : 1);

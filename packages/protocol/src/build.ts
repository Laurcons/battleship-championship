import {
  otherSeat,
  programShot,
  seatView,
  type GameEvent,
  type GameState,
  type Seat,
  type Shot,
} from '@bsc/engine';
import type { GameplayErrorCode } from './constants.js';
import type { GameOver, Place, Turn, WireShot } from './schemas.js';

export interface GameContext {
  id: string;
  index: number;
  total: number;
}

export interface FrameError {
  code: GameplayErrorCode;
  message: string;
}

/** A shot as the wire carries it (`len` only when present). */
export function wireShot(state: GameState, shot: Shot): WireShot {
  const s = programShot(state, shot);
  return s.len === undefined ? { x: s.x, y: s.y, result: s.result } : { x: s.x, y: s.y, result: s.result, len: s.len };
}

type ShotEvent = Extract<GameEvent, { type: 'shot' }>;
const isShot = (e: GameEvent): e is ShotEvent => e.type === 'shot';

/**
 * What a seat has not yet been told: its own most recent shot, and the opponent's shots since then
 * in order. `events` is the game's log up to now.
 */
export function shotContext(events: readonly GameEvent[], seat: Seat): { last: ShotEvent | null; incoming: ShotEvent[] } {
  let lastIndex = -1;
  events.forEach((e, i) => {
    if (isShot(e) && e.seat === seat) lastIndex = i;
  });
  const last = lastIndex >= 0 ? (events[lastIndex] as ShotEvent) : null;
  const incoming = events.slice(lastIndex + 1).filter((e): e is ShotEvent => isShot(e) && e.seat !== seat);
  return { last, incoming };
}

export function placeFrame(args: {
  rid: number;
  deadlineMs: number;
  game: GameContext & { first: Seat };
  seat: Seat;
  opponent: { name: string; program: { name: string; version?: string } | null };
  error: FrameError | null;
  strikes: number;
}): Place {
  const { game, seat } = args;
  return {
    type: 'place',
    rid: args.rid,
    deadline_ms: args.deadlineMs,
    game: { id: game.id, index: game.index, total: game.total, first: game.first === seat ? 'you' : 'opponent' },
    opponent: args.opponent,
    error: args.error,
    strikes: args.strikes,
  };
}

export function turnFrame(args: {
  rid: number;
  deadlineMs: number;
  game: GameContext;
  seat: Seat;
  state: GameState;
  events: readonly GameEvent[];
  error: FrameError | null;
  strikes: number;
}): Turn {
  const { state, seat, game } = args;
  const view = seatView(state, seat);
  const { last, incoming } = shotContext(args.events, seat);
  return {
    type: 'turn',
    rid: args.rid,
    deadline_ms: args.deadlineMs,
    game: { id: game.id, index: game.index, total: game.total, first: state.first === seat ? 'you' : 'opponent' },
    you: view.you,
    enemy: view.enemy,
    enemy_remaining: view.enemyRemaining,
    last_shot: last ? wireShot(state, last) : null,
    incoming: incoming.map((e) => wireShot(state, e)),
    error: args.error,
    strikes: args.strikes,
  };
}

export function gameOverFrame(args: {
  game: GameContext;
  seat: Seat;
  /** The final state of the game. */
  state: GameState;
  events: readonly GameEvent[];
  winner: Seat;
  reason: GameOver['reason'];
  /** Games won so far in the battery, including this one. */
  score: Record<Seat, number>;
  done: boolean;
}): GameOver {
  const { state, seat, game } = args;
  const { last, incoming } = shotContext(args.events, seat);
  const opponent = otherSeat(seat);
  return {
    type: 'game_over',
    game: { id: game.id, index: game.index, total: game.total },
    winner: args.winner === seat ? 'you' : 'opponent',
    reason: args.reason,
    last_shot: last ? wireShot(state, last) : null,
    incoming: incoming.map((e) => wireShot(state, e)),
    series: { score: { you: args.score[seat], opponent: args.score[opponent] }, done: args.done },
    reveal: state.rules.revealOnGameOver
      ? {
          opponent_ships: state.ships[opponent] ?? [],
          opponent_shots: state.shots[opponent].map((s) => wireShot(state, s)),
        }
      : null,
  };
}

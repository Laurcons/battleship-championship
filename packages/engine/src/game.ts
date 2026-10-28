import { cellKey, inBounds, shipCells } from './geometry.js';
import { validatePlacement } from './placement.js';
import {
  otherSeat,
  type Command,
  type Decision,
  type ErrorCode,
  type GameError,
  type GameEvent,
  type GameState,
  type Ruleset,
  type Seat,
  type Shot,
} from './types.js';

export function createGame(rules: Ruleset, first: Seat): GameState {
  return {
    rules,
    first,
    phase: 'placing',
    turn: null,
    ships: { 1: null, 2: null },
    shots: { 1: [], 2: [] },
    winner: null,
    endReason: null,
  };
}

/** Lengths of the ships of `owner` that are fully hit, given the shots fired by the other seat. */
export function sunkShipLengths(state: GameState, owner: Seat): number[] {
  const ships = state.ships[owner];
  if (!ships) return [];
  const hits = hitCells(state.shots[otherSeat(owner)]);
  return ships.filter((s) => shipCells(s).every((c) => hits.has(cellKey(c.x, c.y)))).map((s) => s.len);
}

function hitCells(shots: readonly Shot[]): Set<number> {
  const hits = new Set<number>();
  for (const s of shots) if (s.result === 'hit' || s.result === 'sunk') hits.add(cellKey(s.x, s.y));
  return hits;
}

/**
 * Validates a command and returns the events it produces. Never mutates the state and never
 * throws on bad input: bad input yields `{ ok: false, error }`.
 */
export function decide(state: GameState, command: Command): Decision {
  const { rules } = state;
  switch (command.type) {
    case 'place': {
      if (state.phase !== 'placing') {
        return fail('wrong_phase', 'Ships can only be placed before the game starts.');
      }
      if (state.ships[command.seat] !== null) {
        return fail('already_placed', 'This seat has already placed its ships.');
      }
      const error = validatePlacement(rules, command.ships);
      if (error) return { ok: false, error };
      return { ok: true, events: [{ type: 'placed', seat: command.seat, ships: command.ships }] };
    }
    case 'fire': {
      if (state.phase !== 'playing') return fail('wrong_phase', 'The game is not in progress.');
      if (state.turn !== command.seat) return fail('not_your_turn', 'It is not your turn.');
      const { x, y } = command;
      if (!inBounds(x, y, rules.width, rules.height)) {
        return fail(
          'out_of_bounds',
          `(${show(x)},${show(y)}) is not a cell of the ${rules.width}x${rules.height} board.`,
        );
      }
      const already = state.shots[command.seat].some((s) => s.x === x && s.y === y);
      if (already && rules.repeatShot === 'invalid') {
        return fail('already_fired', `You already fired at (${x},${y}).`);
      }
      if (already) {
        return { ok: true, events: [{ type: 'shot', seat: command.seat, x, y, result: 'repeat' }] };
      }
      const target = state.ships[otherSeat(command.seat)] ?? [];
      const ship = target.find((s) => shipCells(s).some((c) => c.x === x && c.y === y));
      if (!ship) return { ok: true, events: [{ type: 'shot', seat: command.seat, x, y, result: 'miss' }] };

      const hits = hitCells(state.shots[command.seat]);
      hits.add(cellKey(x, y));
      const sunk = shipCells(ship).every((c) => hits.has(cellKey(c.x, c.y)));
      const events: GameEvent[] = [
        sunk
          ? { type: 'shot', seat: command.seat, x, y, result: 'sunk', len: ship.len }
          : { type: 'shot', seat: command.seat, x, y, result: 'hit' },
      ];
      if (sunk && target.every((s) => shipCells(s).every((c) => hits.has(cellKey(c.x, c.y))))) {
        events.push({ type: 'game_over', winner: command.seat, reason: 'sunk' });
      }
      return { ok: true, events };
    }
    case 'forfeit': {
      if (state.phase === 'over') return fail('wrong_phase', 'The game is already over.');
      return {
        ok: true,
        events: [
          { type: 'forfeit', seat: command.seat, reason: command.reason },
          { type: 'game_over', winner: otherSeat(command.seat), reason: command.reason },
        ],
      };
    }
  }
}

/** Formats an untrusted value for an error message without ever throwing. */
function show(value: unknown): string {
  return typeof value === 'number' ? String(value) : typeof value;
}

function fail(code: ErrorCode, message: string): Decision {
  return { ok: false, error: { code, message } };
}

/** Applies one event and returns the new state. */
export function apply(state: GameState, event: GameEvent): GameState {
  switch (event.type) {
    case 'placed': {
      const ships = { ...state.ships, [event.seat]: event.ships } as GameState['ships'];
      const bothPlaced = ships[1] !== null && ships[2] !== null;
      return {
        ...state,
        ships,
        phase: bothPlaced ? 'playing' : 'placing',
        turn: bothPlaced ? state.first : null,
      };
    }
    case 'shot': {
      const shot: Shot =
        event.len === undefined
          ? { x: event.x, y: event.y, result: event.result }
          : { x: event.x, y: event.y, result: event.result, len: event.len };
      const shots = { ...state.shots, [event.seat]: [...state.shots[event.seat], shot] } as GameState['shots'];
      const next: GameState = { ...state, shots };
      const target = state.ships[otherSeat(event.seat)] ?? [];
      const hits = hitCells(shots[event.seat]);
      const allSunk = target.every((s) => shipCells(s).every((c) => hits.has(cellKey(c.x, c.y))));
      if (event.result !== 'repeat' && event.result !== 'miss' && allSunk) {
        return { ...next, phase: 'over', turn: null, winner: event.seat, endReason: 'sunk' };
      }
      const keepsTurn =
        (event.result === 'hit' || event.result === 'sunk') && state.rules.extraTurnOnHit;
      return { ...next, turn: keepsTurn ? event.seat : otherSeat(event.seat) };
    }
    case 'forfeit':
      return {
        ...state,
        phase: 'over',
        turn: null,
        winner: otherSeat(event.seat),
        endReason: event.reason,
      };
    case 'infraction':
    case 'game_over':
      return state;
  }
}

export function replay(rules: Ruleset, first: Seat, events: readonly GameEvent[]): GameState {
  return events.reduce(apply, createGame(rules, first));
}

/** Decides and applies in one step; convenient for simulations and tests. */
export function step(
  state: GameState,
  command: Command,
): { ok: true; state: GameState; events: GameEvent[] } | { ok: false; error: GameError } {
  const decision = decide(state, command);
  if (!decision.ok) return decision;
  return { ok: true, events: decision.events, state: decision.events.reduce(apply, state) };
}

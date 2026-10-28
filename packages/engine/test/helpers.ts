import {
  CLASSIC_10X10,
  createGame,
  randomPlacement,
  seededRng,
  step,
  randInt,
  type Command,
  type GameEvent,
  type GameState,
  type Ruleset,
  type Seat,
  type Ship,
} from '../src/index.js';

export const rules = (overrides: Partial<Ruleset> = {}): Ruleset => ({ ...CLASSIC_10X10, ...overrides });

/** Fleet laid out in rows 0,2,4,6,8, all horizontal from x=0 (legal even without touching). */
export const rowFleet = (ruleset: Ruleset): Ship[] =>
  ruleset.fleet.map((len, i) => ({ len, x: 0, y: i * 2, dir: 'h' as const }));

export function mustStep(state: GameState, command: Command): { state: GameState; events: GameEvent[] } {
  const result = step(state, command);
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result;
}

/** A game where both seats have placed `rowFleet`; ready for shooting. */
export function startedGame(ruleset: Ruleset, first: Seat = 1): GameState {
  let state = createGame(ruleset, first);
  state = mustStep(state, { type: 'place', seat: 1, ships: rowFleet(ruleset) }).state;
  state = mustStep(state, { type: 'place', seat: 2, ships: rowFleet(ruleset) }).state;
  return state;
}

export interface PlayedGame {
  final: GameState;
  events: GameEvent[];
}

/** Plays a whole game with both seats choosing random legal shots. */
export function playRandomGame(ruleset: Ruleset, seed: number): PlayedGame {
  const rng = seededRng(seed);
  const first: Seat = rng() < 0.5 ? 1 : 2;
  let state = createGame(ruleset, first);
  const events: GameEvent[] = [];
  for (const seat of [1, 2] as Seat[]) {
    const ships = randomPlacement(ruleset, rng);
    if (!ships) throw new Error('no placement');
    const r = mustStep(state, { type: 'place', seat, ships });
    state = r.state;
    events.push(...r.events);
  }
  const fired = { 1: new Set<number>(), 2: new Set<number>() };
  while (state.phase === 'playing') {
    const seat = state.turn as Seat;
    let x: number;
    let y: number;
    do {
      x = randInt(rng, ruleset.width);
      y = randInt(rng, ruleset.height);
    } while (fired[seat].has(y * 100 + x));
    fired[seat].add(y * 100 + x);
    const r = mustStep(state, { type: 'fire', seat, x, y });
    state = r.state;
    events.push(...r.events);
  }
  return { final: state, events };
}

import { describe, expect, it } from 'vitest';
import {
  CLASSIC_10X10,
  createGame,
  seatView,
  seededRng,
  step,
  type GameState,
  type Ruleset,
  type Seat,
} from '@bsc/engine';
import { createBrain, type BotKind } from '../src/index.js';

/** Plays two bots to the end through the engine; throws if a bot ever makes an illegal move. */
function play(rules: Ruleset, a: BotKind, b: BotKind, seed: number): GameState {
  const rng = seededRng(seed);
  const brains = { 1: createBrain(a), 2: createBrain(b) };
  let state = createGame(rules, 1);
  for (const seat of [1, 2] as Seat[]) {
    const result = step(state, { type: 'place', seat, ships: brains[seat].place(rules, rng) });
    if (!result.ok) throw new Error(`placement rejected: ${result.error.message}`);
    state = result.state;
  }
  let guard = 0;
  while (state.phase === 'playing') {
    if (guard++ > 1000) throw new Error('game did not end');
    const seat = state.turn as Seat;
    const cell = brains[seat].fire(rules, seatView(state, seat), rng);
    const result = step(state, { type: 'fire', seat, ...cell });
    if (!result.ok) throw new Error(`illegal shot by ${seat}: ${result.error.message}`);
    state = result.state;
  }
  return state;
}

const rulesets: Ruleset[] = [
  CLASSIC_10X10,
  { ...CLASSIC_10X10, touching: true, extraTurnOnHit: false },
  { ...CLASSIC_10X10, announceSunk: false, repeatShot: 'waste' },
  { ...CLASSIC_10X10, width: 7, height: 9, fleet: [4, 3, 2, 2, 1] },
];

describe('practice bots', () => {
  it.each(['random', 'hunt-target'] as BotKind[])('%s never makes an illegal move', (kind) => {
    for (const rules of rulesets) {
      for (let seed = 1; seed <= 40; seed++) {
        const state = play(rules, kind, kind, seed);
        expect(state.phase).toBe('over');
      }
    }
  });

  it('hunt-target needs clearly fewer shots than random', () => {
    const total = { random: 0, hunt: 0 };
    for (let seed = 1; seed <= 60; seed++) {
      // Both bots shoot at identical-quality random boards; compare the shooter's shot count in a win.
      const r = play(CLASSIC_10X10, 'random', 'random', seed);
      const h = play(CLASSIC_10X10, 'hunt-target', 'hunt-target', seed);
      total.random += r.shots[r.winner as Seat].length;
      total.hunt += h.shots[h.winner as Seat].length;
    }
    expect(total.hunt).toBeLessThan(total.random * 0.85);
  });

  it('hunt-target beats random in most games', () => {
    let huntWins = 0;
    const games = 100;
    for (let seed = 1; seed <= games; seed++) {
      const state = play(CLASSIC_10X10, 'hunt-target', 'random', seed);
      if (state.winner === 1) huntWins++;
    }
    expect(huntWins).toBeGreaterThan(games * 0.8);
  });
});

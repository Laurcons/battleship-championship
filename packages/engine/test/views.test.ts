import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  godView,
  programShot,
  seatView,
  validateRuleset,
  CLASSIC_10X10,
  replay,
  type Seat,
} from '../src/index.js';
import { mustStep, playRandomGame, rules, startedGame } from './helpers.js';

describe('seatView', () => {
  it('shows own ships but never the opponent ships', () => {
    const state = startedGame(rules());
    const view = seatView(state, 1);
    expect(view.you[0]).toBe('SSSSS.....');
    expect(view.enemy.every((row) => row === '..........')).toBe(true);
    expect(view.enemyRemaining).toEqual([5, 4, 3, 3, 2]);
  });

  it('marks hits, misses and sunk ships from the right perspective', () => {
    let state = startedGame(rules());
    state = mustStep(state, { type: 'fire', seat: 1, x: 0, y: 8 }).state; // hit
    state = mustStep(state, { type: 'fire', seat: 1, x: 1, y: 8 }).state; // sunk (len 2)
    state = mustStep(state, { type: 'fire', seat: 1, x: 9, y: 9 }).state; // miss, turn passes
    const mine = seatView(state, 1);
    expect(mine.enemy[8]).toBe('##........');
    expect(mine.enemy[9]).toBe('.........o');
    expect(mine.enemyRemaining).toEqual([5, 4, 3, 3]);
    const theirs = seatView(state, 2);
    expect(theirs.you[8]).toBe('xx........'); // own sunk ship shows as plain hits
    expect(theirs.you[9]).toBe('.........o');
    expect(theirs.enemy.every((row) => row === '..........')).toBe(true);
  });

  it('hides sunk markers and remaining fleet when sunk ships are not announced', () => {
    let state = startedGame(rules({ announceSunk: false }));
    state = mustStep(state, { type: 'fire', seat: 1, x: 0, y: 8 }).state;
    state = mustStep(state, { type: 'fire', seat: 1, x: 1, y: 8 }).state;
    const view = seatView(state, 1);
    expect(view.enemy[8]).toBe('xx........');
    expect(view.enemyRemaining).toBeNull();
    expect(programShot(state, { x: 1, y: 8, result: 'sunk', len: 2 })).toEqual({ x: 1, y: 8, result: 'hit' });
  });

  it('never leaks opponent ship cells at any point of a random game (property)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2 ** 31 }), fc.integer({ min: 0, max: 1 }), (seed, flag) => {
        const ruleset = rules({ announceSunk: flag === 1 });
        const { events, final } = playRandomGame(ruleset, seed);
        for (let i = 1; i <= events.length; i++) {
          const state = replay(ruleset, final.first, events.slice(0, i));
          for (const seat of [1, 2] as Seat[]) {
            const view = seatView(state, seat);
            expect(view.enemy.join('')).toMatch(/^[.ox#]+$/); // never 'S'
            // every revealed enemy cell must correspond to a shot this seat actually fired
            const fired = new Set(state.shots[seat].filter((s) => s.result !== 'repeat').map((s) => `${s.x},${s.y}`));
            view.enemy.forEach((row, y) =>
              [...row].forEach((ch, x) => {
                if (ch !== '.') expect(fired.has(`${x},${y}`)).toBe(true);
              }),
            );
            if (!ruleset.announceSunk) expect(view.enemy.join('')).not.toContain('#');
          }
        }
      }),
      { numRuns: 60 },
    );
  });
});

describe('godView', () => {
  it('shows both boards with all ships', () => {
    const boards = godView(startedGame(rules()));
    expect(boards[1][0]).toBe('SSSSS.....');
    expect(boards[2][0]).toBe('SSSSS.....');
  });
});

describe('validateRuleset', () => {
  it('accepts the classic ruleset', () => {
    expect(validateRuleset(CLASSIC_10X10)).toEqual([]);
  });

  it('rejects bad ids, sizes and fleets', () => {
    expect(validateRuleset({ ...CLASSIC_10X10, id: 'Bad ID' })).not.toEqual([]);
    expect(validateRuleset({ ...CLASSIC_10X10, width: 2 })).not.toEqual([]);
    expect(validateRuleset({ ...CLASSIC_10X10, height: 40 })).not.toEqual([]);
    expect(validateRuleset({ ...CLASSIC_10X10, fleet: [] })).not.toEqual([]);
    expect(validateRuleset({ ...CLASSIC_10X10, fleet: [11] })).not.toEqual([]);
  });

  it('rejects fleets covering more than half of the board', () => {
    const crowded = { ...CLASSIC_10X10, width: 6, height: 6, fleet: [5, 5, 5, 5], touching: false };
    expect(validateRuleset(crowded).join(' ')).toMatch(/half/);
  });
});

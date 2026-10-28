import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { deriveBoards, godView, redactEvents, replay, type Seat } from '../src/index.js';
import { playRandomGame, rules } from './helpers.js';

describe('deriveBoards', () => {
  it('equals godView(replay) at every prefix when nothing is hidden (property)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2 ** 31 }), fc.integer({ min: 0, max: 1 }), (seed, flag) => {
        const ruleset = rules({ announceSunk: flag === 1 });
        const { events, final } = playRandomGame(ruleset, seed);
        const view = redactEvents(ruleset, events, [], true);
        for (let i = 0; i <= events.length; i += 7) {
          const expected = godView(replay(ruleset, final.first, events.slice(0, i)));
          expect(deriveBoards(ruleset, view, i)).toEqual(expected);
        }
      }),
      { numRuns: 40 },
    );
  });

  it('reveals nothing about a hidden seat except hits, misses and sunk ships', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2 ** 31 }), (seed) => {
        const ruleset = rules();
        const { events } = playRandomGame(ruleset, seed);
        const view = redactEvents(ruleset, events, [2], false);
        const boards = deriveBoards(ruleset, view);
        expect(boards[2].join('')).not.toContain('S'); // seat 2's intact ships stay hidden
        expect(JSON.stringify(view.filter((e) => e.type === 'placed' && e.seat === 2))).not.toContain('"x"');
      }),
      { numRuns: 40 },
    );
  });

  it('downgrades sunk to hit when sunk ships are not announced and the viewer is restricted', () => {
    const ruleset = rules({ announceSunk: false, fleet: [2] });
    const { events } = playRandomGame(ruleset, 3);
    const restricted = redactEvents(ruleset, events, [], false);
    expect(restricted.some((e) => e.type === 'shot' && e.result === 'sunk')).toBe(false);
    const god = redactEvents(ruleset, events, [], true);
    expect(god.some((e) => e.type === 'shot' && e.result === 'sunk')).toBe(true);
    // a restricted viewer of a hidden seat gets no sunk ship disclosure either
    expect(JSON.stringify(redactEvents(ruleset, events, [1, 2], false))).not.toContain('sunkShip');
  });

  it('discloses a sunk ship when announced, even if the placement is hidden', () => {
    const ruleset = rules({ fleet: [2] });
    const { events } = playRandomGame(ruleset, 5);
    const view = redactEvents(ruleset, events, [1, 2], false);
    const sunk = view.filter((e) => e.type === 'shot' && e.result === 'sunk');
    expect(sunk.length).toBeGreaterThan(0);
    for (const e of sunk) expect(e).toHaveProperty('sunkShip');
    const boards = deriveBoards(ruleset, view);
    const loser: Seat = (events.at(-1) as { winner: Seat }).winner === 1 ? 2 : 1;
    expect(boards[loser].join('')).toContain('##');
  });
});

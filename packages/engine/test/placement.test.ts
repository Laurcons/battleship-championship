import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { randomPlacement, seededRng, validatePlacement, type Ship } from '../src/index.js';
import { rowFleet, rules } from './helpers.js';

describe('validatePlacement', () => {
  const r = rules();

  it('accepts a legal fleet', () => {
    expect(validatePlacement(r, rowFleet(r))).toBeNull();
  });

  it('rejects the wrong fleet', () => {
    expect(validatePlacement(r, rowFleet(r).slice(1))?.code).toBe('bad_fleet');
    const wrong = rowFleet(r).map((s, i) => (i === 0 ? { ...s, len: 4 } : s));
    expect(validatePlacement(r, wrong)?.code).toBe('bad_fleet');
  });

  it('rejects malformed ships', () => {
    const bad = [...rowFleet(r)];
    bad[0] = { len: 5, x: 0.5, y: 0, dir: 'h' };
    expect(validatePlacement(r, bad)?.code).toBe('bad_fleet');
    bad[0] = { len: 5, x: 0, y: 0, dir: 'z' as never };
    expect(validatePlacement(r, bad)?.code).toBe('bad_fleet');
    expect(validatePlacement(r, null as never)?.code).toBe('bad_fleet');
  });

  it('rejects ships leaving the board', () => {
    const ships = rowFleet(r).map((s, i) => (i === 0 ? { ...s, x: 6 } : s));
    expect(validatePlacement(r, ships)?.code).toBe('ship_out_of_bounds');
    const negative = rowFleet(r).map((s, i) => (i === 0 ? { ...s, y: -1 } : s));
    expect(validatePlacement(r, negative)?.code).toBe('ship_out_of_bounds');
  });

  it('rejects overlaps', () => {
    const ships = rowFleet(r).map((s, i) => (i === 1 ? { ...s, y: 0 } : s));
    expect(validatePlacement(r, ships)?.code).toBe('ships_overlap');
  });

  it('rejects touching ships (diagonals included) only when touching is forbidden', () => {
    const adjacent = rowFleet(r).map((s, i) => (i === 1 ? { ...s, y: 1 } : s));
    expect(validatePlacement(r, adjacent)?.code).toBe('ships_touching');
    expect(validatePlacement(rules({ touching: true }), adjacent)).toBeNull();

    const diagonal: Ship[] = rowFleet(r).map((s, i) => (i === 1 ? { ...s, x: 5, y: 1 } : s));
    // ship 0 occupies (0..4, 0); ship 1 starts at (5,1): diagonal contact.
    expect(validatePlacement(r, diagonal)?.code).toBe('ships_touching');
  });
});

describe('randomPlacement', () => {
  const variants = [
    rules(),
    rules({ touching: true }),
    rules({ width: 8, height: 8, fleet: [4, 3, 3, 2] }),
    rules({ width: 12, height: 6, fleet: [5, 4, 3, 2, 2] }),
  ];

  it('always produces a legal placement', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2 ** 31 }), fc.constantFrom(...variants), (seed, ruleset) => {
        const ships = randomPlacement(ruleset, seededRng(seed));
        expect(ships).not.toBeNull();
        expect(validatePlacement(ruleset, ships as Ship[])).toBeNull();
      }),
      { numRuns: 300 },
    );
  });

  it('is deterministic for a seed and varies between seeds', () => {
    const a = randomPlacement(rules(), seededRng(7));
    expect(randomPlacement(rules(), seededRng(7))).toEqual(a);
    const different = new Set(
      [1, 2, 3, 4, 5].map((seed) => JSON.stringify(randomPlacement(rules(), seededRng(seed)))),
    );
    expect(different.size).toBeGreaterThan(1);
  });

  it('returns null when the fleet cannot fit', () => {
    const tight = rules({ width: 5, height: 5, fleet: [5, 5, 5, 5, 5], touching: false });
    expect(randomPlacement(tight, seededRng(1), 5)).toBeNull();
  });
});

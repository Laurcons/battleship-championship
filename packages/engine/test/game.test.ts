import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createGame, decide, replay, step, type GameState, type Seat } from '../src/index.js';
import { mustStep, playRandomGame, rowFleet, rules, startedGame } from './helpers.js';

describe('placement phase', () => {
  it('starts playing only after both seats placed, with the first mover on turn', () => {
    const r = rules();
    let state = createGame(r, 2);
    state = mustStep(state, { type: 'place', seat: 1, ships: rowFleet(r) }).state;
    expect(state.phase).toBe('placing');
    expect(state.turn).toBeNull();
    state = mustStep(state, { type: 'place', seat: 2, ships: rowFleet(r) }).state;
    expect(state.phase).toBe('playing');
    expect(state.turn).toBe(2);
  });

  it('rejects double placement, bad placement and firing too early', () => {
    const r = rules();
    let state = createGame(r, 1);
    expect(decide(state, { type: 'fire', seat: 1, x: 0, y: 0 })).toMatchObject({
      ok: false,
      error: { code: 'wrong_phase' },
    });
    state = mustStep(state, { type: 'place', seat: 1, ships: rowFleet(r) }).state;
    expect(decide(state, { type: 'place', seat: 1, ships: rowFleet(r) })).toMatchObject({
      ok: false,
      error: { code: 'already_placed' },
    });
    expect(decide(state, { type: 'place', seat: 2, ships: [] })).toMatchObject({
      ok: false,
      error: { code: 'bad_fleet' },
    });
  });
});

describe('shots', () => {
  it('reports miss and hit, and passes the turn after either without extra turns', () => {
    const r = rules({ extraTurnOnHit: false });
    let state = startedGame(r); // opponent's carrier (5) lies at y=0, x=0..4
    let result = mustStep(state, { type: 'fire', seat: 1, x: 9, y: 9 });
    expect(result.events[0]).toMatchObject({ type: 'shot', result: 'miss' });
    expect(result.state.turn).toBe(2);
    state = mustStep(result.state, { type: 'fire', seat: 2, x: 9, y: 9 }).state;
    result = mustStep(state, { type: 'fire', seat: 1, x: 0, y: 0 });
    expect(result.events[0]).toMatchObject({ result: 'hit' });
    expect(result.state.turn).toBe(2);
  });

  it('marks the last cell of a ship as sunk with its length', () => {
    let state = startedGame(rules()); // the length-2 ship lies at y=8, x=0..1
    state = mustStep(state, { type: 'fire', seat: 1, x: 0, y: 8 }).state;
    const res = mustStep(state, { type: 'fire', seat: 1, x: 1, y: 8 });
    expect(res.events[0]).toMatchObject({ result: 'sunk', len: 2 });
  });

  it('grants an extra turn on hit only when the ruleset says so', () => {
    const withExtra = startedGame(rules({ extraTurnOnHit: true }));
    expect(mustStep(withExtra, { type: 'fire', seat: 1, x: 0, y: 0 }).state.turn).toBe(1);
    expect(mustStep(withExtra, { type: 'fire', seat: 1, x: 9, y: 9 }).state.turn).toBe(2);

    const without = startedGame(rules({ extraTurnOnHit: false }));
    expect(mustStep(without, { type: 'fire', seat: 1, x: 0, y: 0 }).state.turn).toBe(2);
  });

  it('rejects out-of-bounds shots, shots out of turn and (by default) repeated shots', () => {
    const state = startedGame(rules());
    for (const [x, y] of [[-1, 0], [10, 0], [0, 10], [1.5, 2]] as const) {
      expect(decide(state, { type: 'fire', seat: 1, x, y })).toMatchObject({
        ok: false,
        error: { code: 'out_of_bounds' },
      });
    }
    expect(decide(state, { type: 'fire', seat: 2, x: 0, y: 0 })).toMatchObject({
      ok: false,
      error: { code: 'not_your_turn' },
    });
    const after = mustStep(state, { type: 'fire', seat: 1, x: 0, y: 0 }).state; // hit, extra turn
    expect(decide(after, { type: 'fire', seat: 1, x: 0, y: 0 })).toMatchObject({
      ok: false,
      error: { code: 'already_fired' },
    });
  });

  it('with repeatShot=waste a repeat changes nothing and passes the turn', () => {
    const r = rules({ repeatShot: 'waste' });
    let state = startedGame(r);
    state = mustStep(state, { type: 'fire', seat: 1, x: 0, y: 0 }).state; // hit, still seat 1
    const res = mustStep(state, { type: 'fire', seat: 1, x: 0, y: 0 });
    expect(res.events).toEqual([{ type: 'shot', seat: 1, x: 0, y: 0, result: 'repeat' }]);
    expect(res.state.turn).toBe(2);
    expect(res.state.phase).toBe('playing');
  });
});

describe('game end', () => {
  it('ends with the shooter as winner when the last ship sinks, emitting game_over', () => {
    const r = rules({ fleet: [2] });
    let state = startedGame(r);
    state = mustStep(state, { type: 'fire', seat: 1, x: 0, y: 0 }).state;
    const res = mustStep(state, { type: 'fire', seat: 1, x: 1, y: 0 });
    expect(res.events.map((e) => e.type)).toEqual(['shot', 'game_over']);
    expect(res.state).toMatchObject({ phase: 'over', winner: 1, endReason: 'sunk', turn: null });
    expect(decide(res.state, { type: 'fire', seat: 1, x: 5, y: 5 })).toMatchObject({
      ok: false,
      error: { code: 'wrong_phase' },
    });
  });

  it('a forfeit makes the other seat win, in any phase before the end', () => {
    const r = rules();
    const placing = createGame(r, 1);
    const res = mustStep(placing, { type: 'forfeit', seat: 1, reason: 'timeout' });
    expect(res.state).toMatchObject({ phase: 'over', winner: 2, endReason: 'timeout' });
    expect(res.events.map((e) => e.type)).toEqual(['forfeit', 'game_over']);
    expect(decide(res.state, { type: 'forfeit', seat: 2, reason: 'timeout' }).ok).toBe(false);
  });
});

describe('whole games (property tests)', () => {
  const rulesets = [
    rules(),
    rules({ touching: true, extraTurnOnHit: false }),
    rules({ repeatShot: 'waste', announceSunk: false }),
    rules({ width: 7, height: 9, fleet: [4, 3, 2, 2, 1] }),
  ];

  it('every random game terminates with a winner whose opponent is fully sunk', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2 ** 31 }), fc.constantFrom(...rulesets), (seed, ruleset) => {
        const { final, events } = playRandomGame(ruleset, seed);
        expect(final.phase).toBe('over');
        const winner = final.winner as Seat;
        const loser: Seat = winner === 1 ? 2 : 1;
        const hits = new Set(
          final.shots[winner].filter((s) => s.result === 'hit' || s.result === 'sunk').map((s) => `${s.x},${s.y}`),
        );
        const loserCells = (final.ships[loser] ?? []).flatMap((s) =>
          Array.from({ length: s.len }, (_, i) => (s.dir === 'h' ? `${s.x + i},${s.y}` : `${s.x},${s.y + i}`)),
        );
        expect(loserCells.every((c) => hits.has(c))).toBe(true);
        expect(events.at(-1)).toMatchObject({ type: 'game_over', winner, reason: 'sunk' });
        for (const seat of [1, 2] as Seat[]) {
          expect(final.shots[seat].length).toBeLessThanOrEqual(ruleset.width * ruleset.height);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('replaying the event log reproduces the final state exactly', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2 ** 31 }), fc.constantFrom(...rulesets), (seed, ruleset) => {
        const { final, events } = playRandomGame(ruleset, seed);
        expect(replay(ruleset, final.first, events)).toEqual(final);
      }),
      { numRuns: 100 },
    );
  });

  it('event-prefix replays are consistent (history scrubbing)', () => {
    const { events, final } = playRandomGame(rules(), 12345);
    let live: GameState = createGame(rules(), final.first);
    for (let i = 0; i < events.length; i++) {
      live = replay(rules(), final.first, events.slice(0, i + 1));
      expect(live.shots[1].length + live.shots[2].length).toBeLessThanOrEqual(i + 1);
    }
    expect(live).toEqual(final);
  });

  it('decide never throws on garbage commands', () => {
    const state = startedGame(rules());
    fc.assert(
      fc.property(fc.anything(), fc.anything(), fc.anything(), (a, b, c) => {
        const commands = [
          { type: 'fire', seat: 1, x: a, y: b },
          { type: 'place', seat: 1, ships: c },
          { type: 'fire', seat: a, x: 0, y: 0 },
        ] as never[];
        for (const command of commands) {
          expect(() => step(state, command)).not.toThrow();
        }
      }),
      { numRuns: 300 },
    );
  });
});

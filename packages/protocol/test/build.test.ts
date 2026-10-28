import {
  CLASSIC_10X10,
  apply,
  createGame,
  decide,
  otherSeat,
  randInt,
  randomPlacement,
  seededRng,
  type GameEvent,
  type GameState,
  type Ruleset,
  type Seat,
} from '@bsc/engine';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { gameOverFrame, outboundSchema, placeFrame, shotContext, turnFrame } from '../src/index.js';

const game = { id: 'g_1', index: 1, total: 3 };

/** Plays one game with random legal moves, collecting every frame each seat would be sent. */
function play(rules: Ruleset, seed: number) {
  const rng = seededRng(seed);
  const first: Seat = rng() < 0.5 ? 1 : 2;
  let state = createGame(rules, first);
  const events: GameEvent[] = [];
  const frames: { seat: Seat; frame: unknown; state: GameState }[] = [];
  for (const seat of [1, 2] as const) {
    frames.push({
      seat,
      state,
      frame: placeFrame({
        rid: 1,
        deadlineMs: 10_000,
        game: { ...game, first },
        seat,
        opponent: { name: 'Alex', program: null },
        error: null,
        strikes: 0,
      }),
    });
    const ships = randomPlacement(rules, rng);
    if (!ships) throw new Error('no placement');
    const d = decide(state, { type: 'place', seat, ships });
    if (!d.ok) throw new Error(d.error.message);
    for (const e of d.events) {
      events.push(e);
      state = apply(state, e);
    }
  }
  let rid = 2;
  while (state.phase === 'playing' && state.turn !== null) {
    const seat = state.turn;
    frames.push({
      seat,
      state,
      frame: turnFrame({ rid: rid++, deadlineMs: 10_000, game, seat, state, events, error: null, strikes: 0 }),
    });
    for (;;) {
      const x = randInt(rng, rules.width);
      const y = randInt(rng, rules.height);
      const d = decide(state, { type: 'fire', seat, x, y });
      if (!d.ok) continue;
      for (const e of d.events) {
        events.push(e);
        state = apply(state, e);
      }
      break;
    }
  }
  return { state, events, frames, first };
}

const rulesets: Ruleset[] = [
  CLASSIC_10X10,
  { ...CLASSIC_10X10, id: 'quiet', announceSunk: false, extraTurnOnHit: false, touching: true },
  { ...CLASSIC_10X10, id: 'small', width: 7, height: 6, fleet: [3, 2, 2], revealOnGameOver: false, repeatShot: 'waste' },
];

describe('frame builders', () => {
  it.each(rulesets.map((r) => [r.id, r] as const))('every frame of random games validates (%s)', (_id, rules) => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1_000_000 }), (seed) => {
        const { state, events, frames } = play(rules, seed);
        for (const { frame } of frames) {
          const parsed = outboundSchema.safeParse(frame);
          expect(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues)).toBe(true);
        }
        for (const seat of [1, 2] as const) {
          const over = gameOverFrame({
            game,
            seat,
            state,
            events,
            winner: state.winner as Seat,
            reason: 'sunk',
            score: { 1: state.winner === 1 ? 1 : 0, 2: state.winner === 2 ? 1 : 0 },
            done: false,
          });
          expect(outboundSchema.safeParse(over).success).toBe(true);
          expect(over.winner).toBe(state.winner === seat ? 'you' : 'opponent');
          expect(over.reveal === null).toBe(!rules.revealOnGameOver);
        }
      }),
      { numRuns: 60 },
    );
  });

  it('turn frames have the ruleset dimensions and never reveal the opponent', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1_000_000 }), fc.constantFrom(...rulesets), (seed, rules) => {
        const { frames } = play(rules, seed);
        for (const { seat, state, frame } of frames) {
          const f = frame as { type: string; you?: string[]; enemy?: string[]; enemy_remaining?: number[] | null };
          if (f.type !== 'turn') continue;
          expect(f.you).toHaveLength(rules.height);
          expect(f.enemy).toHaveLength(rules.height);
          for (const row of [...(f.you ?? []), ...(f.enemy ?? [])]) expect(row).toHaveLength(rules.width);
          // No ship letter on the enemy grid; sunk markers only when announced.
          const enemy = (f.enemy ?? []).join('');
          expect(enemy).not.toMatch(/S/);
          if (!rules.announceSunk) expect(enemy).not.toMatch(/#/);
          expect(f.enemy_remaining === null).toBe(!rules.announceSunk);
          // The enemy grid only marks cells the seat actually shot.
          const shot = new Set(state.shots[seat].map((s) => `${s.x},${s.y}`));
          (f.enemy ?? []).forEach((row, y) =>
            [...row].forEach((ch, x) => {
              if (ch !== '.') expect(shot.has(`${x},${y}`), `(${x},${y}) marked but never shot`).toBe(true);
            }),
          );
        }
      }),
      { numRuns: 40 },
    );
  });

  it('does not tell programs about sunk ships when they are not announced', () => {
    const quiet = rulesets[1] as Ruleset;
    const { events, state } = play(quiet, 7);
    for (const seat of [1, 2] as const) {
      const over = gameOverFrame({
        game, seat, state, events, winner: state.winner as Seat, reason: 'sunk', score: { 1: 1, 2: 0 }, done: true,
      });
      const shots = [over.last_shot, ...over.incoming, ...(over.reveal?.opponent_shots ?? [])];
      for (const s of shots) {
        expect(s?.result).not.toBe('sunk');
        expect(s).not.toHaveProperty('len');
      }
    }
  });
});

describe('shotContext', () => {
  const shot = (seat: Seat, x: number, result: 'miss' | 'hit' = 'miss'): GameEvent => ({ type: 'shot', seat, x, y: 0, result });

  it('is empty before the first shot', () => {
    expect(shotContext([], 1)).toEqual({ last: null, incoming: [] });
  });

  it("lists the opponent's shots since the seat's own last shot, in order", () => {
    const events = [shot(1, 0), shot(2, 1), shot(2, 2), shot(1, 3), shot(2, 4), shot(2, 5)];
    const ctx = shotContext(events, 1);
    expect(ctx.last).toMatchObject({ seat: 1, x: 3 });
    expect(ctx.incoming.map((e) => e.x)).toEqual([4, 5]);
    expect(shotContext(events, otherSeat(1)).incoming.map((e) => e.x)).toEqual([]);
  });

  it('is empty after an extra turn (own hit)', () => {
    const events = [shot(2, 1), shot(1, 3, 'hit')];
    expect(shotContext(events, 1).incoming).toEqual([]);
  });
});

/* eslint-disable @typescript-eslint/no-explicit-any -- frames and JSON responses are inspected loosely */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eventually } from './helpers/testApp.js';
import { World } from './helpers/world.js';
import type { Behavior } from './helpers/program.js';

let w: World;
beforeEach(async () => {
  w = await World.create({ MAX_STRIKES: '3' });
});
afterEach(async () => {
  await w.close();
});

/** Misbehaves on the first `n` turns, then plays properly. */
const badTurns = (make: (frame: any) => object | string, n = 1): Behavior => {
  let count = 0;
  return {
    onTurn(frame, p) {
      if (count++ >= n) return undefined;
      p.send(make(frame));
      return null;
    },
  };
};

describe('invalid moves are strikes', () => {
  it('re-issues the turn with the error, the new strike count and a new rid, then the game goes on', async () => {
    const { lobby, a } = await w.readyLobby({}, { seed: 1, behavior: badTurns((f) => ({ type: 'fire', rid: f.rid, x: 10, y: 0 })) });
    await w.startAndFinish(lobby.id);
    const turns = a.of('turn');
    expect(turns[0]).toMatchObject({ error: null, strikes: 0 });
    expect(turns[1]).toMatchObject({ error: { code: 'out_of_bounds' }, strikes: 1 });
    expect(turns[1].error.message).toMatch(/10,0|board/);
    expect(turns[1].rid).toBeGreaterThan(turns[0].rid);
    expect(turns[1].you).toEqual(turns[0].you); // nothing changed in between
    // The history shows the infraction with the offending frame.
    const game = await w.game(lobby.id, (await w.games(lobby.id))[0].id);
    const infraction = game.events.find((e: any) => e.type === 'infraction');
    expect(infraction).toMatchObject({ seat: 1, code: 'out_of_bounds', strikes: 1 });
    expect(infraction.raw).toContain('"x":10');
    expect((await w.games(lobby.id))[0].infractions).toEqual({ 1: 1, 2: 0 });
  });

  it('treats a repeated shot as already_fired when the ruleset says invalid', async () => {
    let first: any = null;
    const behavior: Behavior = {
      onTurn(frame, p) {
        if (!first) {
          first = frame;
          return undefined; // plays normally and remembers where
        }
        if (frame.last_shot && !frame.error && first.rid !== frame.rid && !('done' in behavior)) {
          Object.assign(behavior, { done: true });
          p.send({ type: 'fire', rid: frame.rid, x: frame.last_shot.x, y: frame.last_shot.y });
          return null;
        }
        return undefined;
      },
    };
    const { lobby, a } = await w.readyLobby({}, { seed: 3, behavior });
    await w.startAndFinish(lobby.id);
    expect(a.of('turn').some((t) => t.error?.code === 'already_fired')).toBe(true);
  });

  it('counts a reply of the wrong shape or type as a strike', async () => {
    const { lobby, a } = await w.readyLobby(
      {},
      {
        seed: 1,
        behavior: (() => {
          let n = 0;
          return {
            onTurn(f: any, p: any) {
              n++;
              if (n === 1) return p.send({ type: 'fire', rid: f.rid, x: '3', y: 4 }), null;
              if (n === 2) return p.send({ type: 'placement', rid: f.rid, ships: [] }), null;
              return undefined;
            },
          } satisfies Behavior;
        })(),
      },
    );
    await w.startAndFinish(lobby.id);
    const errors = a.of('turn').map((t) => t.error?.code).filter(Boolean);
    expect(errors).toEqual(['bad_shape', 'bad_shape']);
    expect(a.of('turn')[2].strikes).toBe(2);
  });

  it('forfeits the game after the maximum number of strikes, and a battery goes on', async () => {
    const { lobby, a, b } = await w.readyLobby({}, { seed: 1, behavior: badTurns((f) => ({ type: 'fire', rid: f.rid, x: -1, y: 0 }), 99) }, { seed: 2 });
    await w.startAndFinish(lobby.id, 3);
    const games = await w.games(lobby.id);
    // Alice (seat 1) never makes a legal move, so she forfeits every game by strikes and Bruno wins them all.
    expect(games.map((g: any) => [g.reason, g.winner])).toEqual([['strikes', 2], ['strikes', 2], ['strikes', 2]]);
    expect(games[0]).toMatchObject({ winner: 2, infractions: { 1: 3, 2: 0 } });
    const over = a.of('game_over')[0];
    expect(over).toMatchObject({ winner: 'opponent', reason: 'strikes' });
    expect(b.of('game_over')[0]).toMatchObject({ winner: 'you', reason: 'strikes' });
    expect(a.of('turn').filter((t) => t.game.index === 1).map((t) => t.strikes)).toEqual([0, 1, 2]);
    expect(a.of('game_over')).toHaveLength(3);
  });

  it('re-issues an invalid placement with the reason, and forfeits after too many', async () => {
    const overlapping = (f: any) => ({
      type: 'placement',
      rid: f.rid,
      ships: [5, 4, 3, 3, 2].map((len) => ({ len, x: 0, y: 0, dir: 'h' })),
    });
    const { lobby, a } = await w.readyLobby({}, { seed: 1, behavior: { onPlace: (f) => overlapping(f) } });
    await w.startAndFinish(lobby.id);
    const places = a.of('place');
    expect(places).toHaveLength(3);
    expect(places[1]).toMatchObject({ error: { code: 'ships_overlap' }, strikes: 1 });
    expect(places[2]).toMatchObject({ error: { code: 'ships_overlap' }, strikes: 2 });
    expect((await w.games(lobby.id))[0]).toMatchObject({ reason: 'strikes', winner: 2 });
  });

  it('rejects ships that break the touching rule or use the wrong fleet', async () => {
    const touching = (f: any) => ({
      type: 'placement',
      rid: f.rid,
      ships: [
        { len: 5, x: 0, y: 0, dir: 'h' },
        { len: 4, x: 0, y: 1, dir: 'h' },
        { len: 3, x: 0, y: 4, dir: 'h' },
        { len: 3, x: 0, y: 6, dir: 'h' },
        { len: 2, x: 0, y: 8, dir: 'h' },
      ],
    });
    const wrongFleet = (f: any) => ({ type: 'placement', rid: f.rid, ships: [{ len: 5, x: 0, y: 0, dir: 'h' }] });
    let n = 0;
    const { lobby, a } = await w.readyLobby({}, { seed: 1, behavior: { onPlace: (f) => (n++ === 0 ? touching(f) : n === 2 ? wrongFleet(f) : undefined) } });
    await w.startAndFinish(lobby.id);
    expect(a.of('place').map((p) => p.error?.code ?? null)).toEqual([null, 'ships_touching', 'bad_fleet']);
  });
});

describe('timeouts', () => {
  it('forfeits the game immediately when a move takes too long (no strike)', async () => {
    const { lobby, a, b } = await w.readyLobby({}, { seed: 1, behavior: { onTurn: () => null } });
    const done = await w.startAndFinish(lobby.id);
    expect(done.series).toMatchObject({ status: 'done', played: 1, score: { 1: 0, 2: 1 } });
    const game = (await w.games(lobby.id))[0];
    expect(game).toMatchObject({ reason: 'timeout', winner: 2 });
    expect(b.of('game_over')[0]).toMatchObject({ winner: 'you', reason: 'timeout' });
    expect(a.of('turn')).toHaveLength(1); // not re-issued
    const detail = await w.game(lobby.id, game.id);
    expect(detail.events.find((e: any) => e.code === 'timeout')).toMatchObject({ seat: 1, strikes: 0 });
  });

  it('forfeits when a placement takes too long', async () => {
    const { lobby } = await w.readyLobby({}, { seed: 1 }, { seed: 2, behavior: { onPlace: () => null } });
    await w.startAndFinish(lobby.id);
    expect((await w.games(lobby.id))[0]).toMatchObject({ reason: 'timeout', winner: 1 });
  });
});

describe('stale and unexpected messages', () => {
  it('ignores a reply to an old request without a strike or an answer', async () => {
    let sentStale = false;
    const { lobby, a } = await w.readyLobby(
      {},
      {
        seed: 1,
        behavior: {
          onTurn(f, p) {
            if (!sentStale) {
              sentStale = true;
              p.send({ type: 'fire', rid: f.rid - 100, x: 0, y: 0 }); // answers nothing
            }
            return undefined;
          },
        },
      },
    );
    await w.startAndFinish(lobby.id);
    expect(a.of('error')).toHaveLength(0);
    expect(a.of('turn').every((t) => t.strikes === 0 && t.error === null)).toBe(true);
    const frames = (await w.alice.get(`/api/lobbies/${lobby.id}/frames/1`)).body as { dir: string; text: string }[];
    expect(frames.some((f) => f.dir === 'from_program' && f.text.includes(`"rid":${a.of('turn')[0].rid - 100}`))).toBe(true);
  });

  it('answers a message nobody asked for, and malformed or unknown frames, with a non-fatal error', async () => {
    const { lobby, a } = await w.readyLobby();
    a.send({ type: 'fire', rid: 1, x: 0, y: 0 });
    a.send('{broken');
    a.send({ type: 'teleport' });
    a.send({ type: 'hello', token: 'x', lobby: 'y', accepts: ['z'] });
    await a.waitFor(() => a.of('error').length >= 4, 4000, 'four errors');
    expect(a.of('error').map((e) => [e.code, e.fatal])).toEqual([
      ['unexpected_message', false],
      ['bad_json', false],
      ['unknown_type', false],
      ['unexpected_message', false],
    ]);
    // The connection still works.
    expect((await w.startAndFinish(lobby.id)).series.status).toBe('done');
  });

  it('closes a connection that floods the platform with garbage', async () => {
    const { a } = await w.readyLobby();
    for (let i = 0; i < 40; i++) a.send('garbage');
    const close = await a.waitForClose();
    expect(close.code).toBe(4429);
    expect(a.of('error').at(-1)).toMatchObject({ code: 'rate_limited', fatal: true });
  });

  it('does not let one misbehaving lobby disturb another', async () => {
    const bad = await w.readyLobby({}, { seed: 1, behavior: { onTurn: () => null } });
    const good = await w.readyLobby({}, { seed: 7 }, { seed: 8 });
    await w.start(bad.lobby.id);
    const done = await w.startAndFinish(good.lobby.id, 5);
    expect(done.series).toMatchObject({ status: 'done', played: 5 });
    expect((await w.untilSeriesEnds(bad.lobby.id)).series.played).toBe(1);
  });
});

describe('repeat shots that are wasted', () => {
  it('reports "repeat", ends the turn, and never counts a strike', async () => {
    const admin = w.t.client();
    await admin.loginAdmin();
    await admin.post('/api/admin/rulesets', {
      id: 'waste-rules', description: '', width: 8, height: 8, fleet: [4, 3, 3, 2], touching: false,
      extraTurnOnHit: false, announceSunk: true, repeatShot: 'waste', revealOnGameOver: true,
    });
    let repeated = false;
    const behavior: Behavior = {
      onTurn(f, p) {
        if (f.last_shot && !repeated) {
          repeated = true;
          p.send({ type: 'fire', rid: f.rid, x: f.last_shot.x, y: f.last_shot.y });
          return null;
        }
        return undefined;
      },
    };
    const { lobby, a } = await w.readyLobby({ rulesetId: 'waste-rules' }, { seed: 4, behavior, accepts: ['waste-rules'] }, { seed: 5, accepts: ['waste-rules'] });
    await w.startAndFinish(lobby.id);
    const turns = a.of('turn');
    const repeatTurn = turns.find((t) => t.last_shot?.result === 'repeat');
    expect(repeatTurn).toBeDefined();
    expect(turns.every((t) => t.strikes === 0 && t.error === null)).toBe(true);
    const detail = await w.game(lobby.id, (await w.games(lobby.id))[0].id);
    expect(detail.events.some((e: any) => e.type === 'shot' && e.result === 'repeat')).toBe(true);
    expect(detail.events.some((e: any) => e.type === 'infraction')).toBe(false);
  });
});

describe('persistence of what happened', () => {
  it('keeps the games it finished even when later ones are interrupted', async () => {
    const { lobby } = await w.readyLobby();
    await w.start(lobby.id, 50);
    await eventually(async () => (await w.games(lobby.id)).filter((g: any) => g.status === 'over').length >= 3, 15_000, 'three games');
    await w.alice.del(`/api/lobbies/${lobby.id}`);
    expect((await w.alice.get(`/api/lobbies/${lobby.id}`)).status).toBe(404);
  });
});

describe('stop on infraction', () => {
  it('is off unless the creator asks for it, and is shown on the lobby', async () => {
    expect((await w.newLobby()).stopOnInfraction).toBe(false);
    const on = await w.newLobby({ stopOnInfraction: true });
    expect(on.stopOnInfraction).toBe(true);
    expect((await w.lobby(on.id)).stopOnInfraction).toBe(true);
  });

  it('ends the battery at the first invalid move, keeps the results so far, and keeps the game for inspection', async () => {
    let turns = 0;
    const behavior: Behavior = {
      onTurn(f, p) {
        if (f.game.index === 3 && ++turns === 2) {
          p.send({ type: 'fire', rid: f.rid, x: 40, y: 0 });
          return null;
        }
        return undefined;
      },
    };
    const { lobby, a, b } = await w.readyLobby({ stopOnInfraction: true }, { seed: 1, behavior });
    const done = await w.startAndFinish(lobby.id, 6);
    expect(done.series.status).toBe('aborted');
    expect(done.series.played).toBe(2);
    expect(done.series.abortReason).toMatch(/first infraction.*Alice.*out_of_bounds/);
    const games = await w.games(lobby.id);
    expect(games.map((g: any) => g.status)).toEqual(['over', 'over', 'void']);
    const detail = await w.game(lobby.id, games[2].id);
    expect(detail.events.find((e: any) => e.type === 'infraction')).toMatchObject({ seat: 1, code: 'out_of_bounds' });
    // Both programs are told the battery stopped; nothing new is sent afterwards.
    for (const p of [a, b]) {
      await p.waitForFrame('reset');
      expect(p.of('reset').at(-1)).toEqual({ type: 'reset', reason: 'series_stopped' });
    }
    const places = a.of('place').length;
    await new Promise((r) => setTimeout(r, 150));
    expect(a.of('place').length).toBe(places);
    expect(a.of('turn').every((t) => t.strikes === 0)).toBe(true); // not even re-issued
    // The lobby is ready for the next battery.
    expect((await w.lobby(lobby.id)).status).toBe('ready');
    a.behavior = {};
    expect((await w.startAndFinish(lobby.id, 1)).series.status).toBe('done');
  });

  it('also stops on a timeout and on an invalid placement', async () => {
    const slow = await w.readyLobby({ stopOnInfraction: true }, { seed: 1, behavior: { onTurn: () => null } });
    const timedOut = await w.startAndFinish(slow.lobby.id, 3);
    expect(timedOut.series).toMatchObject({ status: 'aborted', played: 0 });
    expect(timedOut.series.abortReason).toMatch(/"timeout"/);

    const bad = await w.readyLobby({ stopOnInfraction: true }, { seed: 1 }, {
      seed: 2,
      behavior: { onPlace: (f) => ({ type: 'placement', rid: f.rid, ships: [] }) },
    });
    const refused = await w.startAndFinish(bad.lobby.id, 3);
    expect(refused.series).toMatchObject({ status: 'aborted', played: 0 });
    expect(refused.series.abortReason).toMatch(/Bruno.*bad_fleet/);
  });

  it('does not change how a lobby without the flag handles the same mistakes', async () => {
    const { lobby } = await w.readyLobby({}, { seed: 1, behavior: badTurns((f) => ({ type: 'fire', rid: f.rid, x: 40, y: 0 }), 1) });
    expect((await w.startAndFinish(lobby.id, 2)).series).toMatchObject({ status: 'done', played: 2 });
  });
});

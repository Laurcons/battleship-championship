/* eslint-disable @typescript-eslint/no-explicit-any -- hostile input is untyped by nature */
import fc from 'fast-check';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestProgram } from './helpers/program.js';
import { wait } from './helpers/testApp.js';
import { World } from './helpers/world.js';

let w: World;
beforeEach(async () => {
  w = await World.create({ MOVE_TIMEOUT_MS: '1500', PLACE_TIMEOUT_MS: '1500', GRACE_MS: '1500', API_RATE_LIMIT: '1000000' });
});
afterEach(async () => {
  await w.close();
});

const sampleOf = <T>(arb: fc.Arbitrary<T>, n: number, seed: number): T[] => fc.sample(arb, { numRuns: n, seed });

/** Frames of every shape an attacker or a buggy program might send. */
const hostileFrame = fc.oneof(
  fc.json(),
  fc.string(),
  fc.object({ maxDepth: 3 }).map((o) => JSON.stringify(o)),
  fc.record({ type: fc.constantFrom('fire', 'placement', 'hello', 'reset', 'turn', '__proto__', 'constructor'), rid: fc.anything(), x: fc.anything(), y: fc.anything(), ships: fc.anything() }).map((o) => JSON.stringify(o)),
  fc.constant('{"type":"fire","rid":1,"x":1e308,"y":-1e308}'),
  fc.constant('{"type":"placement","rid":1,"ships":[{"len":999999999,"x":0,"y":0,"dir":"h"}]}'),
  fc.constant('{"type":"fire","rid":' + '9'.repeat(400) + ',"x":0,"y":0}'),
  fc.constant('{"__proto__":{"polluted":true},"type":"fire"}'),
  fc.constant('[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[['),
  fc.constant('\u0000\u0001�'),
);

describe('hostile programs', () => {
  it('cannot disturb a game in another lobby, or take the platform down', async () => {
    const good = await w.readyLobby({}, { seed: 1 }, { seed: 2 });
    const chaosLobby = await w.newLobby({ opponent: { kind: 'bot', bot: 'hunt-target' } });

    const attackers = await Promise.all(Array.from({ length: 6 }, (_, i) => w.connect('alice', chaosLobby.id, { seed: i, noHello: i % 2 === 1 })));
    const frames = sampleOf(hostileFrame, 400, 42);
    let bystander: Promise<any> | null = null;
    attackers.forEach((p, i) => {
      frames.forEach((f, j) => {
        if ((j + i) % attackers.length === 0 && p.socket.readyState === 1) p.send(f);
      });
    });
    bystander = w.startAndFinish(good.lobby.id, 12);
    // Keep attacking while the bystanders play.
    for (let round = 0; round < 3; round++) {
      for (const p of attackers) for (const f of sampleOf(hostileFrame, 25, 100 + round)) if (p.socket.readyState === 1) p.send(f);
      await wait(30);
    }
    const done = await bystander;
    expect(done.series).toMatchObject({ status: 'done', played: 12 });
    expect(good.a.of('error')).toHaveLength(0);
    expect(good.b.of('error')).toHaveLength(0);
    expect((await w.t.client().get('/api/health')).status).toBe(200);
    // Nothing the attackers sent polluted the process.
    expect(({} as any).polluted).toBeUndefined();
  });

  it('is told off, not crashed, when a seated program sends garbage during a game', async () => {
    const lobby = (await w.alice.post('/api/lobbies', { opponent: { kind: 'bot', bot: 'random' }, rulesetId: 'classic-10x10' })).body;
    let n = 0;
    const p = await w.connect('alice', lobby.id, {
      seed: 3,
      behavior: {
        onTurn(f, prog) {
          // Between real answers, throw junk at the platform.
          for (const junk of sampleOf(hostileFrame, 3, ++n)) prog.send(junk);
          return undefined;
        },
      },
    });
    await p.waitForFrame('welcome');
    await w.start(lobby.id, 3).catch(() => undefined);
    await wait(1500);
    // Whatever happened to the game, the platform answers and the junk was reported as errors, never as crashes.
    expect((await w.t.client().get('/api/health')).status).toBe(200);
    expect(p.of('error').every((e) => ['bad_json', 'unknown_type', 'unexpected_message', 'frame_too_large', 'rate_limited'].includes(e.code))).toBe(true);
  });
});

describe('hostile HTTP clients', () => {
  const routes: [string, string][] = [
    ['POST', '/api/auth/gate'],
    ['POST', '/api/auth/participant'],
    ['POST', '/api/auth/admin'],
    ['POST', '/api/lobbies'],
    ['POST', '/api/admin/participants'],
    ['PATCH', '/api/admin/participants/x'],
    ['POST', '/api/admin/rulesets'],
    ['PATCH', '/api/admin/rulesets/classic-10x10'],
    ['PATCH', '/api/admin/settings'],
  ];

  it('never gets a server error, whatever the body', async () => {
    const admin = w.t.client();
    await admin.loginAdmin();
    const alice = w.t.client();
    await alice.loginAs(w.t.people.Alice);
    const bodies = sampleOf(fc.oneof(fc.anything(), fc.json().map((j) => JSON.parse(j) as unknown), fc.constant({ __proto__: { x: 1 } }), fc.constant({ name: 'x'.repeat(5000) })), 120, 7);
    const lobby = (await alice.post('/api/lobbies', { opponent: { kind: 'bot', bot: 'random' }, rulesetId: 'classic-10x10' })).body;
    for (const [method, path] of routes) {
      for (const body of bodies) {
        for (const client of [admin, alice, w.t.client()]) {
          const res = await client.request(method, path, JSON.stringify(body ?? null));
          expect(res.status, `${method} ${path} ${JSON.stringify(body).slice(0, 80)}`).toBeLessThan(500);
        }
      }
    }
    // Path parameters get the same treatment.
    for (const id of ['%00', '..%2f..', 'x'.repeat(3000), '%E0%A4%A', '<script>', 'null', '__proto__']) {
      for (const suffix of ['', '/games', '/games/' + id, '/report', '/frames/1', '/series']) {
        const res = await alice.get(`/api/lobbies/${id}${suffix}`);
        expect(res.status, `GET ${id}${suffix}`).toBeLessThan(500);
      }
    }
    expect((await alice.get(`/api/lobbies/${lobby.id}`)).status).toBe(200);
  });

  it('keeps program tokens out of every response and every log of frames', async () => {
    const lobby = await w.newLobby();
    const p = await w.connect('alice', lobby.id);
    await p.waitForFrame('welcome');
    const admin = w.t.client();
    await admin.loginAdmin();
    const everything = [
      JSON.stringify((await w.alice.get(`/api/lobbies/${lobby.id}`)).body),
      JSON.stringify((await w.alice.get(`/api/lobbies/${lobby.id}/frames/1`)).body),
      JSON.stringify((await admin.get(`/api/lobbies/${lobby.id}/frames/1`)).body),
      JSON.stringify((await admin.get('/api/admin/audit')).body),
      JSON.stringify((await admin.get('/api/admin/participants')).body),
      JSON.stringify((await w.alice.get('/api/me/token')).body),
      JSON.stringify((await w.alice.get('/api/participants')).body),
    ].join('\n');
    expect(everything).not.toContain(w.aliceToken);
    expect(everything).not.toContain(w.aliceToken.slice(4)); // not even the body of it
    p.close();
  });
});

describe('connection limits', () => {
  it('refuses connections beyond the platform limit', async () => {
    const limited = await World.create({ MAX_PROGRAM_CONNECTIONS: '3' });
    try {
      const sockets: TestProgram[] = [];
      for (let i = 0; i < 3; i++) sockets.push(await TestProgram.connect(limited.t.url, { token: 'x', lobby: 'y', noHello: true }));
      await expect(TestProgram.connect(limited.t.url, { token: 'x', lobby: 'y', noHello: true })).rejects.toThrow();
      sockets.forEach((s) => s.kill());
    } finally {
      await limited.close();
    }
  });
});

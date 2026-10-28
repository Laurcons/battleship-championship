/* eslint-disable @typescript-eslint/no-explicit-any -- JSON responses are inspected loosely */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eventually, startTestApp, tokenFor, type Client, type TestApp } from './helpers/testApp.js';
import { TestProgram } from './helpers/program.js';

interface World {
  t: TestApp;
  alice: Client;
  bruno: Client;
  aliceToken: string;
  brunoToken: string;
  programs: TestProgram[];
}

let w: World;

async function setup(env: Record<string, string> = {}): Promise<World> {
  const t = await startTestApp({ env: { MOVE_TIMEOUT_MS: '400', PLACE_TIMEOUT_MS: '400', GRACE_MS: '600', HELLO_TIMEOUT_MS: '300', ...env } });
  const alice = t.client();
  await alice.loginAs(t.people.Alice);
  const bruno = t.client();
  await bruno.loginAs(t.people.Bruno);
  return { t, alice, bruno, aliceToken: await tokenFor(alice), brunoToken: await tokenFor(bruno), programs: [] };
}

beforeEach(async () => {
  w = await setup();
});
afterEach(async () => {
  for (const p of w.programs) p.kill();
  await w.t.close();
});

async function connect(client: 'alice' | 'bruno', lobby: string, extra: Partial<Parameters<typeof TestProgram.connect>[1]> = {}): Promise<TestProgram> {
  const p = await TestProgram.connect(w.t.url, { token: client === 'alice' ? w.aliceToken : w.brunoToken, lobby, ...extra });
  w.programs.push(p);
  return p;
}

const newLobby = async (body: Record<string, unknown> = {}) =>
  (await w.alice.post('/api/lobbies', { opponent: { kind: 'participant', participantId: w.t.people.Bruno }, rulesetId: 'classic-10x10', ...body })).body;

async function startAndFinish(lobbyId: string, games = 1) {
  const started = await w.alice.post(`/api/lobbies/${lobbyId}/start`, { games });
  expect(started.status).toBe(200);
  return eventually(async () => {
    const lobby = (await w.alice.get(`/api/lobbies/${lobbyId}`)).body;
    return lobby.series && lobby.series.status !== 'running' ? lobby : false;
  }, 20_000, 'the series to end');
}

describe('a game between two programs', () => {
  it('plays a whole game through the documented protocol and stores it', async () => {
    const lobby = await newLobby();
    const a = await connect('alice', lobby.id, { seed: 1 });
    const b = await connect('bruno', lobby.id, { seed: 2 });
    await a.waitForFrame('welcome');
    await b.waitForFrame('welcome');
    expect(a.received[0]).toMatchObject({ type: 'welcome', seat: 1, resumed: false, lobby: lobby.id });
    expect(b.received[0]).toMatchObject({ type: 'welcome', seat: 2, resumed: false });
    expect(a.received[0].ruleset).toMatchObject({ id: 'classic-10x10', extra_turn_on_hit: true, repeat_shot: 'invalid' });
    expect(a.received[0].limits).toMatchObject({ move_ms: 400, max_strikes: 3 });

    // Connected programs wait: nothing is sent until a participant presses Start.
    await eventually(async () => (await w.alice.get(`/api/lobbies/${lobby.id}`)).body.status === 'ready');
    expect(a.received).toHaveLength(1);
    expect((await w.alice.get(`/api/lobbies/${lobby.id}`)).body.canStart).toBe(true);

    const done = await startAndFinish(lobby.id);
    expect(done.status).toBe('ready');
    expect(done.series).toMatchObject({ status: 'done', played: 1, target: 1 });
    expect(done.series.score[1] + done.series.score[2]).toBe(1);

    for (const p of [a, b]) {
      await p.waitForFrame('game_over');
      const over = p.of('game_over')[0];
      expect(over).toMatchObject({ reason: 'sunk', series: { done: true } });
      expect(over.reveal.opponent_ships).toHaveLength(5);
      expect(p.of('place')).toHaveLength(1);
      expect(p.of('place')[0]).toMatchObject({ game: { index: 1, total: 1 }, error: null, strikes: 0 });
    }
    // Seat 1 moves first in game 1; the winner as seen by both programs agrees.
    expect(a.of('place')[0].game.first).toBe('you');
    expect(b.of('place')[0].game.first).toBe('opponent');
    expect(a.of('game_over')[0].winner === 'you').toBe(b.of('game_over')[0].winner === 'opponent');
    // Rids are unique per connection and increase.
    const rids = a.received.filter((f) => f.rid !== undefined).map((f) => f.rid);
    expect(new Set(rids).size).toBe(rids.length);

    const games = (await w.alice.get(`/api/lobbies/${lobby.id}/games`)).body;
    expect(games).toHaveLength(1);
    expect(games[0]).toMatchObject({ status: 'over', index: 1, first: 1, reason: 'sunk' });
    const detail = (await w.alice.get(`/api/lobbies/${lobby.id}/games/${games[0].id}`)).body;
    expect(detail.events.filter((e: any) => e.type === 'placed')).toHaveLength(2);
    expect(detail.events.at(-1)).toMatchObject({ type: 'game_over' });
    expect(detail.eventTimes).toHaveLength(detail.events.length);

    const report = (await w.alice.get(`/api/lobbies/${lobby.id}/report`)).body;
    expect(report.stats.played).toBe(1);

    // The raw frame log shows both directions, with the token redacted.
    const frames = (await w.alice.get(`/api/lobbies/${lobby.id}/frames/1`)).body as { dir: string; text: string }[];
    expect(frames.some((f) => f.dir === 'from_program' && f.text.includes('"type":"hello"'))).toBe(true);
    expect(frames.some((f) => f.dir === 'to_program' && f.text.includes('"type":"turn"'))).toBe(true);
    expect(JSON.stringify(frames)).not.toContain(w.aliceToken);
    expect(JSON.stringify(frames)).toContain(`bsc_••••••••${w.aliceToken.slice(-4)}`);
  });

  it('alternates the first mover and counts a battery', async () => {
    const lobby = await newLobby();
    const a = await connect('alice', lobby.id, { seed: 5 });
    const b = await connect('bruno', lobby.id, { seed: 6 });
    await a.waitForFrame('welcome');
    await b.waitForFrame('welcome');
    await eventually(async () => (await w.alice.get(`/api/lobbies/${lobby.id}`)).body.status === 'ready');
    const done = await startAndFinish(lobby.id, 6);
    expect(done.series).toMatchObject({ status: 'done', played: 6 });
    expect(done.series.score[1] + done.series.score[2]).toBe(6);
    const games = (await w.alice.get(`/api/lobbies/${lobby.id}/games`)).body;
    expect(games.map((g: any) => g.first)).toEqual([1, 2, 1, 2, 1, 2]);
    expect(new Set(games.map((g: any) => g.id)).size).toBe(6);
    // `place` carries the index; the last game_over says the series is done, earlier ones do not.
    expect(a.of('game_over').map((f) => f.series.done)).toEqual([false, false, false, false, false, true]);
    expect(a.of('place').map((f) => f.game.index)).toEqual([1, 2, 3, 4, 5, 6]);
    expect((await w.alice.get(`/api/lobbies/${lobby.id}/report`)).body.stats.played).toBe(6);
  });

  it('plays against a practice bot through the same path', async () => {
    const lobby = (await w.alice.post('/api/lobbies', { opponent: { kind: 'bot', bot: 'hunt-target' }, rulesetId: 'classic-10x10' })).body;
    const a = await connect('alice', lobby.id);
    await a.waitForFrame('welcome');
    await eventually(async () => (await w.alice.get(`/api/lobbies/${lobby.id}`)).body.canStart);
    const done = await startAndFinish(lobby.id, 25);
    expect(done.series).toMatchObject({ status: 'done', played: 25 });
    expect(a.of('game_over')).toHaveLength(25);
  });

  it('lets one participant play against themselves, taking the first empty seat each time', async () => {
    const lobby = (await w.alice.post('/api/lobbies', { opponent: { kind: 'participant', participantId: w.t.people.Alice }, rulesetId: 'classic-10x10' })).body;
    const p1 = await connect('alice', lobby.id, { seed: 1 });
    await p1.waitForFrame('welcome');
    const p2 = await connect('alice', lobby.id, { seed: 2 });
    await p2.waitForFrame('welcome');
    expect([p1.received[0].seat, p2.received[0].seat]).toEqual([1, 2]);
    // A third program is refused: the lobby is full.
    const p3 = await connect('alice', lobby.id);
    expect((await p3.waitForClose()).code).toBe(4409);
    await eventually(async () => (await w.alice.get(`/api/lobbies/${lobby.id}`)).body.canStart);
    expect((await startAndFinish(lobby.id)).series.status).toBe('done');
  });
});

describe('the handshake', () => {
  it('refuses a wrong token, an unknown lobby and a lobby you are not in in exactly the same way', async () => {
    const lobby = await newLobby();
    const wrongToken = await TestProgram.connect(w.t.url, { token: 'bsc_' + 'a'.repeat(32), lobby: lobby.id });
    const unknownLobby = await TestProgram.connect(w.t.url, { token: w.aliceToken, lobby: 'ZZZZ-ZZZZ-0' });
    const chen = w.t.client();
    await chen.loginAs(w.t.people.Chen);
    const chenToken = await tokenFor(chen);
    const notMine = await TestProgram.connect(w.t.url, { token: chenToken, lobby: lobby.id });
    const garbageToken = await TestProgram.connect(w.t.url, { token: 'hunter2', lobby: lobby.id });
    const results = await Promise.all([wrongToken, unknownLobby, notMine, garbageToken].map(async (p) => ({ close: await p.waitForClose(), frames: p.received })));
    for (const r of results) {
      expect(r.close.code).toBe(4401);
      expect(r.frames).toEqual([{ type: 'error', code: 'auth_failed', message: 'Authentication failed.', fatal: true }]);
    }
    expect(new Set(results.map((r) => r.close.reason)).size).toBe(1);
  });

  it('refuses a participant without a token and tokens replaced since', async () => {
    const lobby = await newLobby();
    const old = w.aliceToken;
    w.aliceToken = (await w.alice.post('/api/me/token/replace')).body.token;
    const stale = await TestProgram.connect(w.t.url, { token: old, lobby: lobby.id });
    expect((await stale.waitForClose()).code).toBe(4401);
    const fresh = await connect('alice', lobby.id);
    await fresh.waitForFrame('welcome');
  });

  it('refuses a lobby whose ruleset is not accepted, naming the ruleset (only after authentication)', async () => {
    const lobby = await newLobby();
    const p = await connect('alice', lobby.id, { accepts: ['some-other-ruleset'] });
    const close = await p.waitForClose();
    expect(close.code).toBe(4426);
    expect(p.received[0]).toMatchObject({ code: 'ruleset_mismatch', fatal: true });
    expect(p.received[0].message).toContain('classic-10x10');
  });

  it('accepts lobby ids typed in lower case without dashes', async () => {
    const lobby = await newLobby();
    const p = await connect('alice', lobby.id.replace(/-/g, '').toLowerCase());
    await p.waitForFrame('welcome');
    expect(p.received[0].lobby).toBe(lobby.id);
  });

  it('closes a connection that says nothing, and one that starts with something other than hello', async () => {
    const quiet = await TestProgram.connect(w.t.url, { token: w.aliceToken, lobby: 'x', noHello: true });
    w.programs.push(quiet);
    expect((await quiet.waitForClose()).code).toBe(4408);
    const rude = await TestProgram.connect(w.t.url, { token: w.aliceToken, lobby: 'x', noHello: true });
    rude.send({ type: 'fire', rid: 1, x: 0, y: 0 });
    expect((await rude.waitForClose()).code).toBe(4400);
    const junk = await TestProgram.connect(w.t.url, { token: w.aliceToken, lobby: 'x', noHello: true });
    junk.send('not json at all');
    expect((await junk.waitForClose()).code).toBe(4400);
    expect(junk.received[0]).toMatchObject({ code: 'bad_json', fatal: true });
  });

  it('rejects binary and oversized frames fatally', async () => {
    const big = await TestProgram.connect(w.t.url, { token: w.aliceToken, lobby: 'x', noHello: true });
    big.send('x'.repeat(20_000));
    expect((await big.waitForClose()).code).toBe(4400);
    expect(big.received[0]).toMatchObject({ code: 'frame_too_large', fatal: true });
    const bin = await TestProgram.connect(w.t.url, { token: w.aliceToken, lobby: 'x', noHello: true });
    bin.socket.send(Buffer.from([1, 2, 3]));
    expect((await bin.waitForClose()).code).toBe(4400);
  });

  it('only upgrades on the protocol path', async () => {
    const WebSocket = (await import('ws')).default;
    const ws = new WebSocket(`${w.t.url.replace('http', 'ws')}/program/v2`);
    const error = await new Promise<Error>((resolve) => ws.once('error', resolve));
    expect(error.message).toMatch(/404/);
  });

  it('shows the program name and version in the lobby, and the connection state', async () => {
    const lobby = await newLobby();
    const p = await connect('alice', lobby.id, { program: { name: 'sharpshooter', version: '2.1' } });
    await p.waitForFrame('welcome');
    const seats = (await w.alice.get(`/api/lobbies/${lobby.id}`)).body.seats;
    expect(seats[0]).toMatchObject({ connection: 'connected', program: { name: 'sharpshooter', version: '2.1' } });
    expect(seats[1].connection).toBe('disconnected');
    p.close();
    await eventually(async () => (await w.alice.get(`/api/lobbies/${lobby.id}`)).body.seats[0].connection === 'disconnected');
  });
});

/* eslint-disable @typescript-eslint/no-explicit-any -- frames and JSON responses are inspected loosely */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MemoryStore } from '../src/store/memory.js';
import { RuntimeService } from '../src/platform/runtime/runtime.service.js';
import { TestProgram, type Behavior } from './helpers/program.js';
import { SseReader } from './helpers/sse.js';
import { eventually, startTestApp, wait } from './helpers/testApp.js';
import { World } from './helpers/world.js';

let w: World;
beforeEach(async () => {
  w = await World.create({ GRACE_MS: '700' });
});
afterEach(async () => {
  await w.close();
});

/** Drops the connection (as a crash would) when its n-th turn arrives. */
const crashOnTurn = (n: number): Behavior => {
  let count = 0;
  return {
    onTurn(_f, p) {
      if (++count === n) {
        p.kill();
        return null;
      }
      return undefined;
    },
  };
};

describe('resuming after a dropped connection', () => {
  it('pauses, accepts the program back within the grace period, re-issues the request, and finishes', async () => {
    const { lobby, a } = await w.readyLobby({}, { seed: 1, behavior: crashOnTurn(3) });
    await w.start(lobby.id);
    await a.waitForClose();
    await eventually(async () => (await w.lobby(lobby.id)).status === 'paused', 3000, 'paused');
    const paused = await w.lobby(lobby.id);
    expect(paused.seats[0]).toMatchObject({ connection: 'grace' });
    expect(paused.seats[0].graceEndsAt).toBeGreaterThan(Date.now() - 100);
    const lastRid = a.of('turn').at(-1).rid;

    const back = await w.connect('alice', lobby.id, { seed: 9 }); // a restarted program: no session_id
    await back.waitForFrame('welcome');
    expect(back.received[0]).toMatchObject({ type: 'welcome', seat: 1, resumed: true });
    await back.waitForFrame('turn');
    expect(back.of('turn')[0].rid).toBeGreaterThan(lastRid);
    expect(back.of('turn')[0].enemy.join('')).toMatch(/[ox]/); // the full state arrives with the re-issued request

    const done = await w.untilSeriesEnds(lobby.id);
    expect(done.series).toMatchObject({ status: 'done', played: 1 });
    const game = (await w.games(lobby.id))[0];
    expect(game.reason).toBe('sunk');
    // The platform notes the interruption in the frame log.
    const frames = (await w.alice.get(`/api/lobbies/${lobby.id}/frames/1`)).body as { dir: string; text: string }[];
    expect(frames.some((f) => f.dir === 'note' && /Resume window started/.test(f.text))).toBe(true);
  });

  it('does not bother the opponent when the other program drops while it is waiting', async () => {
    const { lobby, a, b } = await w.readyLobby({}, { seed: 1 }, { seed: 2, behavior: crashOnTurn(2) });
    await w.start(lobby.id);
    await b.waitForClose();
    const back = await w.connect('bruno', lobby.id, { seed: 3 });
    await back.waitForFrame('welcome');
    expect(back.received[0].resumed).toBe(true);
    expect((await w.untilSeriesEnds(lobby.id)).series.status).toBe('done');
    expect(a.of('error')).toHaveLength(0);
    expect(a.closed).toBeNull();
  });

  it('lets a program reclaim exactly its old seat with its session_id (self-play)', async () => {
    const lobby = (await w.alice.post('/api/lobbies', { opponent: { kind: 'participant', participantId: w.t.people.Alice }, rulesetId: 'classic-10x10' })).body;
    const p1 = await w.connect('alice', lobby.id, { seed: 1 });
    await p1.waitForFrame('welcome');
    const p2 = await w.connect('alice', lobby.id, { seed: 2 });
    await p2.waitForFrame('welcome');
    await eventually(async () => (await w.lobby(lobby.id)).canStart);
    await w.start(lobby.id, 3);
    p1.kill();
    p2.kill();
    await eventually(async () => (await w.lobby(lobby.id)).seats.every((s: any) => s.connection === 'grace'));
    // Without a session id the first empty seat would be seat 1; with seat 2's id it must be seat 2.
    const back2 = await w.connect('alice', lobby.id, { seed: 2, sessionId: p2.sessionId as string });
    await back2.waitForFrame('welcome');
    expect(back2.received[0]).toMatchObject({ seat: 2, resumed: true });
    const back1 = await w.connect('alice', lobby.id, { seed: 1 });
    await back1.waitForFrame('welcome');
    expect(back1.received[0]).toMatchObject({ seat: 1, resumed: true });
    expect((await w.untilSeriesEnds(lobby.id)).series).toMatchObject({ status: 'done', played: 3 });
    // An unknown or expired session id is simply ignored.
    const stranger = await w.connect('alice', lobby.id, { sessionId: 's_unknown' });
    expect((await stranger.waitForClose()).code).toBe(4409);
  });

  it('replaces a half-open connection when the same program comes back before the platform noticed', async () => {
    const lobby = await w.newLobby();
    const first = await w.connect('alice', lobby.id);
    await first.waitForFrame('welcome');
    const second = await w.connect('alice', lobby.id);
    await second.waitForFrame('welcome');
    expect(second.received[0].seat).toBe(1);
    expect((await first.waitForClose()).code).toBe(4000);
    expect((await w.lobby(lobby.id)).seats[0].connection).toBe('connected');
  });

  it('shows a disconnect while waiting as plain "disconnected", with no resume window', async () => {
    const { lobby, b } = await w.readyLobby();
    b.kill();
    await eventually(async () => (await w.lobby(lobby.id)).status === 'waiting');
    const seat = (await w.lobby(lobby.id)).seats[1];
    expect(seat).toMatchObject({ connection: 'disconnected', graceEndsAt: null });
    expect((await w.alice.post(`/api/lobbies/${lobby.id}/start`, { games: 1 })).status).toBe(409);
  });
});

describe('when the program does not come back', () => {
  it('forfeits a single game for the absent seat', async () => {
    const { lobby, b } = await w.readyLobby({}, { seed: 1, behavior: crashOnTurn(2) });
    await w.start(lobby.id);
    const done = await w.untilSeriesEnds(lobby.id);
    expect(done.series).toMatchObject({ status: 'done', played: 1, score: { 1: 0, 2: 1 } });
    expect((await w.games(lobby.id))[0]).toMatchObject({ reason: 'disconnect', winner: 2 });
    await b.waitForFrame('game_over');
    expect(b.of('game_over')[0]).toMatchObject({ winner: 'you', reason: 'disconnect' });
  });

  it('aborts a battery, keeps the partial results, and voids the interrupted game', async () => {
    let turns = 0;
    const behavior: Behavior = {
      onTurn(f, p) {
        if (f.game.index === 3 && ++turns === 2) {
          p.kill();
          return null;
        }
        return undefined;
      },
    };
    const { lobby } = await w.readyLobby({}, { seed: 1, behavior });
    await w.start(lobby.id, 5);
    const done = await w.untilSeriesEnds(lobby.id);
    expect(done.series.status).toBe('aborted');
    expect(done.series.played).toBe(2);
    expect(done.series.abortReason).toMatch(/Alice.*did not reconnect/);
    const games = await w.games(lobby.id);
    expect(games.map((g: any) => g.status)).toEqual(['over', 'over', 'void']);
    const report = (await w.alice.get(`/api/lobbies/${lobby.id}/report`)).body;
    expect(report.stats.played).toBe(2);
    expect(done.seats.map((s: any) => s.connection)).not.toContain('grace');
    // The lobby is usable again afterwards.
    const again = await w.connect('alice', lobby.id);
    await again.waitForFrame('welcome');
    await eventually(async () => (await w.lobby(lobby.id)).status === 'ready');
  });
});

describe('restart and reset', () => {
  it('restarts the game in progress: reset frame, same game number, void game kept in the history', async () => {
    const stall: Behavior = {
      onTurn(f, p) {
        // Play slowly enough for the restart to land mid-game.
        setTimeout(() => p.send({ type: 'fire', rid: f.rid, x: 0, y: 0 }), 5);
        return null;
      },
    };
    const { lobby, a, b } = await w.readyLobby({}, { seed: 1, behavior: stall, accepts: ['classic-10x10'] });
    await w.start(lobby.id, 2);
    await a.waitForFrame('turn', 2);
    const restarted = await w.alice.post(`/api/lobbies/${lobby.id}/restart-game`);
    expect(restarted.status).toBe(200);
    await a.waitForFrame('reset');
    await b.waitForFrame('reset');
    expect(a.of('reset')[0]).toEqual({ type: 'reset', reason: 'restart_game' });
    await a.waitForFrame('place', 2);
    expect(a.of('place').map((p) => p.game.index).slice(0, 2)).toEqual([1, 1]);
    expect(a.of('place')[1].game.id).not.toBe(a.of('place')[0].game.id);
    a.behavior = {}; // play properly from here
    const games = await w.games(lobby.id);
    expect(games[0]).toMatchObject({ index: 1, status: 'void' });
    const done = await w.untilSeriesEnds(lobby.id);
    expect(done.series).toMatchObject({ status: 'done', played: 2 });
    expect((await w.games(lobby.id)).filter((g: any) => g.status === 'over')).toHaveLength(2);
    const audit = (await (async () => { const c = w.t.client(); await c.loginAdmin(); return c.get('/api/admin/audit'); })()).body;
    expect(audit.some((e: any) => e.action === 'game_restarted' && e.actor === 'Alice')).toBe(true);
  });

  it('resets the battery: results discarded, programs told, and the lobby can start again', async () => {
    const { lobby, a, b } = await w.readyLobby();
    await w.start(lobby.id, 500);
    await eventually(async () => (await w.games(lobby.id)).filter((g: any) => g.status === 'over').length >= 2, 15_000, 'two games');
    const reset = await w.bruno.post(`/api/lobbies/${lobby.id}/reset-series`);
    expect(reset.status).toBe(200);
    expect(reset.body.series).toBeNull();
    expect(a.of('reset').at(-1)).toEqual({ type: 'reset', reason: 'reset_series' });
    expect(b.of('reset').at(-1)).toEqual({ type: 'reset', reason: 'reset_series' });
    expect(await w.games(lobby.id)).toEqual([]);
    expect((await w.alice.get(`/api/lobbies/${lobby.id}/report`)).body).toBeNull();
    expect(await w.lobby(lobby.id)).toMatchObject({ status: 'ready', series: null });
    const placesBefore = a.of('place').length;
    await wait(100);
    expect(a.of('place').length).toBe(placesBefore); // nothing keeps running
    const done = await w.startAndFinish(lobby.id, 2);
    expect(done.series).toMatchObject({ status: 'done', played: 2 });
  });
});

describe('the platform dropping connections', () => {
  it('disconnects programs with close code 4000 when their token is replaced', async () => {
    const { lobby, a, b } = await w.readyLobby();
    const fresh = (await w.alice.post('/api/me/token/replace')).body.token as string;
    expect((await a.waitForClose()).code).toBe(4000);
    expect(b.closed).toBeNull();
    await eventually(async () => (await w.lobby(lobby.id)).seats[0].connection === 'disconnected');
    // The old token no longer works; the new one does.
    const old = await TestProgram.connect(w.t.url, { token: w.aliceToken, lobby: lobby.id });
    expect((await old.waitForClose()).code).toBe(4401);
    w.aliceToken = fresh;
    const back = await w.connect('alice', lobby.id);
    await back.waitForFrame('welcome');
  });

  it('closes programs when the lobby is deleted', async () => {
    const { lobby, a, b } = await w.readyLobby();
    await w.start(lobby.id, 100);
    await w.bruno.del(`/api/lobbies/${lobby.id}`);
    expect((await a.waitForClose()).code).toBe(4000);
    expect((await b.waitForClose()).code).toBe(4000);
    await wait(50);
    expect((await w.alice.get(`/api/lobbies/${lobby.id}`)).status).toBe(404);
  });
});

describe('platform restart', () => {
  it('voids the game in progress, keeps the series, and finishes it when the programs reconnect', async () => {
    const store = new MemoryStore();
    const first = await startTestApp({ store, env: { MOVE_TIMEOUT_MS: '400', PLACE_TIMEOUT_MS: '400', GRACE_MS: '3000', HELLO_TIMEOUT_MS: '300' } });
    const alice = first.client();
    await alice.loginAs(first.people.Alice);
    const bruno = first.client();
    await bruno.loginAs(first.people.Bruno);
    const aliceToken = (await alice.post('/api/me/token')).body.token as string;
    const brunoToken = (await bruno.post('/api/me/token')).body.token as string;
    const lobby = (await alice.post('/api/lobbies', { opponent: { kind: 'participant', participantId: first.people.Bruno }, rulesetId: 'classic-10x10' })).body;
    const p1 = await TestProgram.connect(first.url, { token: aliceToken, lobby: lobby.id, seed: 1 });
    const p2 = await TestProgram.connect(first.url, { token: brunoToken, lobby: lobby.id, seed: 2 });
    await p1.waitForFrame('welcome');
    await p2.waitForFrame('welcome');
    await eventually(async () => (await alice.get(`/api/lobbies/${lobby.id}`)).body.canStart);
    await alice.post(`/api/lobbies/${lobby.id}/start`, { games: 300 });
    await eventually(async () => (await alice.get(`/api/lobbies/${lobby.id}/games`)).body.filter((g: any) => g.status === 'over').length >= 3, 15_000, 'three games');
    await first.close(); // the platform stops: a game is in progress
    p1.kill();
    p2.kill();
    const played = (await store.listSeries(lobby.id))[0]!;
    expect(played.status).toBe('running');
    expect(played.played).toBeGreaterThanOrEqual(3);

    const second = await startTestApp({ store, names: [], env: { MOVE_TIMEOUT_MS: '400', PLACE_TIMEOUT_MS: '400', GRACE_MS: '3000', HELLO_TIMEOUT_MS: '300' } });
    try {
      const a2 = second.client();
      const gate = await a2.post('/api/auth/gate', { password: 'correct horse battery staple' });
      await a2.post('/api/auth/participant', { participantId: gate.body.find((p: any) => p.name === 'Alice').id });
      const waiting = (await a2.get(`/api/lobbies/${lobby.id}`)).body;
      expect(waiting.status).toBe('paused');
      expect(waiting.seats.map((s: any) => s.connection)).toEqual(['grace', 'grace']);
      expect(waiting.series).toMatchObject({ status: 'running', played: played.played });
      const q1 = await TestProgram.connect(second.url, { token: aliceToken, lobby: lobby.id, seed: 11 });
      const q2 = await TestProgram.connect(second.url, { token: brunoToken, lobby: lobby.id, seed: 12 });
      await q1.waitForFrame('welcome');
      await q2.waitForFrame('welcome');
      expect(q1.received[0].resumed).toBe(true);
      await eventually(async () => (await a2.get(`/api/lobbies/${lobby.id}`)).body.series.played > played.played + 1, 15_000, 'progress after the restart');
      // The voided game is not counted, and no game number is skipped.
      const idx = (await a2.get(`/api/lobbies/${lobby.id}/games`)).body.filter((g: any) => g.status === 'over').map((g: any) => g.index);
      expect(idx).toEqual([...idx].sort((x, y) => x - y));
      expect(new Set(idx).size).toBe(idx.length);
      q1.kill();
      q2.kill();
    } finally {
      await second.close();
    }
  });
});

describe('idle lobbies', () => {
  it('expire: programs are disconnected and the lobby becomes read-only', async () => {
    let now = Date.now();
    const clock = { now: () => now };
    const t = await startTestApp({ clock, env: { IDLE_EXPIRY_MS: '60000', HELLO_TIMEOUT_MS: '300' } });
    try {
      const alice = t.client();
      await alice.loginAs(t.people.Alice);
      const token = (await alice.post('/api/me/token')).body.token as string;
      const lobby = (await alice.post('/api/lobbies', { opponent: { kind: 'bot', bot: 'random' }, rulesetId: 'classic-10x10' })).body;
      const p = await TestProgram.connect(t.url, { token, lobby: lobby.id });
      await p.waitForFrame('welcome');
      now += 61_000;
      t.app.get(RuntimeService).sweep();
      expect((await p.waitForClose()).code).toBe(4000);
      expect((await alice.get(`/api/lobbies/${lobby.id}`)).body).toMatchObject({ status: 'expired', canStart: false });
      expect((await alice.post(`/api/lobbies/${lobby.id}/start`, { games: 1 })).status).toBe(409);
      const late = await TestProgram.connect(t.url, { token, lobby: lobby.id });
      expect((await late.waitForClose()).code).toBe(4410);
      expect(late.of('error')).toMatchObject([{ code: 'lobby_expired', fatal: true }]);
      // A stranger with a valid token learns nothing: the lobby just looks unknown to them.
      const bruno = t.client();
      await bruno.loginAs(t.people.Bruno);
      const brunoToken = (await bruno.post('/api/me/token')).body.token as string;
      const nosy = await TestProgram.connect(t.url, { token: brunoToken, lobby: lobby.id });
      expect((await nosy.waitForClose()).code).toBe(4401);
    } finally {
      await t.close();
    }
  });
});

describe('what viewers are sent', () => {
  it('never sends a restricted viewer the opponent layout while a game is live, and everything afterwards', async () => {
    const { lobby, a, b } = await w.readyLobby({ godMode: false }, { seed: 21, delayMs: 3 }, { seed: 22, delayMs: 3 });
    const bruno = await SseReader.open(w.bruno, w.t.url, lobby.id);
    const alice = await SseReader.open(w.alice, w.t.url, lobby.id);
    const adminClient = w.t.client();
    await adminClient.loginAdmin();
    const admin = await SseReader.open(adminClient, w.t.url, lobby.id);
    expect(bruno.status).toBe(200);
    try {
    await w.startAndFinish(lobby.id, 3);
    await wait(250); // let the last update arrive

    const placements = (p: TestProgram) => p.sent.map((s) => JSON.parse(s)).filter((f) => f.type === 'placement');
    const aliceShips = placements(a).map((f) => JSON.stringify(f.ships));
    const brunoShips = placements(b).map((f) => JSON.stringify(f.ships));
    expect(aliceShips.length).toBeGreaterThanOrEqual(3);

    const live = (r: SseReader) => r.raw.filter((_, i) => r.updates[i].game?.status === 'live');
    expect(live(bruno).length).toBeGreaterThan(0);
    for (const chunk of live(bruno)) for (const ships of aliceShips) expect(chunk).not.toContain(ships);
    for (const chunk of live(alice)) for (const ships of brunoShips) expect(chunk).not.toContain(ships);
    // In a live game each restricted viewer sees their own placement and a hidden one for the other seat.
    const sample = bruno.updates.find((u) => u.game?.status === 'live' && u.game.events.some((e: any) => e.type === 'placed'));
    expect(sample.game.viewerMode).toBe('restricted');
    expect(sample.game.events.filter((e: any) => e.type === 'placed').map((e: any) => [e.seat, e.ships === null])).toEqual(expect.arrayContaining([[1, true]]));
    // The admin sees everything, live.
    expect(live(admin).some((chunk) => aliceShips.some((s) => chunk.includes(s)))).toBe(true);
    // Once a game is over, both participants can see the full record.
    const first = (await w.games(lobby.id))[0];
    const finished = (await w.bruno.get(`/api/lobbies/${lobby.id}/games/${first.id}`)).body;
    expect(JSON.stringify(finished)).toContain(aliceShips[0]);
    expect(finished.events.filter((e: any) => e.type === 'placed').every((e: any) => e.ships !== null)).toBe(true);
    } finally {
      await Promise.all([bruno.close(), alice.close(), admin.close()]);
    }
  });

  it('applies the same rule to the history endpoint during a live game', async () => {
    const { lobby } = await w.readyLobby({ godMode: false });
    await w.start(lobby.id, 300);
    const seen = await eventually(async () => {
      const live = (await w.games(lobby.id)).find((g: any) => g.status === 'live');
      return live ? live : false;
    }, 5000, 'a live game');
    const liveGame = await w.bruno.get(`/api/lobbies/${lobby.id}/games/${seen.id}`);
    if (liveGame.status === 200 && liveGame.body.status === 'live') {
      expect(liveGame.body.events.filter((e: any) => e.type === 'placed' && e.seat === 1).every((e: any) => e.ships === null)).toBe(true);
    }
    await w.alice.post(`/api/lobbies/${lobby.id}/reset-series`);
  });
});

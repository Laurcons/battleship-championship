/* eslint-disable @typescript-eslint/no-explicit-any -- JSON responses are inspected loosely */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PrismaStore } from '../src/store/prisma.js';
import { startTestApp, eventually } from './helpers/testApp.js';
import { TestProgram } from './helpers/program.js';
import { createTestDatabase } from './helpers/testDb.js';
import { World } from './helpers/world.js';

/** The same platform, on a real MariaDB. */

let db: Awaited<ReturnType<typeof createTestDatabase>>;
let w: World;
beforeEach(async () => {
  db = await createTestDatabase();
  w = await World.create({}, new PrismaStore({ databaseUrl: db.url }));
});
afterEach(async () => {
  await w.close().catch(() => undefined); // a test may already have stopped the app
  await db.cleanup();
});

/** A lobby against a practice bot with one connected program. */
async function botLobby(bot: 'random' | 'hunt-target', opts: { seed?: number } = {}) {
  const lobby = await w.newLobby({ opponent: { kind: 'bot', bot } });
  const a = await w.connect('alice', lobby.id, { seed: opts.seed ?? 1 });
  await a.waitForFrame('welcome');
  await eventually(async () => (await w.lobby(lobby.id)).canStart, 8000, 'canStart');
  return { lobby, a };
}

describe('on MariaDB', () => {
  it('stores batteries, their games and statistics, and serves them back', async () => {
    const { lobby } = await botLobby('hunt-target', { seed: 3 });
    const started = Date.now();
    const done = await w.startAndFinish(lobby.id, 60);
    const elapsed = Date.now() - started;
    expect(done.series).toMatchObject({ status: 'done', played: 60 });
    const games = await w.games(lobby.id);
    expect(games).toHaveLength(60);
    expect(games.every((g: any) => g.status === 'over')).toBe(true);
    const detail = await w.game(lobby.id, games[7].id);
    expect(detail.events.length).toBeGreaterThan(10);
    expect(detail.eventTimes).toHaveLength(detail.events.length);
    const report = (await w.alice.get(`/api/lobbies/${lobby.id}/report`)).body;
    expect(report.stats.played).toBe(60);
    expect(report.stats.seats['1'].wins + report.stats.seats['2'].wins).toBe(60);
    expect(report.heatmap.games).toBe(60);
    // A 60-game battery with a real WebSocket program and database writes should take a few seconds, not minutes.
    expect(elapsed).toBeLessThan(20_000);
  });

  it('survives a platform restart with all data intact, and stores text with emoji and quotes exactly', async () => {
    const { lobby } = await w.readyLobby(
      {},
      {
        seed: 1,
        behavior: {
          onTurn: (() => {
            let n = 0;
            return (f: any, p: TestProgram) => {
              if (++n === 1) {
                p.send('{"type":"fire","rid":' + f.rid + ',"x":"🚢 \\"quoted\\" \\u2028","y":1}');
                return null;
              }
              return undefined;
            };
          })(),
        },
      },
    );
    await w.startAndFinish(lobby.id, 2);
    const before = await w.games(lobby.id);
    const aliceToken = w.aliceToken;
    const url = db.url;
    await w.t.close();

    const t2 = await startTestApp({ store: new PrismaStore({ databaseUrl: url }), names: [] });
    try {
      const alice = t2.client();
      const gate = await alice.post('/api/auth/gate', { password: 'correct horse battery staple' });
      await alice.post('/api/auth/participant', { participantId: gate.body.find((p: any) => p.name === 'Alice').id });
      const after = (await alice.get(`/api/lobbies/${lobby.id}/games`)).body;
      expect(after).toEqual(before.map((g: any) => ({ ...g, durationMs: g.durationMs })));
      const detail = (await alice.get(`/api/lobbies/${lobby.id}/games/${after[0].id}`)).body;
      const infraction = detail.events.find((e: any) => e.type === 'infraction');
      expect(infraction.raw).toContain('🚢 \\"quoted\\"');
      // The token created before the restart still works (only its hash was stored).
      const p = await TestProgram.connect(t2.url, { token: aliceToken, lobby: lobby.id });
      await p.waitForFrame('welcome');
      p.kill();
    } finally {
      await t2.close();
    }
  });

  it('removes a lobby together with its series and games', async () => {
    const { lobby } = await botLobby('random');
    await w.startAndFinish(lobby.id, 3);
    expect((await w.alice.del(`/api/lobbies/${lobby.id}`)).status).toBe(204);
    expect((await w.alice.get(`/api/lobbies/${lobby.id}/games`)).status).toBe(404);
  });
});

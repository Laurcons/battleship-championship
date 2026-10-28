/* eslint-disable @typescript-eslint/no-explicit-any -- JSON responses are inspected loosely */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PrismaStore } from '../src/store/prisma.js';
import { eventually } from './helpers/testApp.js';
import { createTestDatabase } from './helpers/testDb.js';
import { World } from './helpers/world.js';

/** Long-running checks, on MariaDB: `pnpm test:soak`. Not part of `test:all`. */

let db: Awaited<ReturnType<typeof createTestDatabase>>;
let w: World;
beforeEach(async () => {
  db = await createTestDatabase();
  w = await World.create({ MOVE_TIMEOUT_MS: '5000', PLACE_TIMEOUT_MS: '5000', API_RATE_LIMIT: '1000000' }, new PrismaStore({ databaseUrl: db.url, connectionLimit: 8 }));
});
afterEach(async () => {
  await w.close().catch(() => undefined);
  await db.cleanup();
});

const heapMb = () => {
  (globalThis as any).gc?.();
  return process.memoryUsage().heapUsed / 1024 / 1024;
};

describe('soak', () => {
  it('plays a 1000-game battery against a practice bot without leaking memory', async () => {
    const lobby = await w.newLobby({ opponent: { kind: 'bot', bot: 'hunt-target' } });
    const p = await w.connect('alice', lobby.id, { seed: 11 });
    await p.waitForFrame('welcome');
    await eventually(async () => (await w.lobby(lobby.id)).canStart);
    const before = heapMb();
    const started = Date.now();
    await w.start(lobby.id, 1000);
    const done = await w.untilSeriesEnds(lobby.id, 540_000);
    const seconds = (Date.now() - started) / 1000;
    const after = heapMb();
    console.log(`1000 games in ${seconds.toFixed(1)} s; heap ${before.toFixed(0)} -> ${after.toFixed(0)} MB`);
    expect(done.series).toMatchObject({ status: 'done', played: 1000 });
    expect((await w.games(lobby.id)).filter((g: any) => g.status === 'over')).toHaveLength(1000);
    const report = (await w.alice.get(`/api/lobbies/${lobby.id}/report`)).body;
    expect(report.stats.played).toBe(1000);
    // The frame log is a bounded ring buffer, whatever the battery size.
    const frames = (await w.alice.get(`/api/lobbies/${lobby.id}/frames/1`)).body;
    expect(frames.length).toBeLessThanOrEqual(2000);
    expect(after - before).toBeLessThan(150);
  });

  it('runs ten lobbies at once without them disturbing each other', async () => {
    const lobbies = await Promise.all(Array.from({ length: 10 }, (_, i) => w.readyLobby({}, { seed: 100 + i }, { seed: 200 + i })));
    const started = Date.now();
    await Promise.all(lobbies.map((l) => w.start(l.lobby.id, 100)));
    const results = await Promise.all(lobbies.map((l) => w.untilSeriesEnds(l.lobby.id, 540_000)));
    console.log(`10 lobbies x 100 games in ${((Date.now() - started) / 1000).toFixed(1)} s`);
    for (const r of results) expect(r.series).toMatchObject({ status: 'done', played: 100 });
    for (const l of lobbies) expect(l.a.of('error')).toHaveLength(0);
  });
});

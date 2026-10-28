import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp, type Client, type TestApp } from './helpers/testApp.js';

let t: TestApp;
let admin: Client;
let alice: Client;
let bruno: Client;
let chen: Client;
const aliceId = () => t.people.Alice as string;
const brunoId = () => t.people.Bruno as string;

beforeAll(async () => {
  t = await startTestApp({ env: { MAX_OPEN_LOBBIES: '3' } });
  admin = t.client();
  await admin.loginAdmin();
  alice = t.client();
  await alice.loginAs(aliceId());
  bruno = t.client();
  await bruno.loginAs(brunoId());
  chen = t.client();
  await chen.loginAs(t.people.Chen as string);
});
afterAll(async () => {
  await t.close();
});

const vsBruno = (extra: Record<string, unknown> = {}) => ({
  opponent: { kind: 'participant', participantId: brunoId() },
  rulesetId: 'classic-10x10',
  ...extra,
});

async function cleanup(c: Client) {
  for (const l of (await c.get('/api/lobbies')).body) await c.del(`/api/lobbies/${l.id}`);
}

describe('creating lobbies', () => {
  it('creates a lobby with a readable, checked id and shows it to both players but nobody else', async () => {
    const created = await alice.post('/api/lobbies', vsBruno());
    expect(created.status).toBe(201);
    expect(created.body.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]$/);
    expect(created.body).toMatchObject({ status: 'waiting', mySeats: [1], createdBy: { name: 'Alice' }, godMode: true, viewerMode: 'god' });
    expect(created.body.seats.map((s: { connection: string }) => s.connection)).toEqual(['disconnected', 'disconnected']);
    expect((await bruno.get(`/api/lobbies/${created.body.id}`)).body.mySeats).toEqual([2]);
    expect((await chen.get('/api/lobbies')).body).toEqual([]);
    expect((await admin.get('/api/lobbies')).body.map((l: { id: string }) => l.id)).toContain(created.body.id);
    await cleanup(alice);
  });

  it('puts practice bots on seat 2, already connected, and forces god mode', async () => {
    const r = await alice.post('/api/lobbies', { opponent: { kind: 'bot', bot: 'hunt-target' }, rulesetId: 'classic-10x10', godMode: false });
    expect(r.status).toBe(201);
    expect(r.body.godMode).toBe(true);
    expect(r.body.seats[1]).toMatchObject({ connection: 'connected', owner: { kind: 'bot', bot: 'hunt-target' } });
    expect((await alice.post('/api/lobbies', { opponent: { kind: 'bot', bot: 'nope' }, rulesetId: 'classic-10x10' })).status).toBe(400);
    await cleanup(alice);
  });

  it('lets the creator choose god mode; self-play is always god mode', async () => {
    const restricted = await alice.post('/api/lobbies', vsBruno({ godMode: false }));
    expect(restricted.body).toMatchObject({ godMode: false, viewerMode: 'restricted' });
    expect((await bruno.get(`/api/lobbies/${restricted.body.id}`)).body).toMatchObject({ godMode: false, viewerMode: 'restricted' });
    expect((await admin.get(`/api/lobbies/${restricted.body.id}`)).body.viewerMode).toBe('god');
    const defaulted = await alice.post('/api/lobbies', vsBruno());
    expect(defaulted.body.godMode).toBe(true);
    const self = await alice.post('/api/lobbies', { opponent: { kind: 'participant', participantId: aliceId() }, rulesetId: 'classic-10x10', godMode: false });
    expect(self.body).toMatchObject({ godMode: true, mySeats: [1, 2] });
    await cleanup(alice);
  });

  it('applies the admin policy to new lobbies only', async () => {
    const before = await alice.post('/api/lobbies', vsBruno({ godMode: true }));
    await admin.patch('/api/admin/settings', { allowGodMode: false });
    const refused = await alice.post('/api/lobbies', vsBruno({ godMode: true }));
    expect(refused.status).toBe(409);
    expect(refused.body.error.message).toMatch(/turned god mode off/);
    expect((await alice.post('/api/lobbies', vsBruno({ godMode: false }))).body.godMode).toBe(false);
    // Bot and self lobbies are unaffected by the policy.
    expect((await alice.post('/api/lobbies', { opponent: { kind: 'bot', bot: 'random' }, rulesetId: 'classic-10x10' })).body.godMode).toBe(true);
    expect((await alice.get(`/api/lobbies/${before.body.id}`)).body.godMode).toBe(true);
    await admin.patch('/api/admin/settings', { allowGodMode: true });
    await cleanup(alice);
  });

  it('refuses unknown or disabled rulesets, unknown opponents, and admins creating lobbies', async () => {
    expect((await alice.post('/api/lobbies', vsBruno({ rulesetId: 'nope' }))).status).toBe(400);
    expect((await alice.post('/api/lobbies', { opponent: { kind: 'participant', participantId: 'p_none' }, rulesetId: 'classic-10x10' })).status).toBe(400);
    expect((await alice.post('/api/lobbies', { rulesetId: 'classic-10x10' })).status).toBe(400);
    expect((await admin.post('/api/lobbies', vsBruno())).status).toBe(403);
    await admin.post('/api/admin/rulesets', { id: 'other-rules', description: '', width: 8, height: 8, fleet: [3, 2], touching: true, extraTurnOnHit: false, announceSunk: false, repeatShot: 'waste', revealOnGameOver: false });
    await admin.patch('/api/admin/rulesets/other-rules', { enabled: false });
    const disabled = await alice.post('/api/lobbies', vsBruno({ rulesetId: 'other-rules' }));
    expect(disabled.status).toBe(409);
  });

  it('caps open lobbies per creator', async () => {
    for (let i = 0; i < 3; i++) expect((await alice.post('/api/lobbies', vsBruno())).status).toBe(201);
    const over = await alice.post('/api/lobbies', vsBruno());
    expect(over.status).toBe(409);
    expect(over.body.error.message).toMatch(/limit is 3/);
    expect((await bruno.post('/api/lobbies', { opponent: { kind: 'bot', bot: 'random' }, rulesetId: 'classic-10x10' })).status).toBe(201);
    await cleanup(alice);
    await cleanup(bruno);
  });

  it('lets anyone in the lobby, and the admin, delete it; others cannot', async () => {
    const mine = await alice.post('/api/lobbies', vsBruno());
    expect((await chen.del(`/api/lobbies/${mine.body.id}`)).status).toBe(404);
    expect((await bruno.del(`/api/lobbies/${mine.body.id}`)).status).toBe(204);
    expect((await alice.get(`/api/lobbies/${mine.body.id}`)).status).toBe(404);
    const second = await alice.post('/api/lobbies', vsBruno());
    expect((await admin.del(`/api/lobbies/${second.body.id}`)).status).toBe(204);
  });

  it('records lobby creation and deletion in the audit log', async () => {
    const l = await alice.post('/api/lobbies', vsBruno());
    await alice.del(`/api/lobbies/${l.body.id}`);
    const log = (await admin.get('/api/admin/audit')).body as { action: string; target: string }[];
    expect(log.filter((e) => e.target === l.body.id).map((e) => e.action)).toEqual(['lobby_deleted', 'lobby_created']);
  });

  it('counts lobbies per ruleset for the admin and per participant for deletion checks', async () => {
    const l = await alice.post('/api/lobbies', vsBruno());
    const rulesets = (await admin.get('/api/rulesets')).body as { ruleset: { id: string }; lobbyCount: number }[];
    expect(rulesets.find((r) => r.ruleset.id === 'classic-10x10')?.lobbyCount).toBe(1);
    expect((await admin.get('/api/admin/participants')).body.find((p: { name: string }) => p.name === 'Bruno').lobbyCount).toBe(1);
    await alice.del(`/api/lobbies/${l.body.id}`);
  });
});

describe('persistence', () => {
  it('restores lobbies and their settings from the store after a restart', async () => {
    const first = await startTestApp();
    const a = first.client();
    await a.loginAs(first.people.Alice as string);
    const lobby = await a.post('/api/lobbies', { opponent: { kind: 'bot', bot: 'random' }, rulesetId: 'classic-10x10' });
    await first.app.get((await import('../src/platform/lobbies.service.js')).LobbiesService).saveSeries(
      first.app.get((await import('../src/platform/lobbies.service.js')).LobbiesService).find(lobby.body.id)!,
      { id: 's_x', lobbyId: lobby.body.id, target: 5, played: 0, score: { 1: 0, 2: 0 }, status: 'aborted', abortReason: 'x', startedAt: 1, endedAt: 2, heatmap: { shots: { 1: [], 2: [] }, placements: { 1: [], 2: [] } } as never },
    );
    const store = first.store;
    await first.app.close();
    const second = await startTestApp({ store, names: [] });
    try {
      // The new app re-created the participant list from the store; log in as the same person.
      const b = second.client();
      const names = await b.post('/api/auth/gate', { password: 'correct horse battery staple' });
      const alice = names.body.find((p: { name: string }) => p.name === 'Alice');
      await b.post('/api/auth/participant', { participantId: alice.id });
      const restored = (await b.get('/api/lobbies')).body;
      expect(restored).toHaveLength(1);
      expect(restored[0]).toMatchObject({ id: lobby.body.id, godMode: true });
    } finally {
      await second.close();
    }
  });
});

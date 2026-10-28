import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp, type Client, type TestApp } from './helpers/testApp.js';

let t: TestApp;
let admin: Client;
let alice: Client;
beforeAll(async () => {
  t = await startTestApp();
  admin = t.client();
  await admin.loginAdmin();
  alice = t.client();
  await alice.loginAs(t.people.Alice as string);
});
afterAll(async () => {
  await t.close();
});

const ruleset = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  description: 'test',
  width: 8,
  height: 8,
  fleet: [4, 3, 3, 2],
  touching: false,
  extraTurnOnHit: false,
  announceSunk: true,
  repeatShot: 'invalid',
  revealOnGameOver: true,
  ...over,
});

describe('participants (admin)', () => {
  it('creates, renames and deletes participants, validating names', async () => {
    const created = await admin.post('/api/admin/participants', { name: 'Dana' });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ name: 'Dana', tokenCreatedAt: null, lobbyCount: 0 });
    expect((await admin.post('/api/admin/participants', { name: 'dana' })).status).toBe(409);
    expect((await admin.post('/api/admin/participants', { name: '<script>' })).status).toBe(400);
    expect((await admin.post('/api/admin/participants', { name: '' })).status).toBe(400);
    expect((await admin.post('/api/admin/participants', { name: 'x'.repeat(25) })).status).toBe(400);
    const renamed = await admin.patch(`/api/admin/participants/${created.body.id}`, { name: 'Dana K.' });
    expect(renamed.body.name).toBe('Dana K.');
    expect((await admin.patch('/api/admin/participants/p_missing', { name: 'Zed' })).status).toBe(404);
    expect((await admin.del(`/api/admin/participants/${created.body.id}`)).status).toBe(204);
    expect((await admin.del(`/api/admin/participants/${created.body.id}`)).status).toBe(404);
  });

  it('refuses to delete a participant who is in a lobby', async () => {
    const bruno = t.client();
    await bruno.loginAs(t.people.Bruno as string);
    const lobby = await bruno.post('/api/lobbies', { opponent: { kind: 'participant', participantId: t.people.Chen }, rulesetId: 'classic-10x10' });
    expect(lobby.status).toBe(201);
    const refused = await admin.del(`/api/admin/participants/${t.people.Chen}`);
    expect(refused.status).toBe(409);
    expect(refused.body.error.message).toMatch(/1 lobby/);
    await bruno.del(`/api/lobbies/${lobby.body.id}`);
    expect((await admin.del(`/api/admin/participants/${t.people.Chen}`)).status).toBe(204);
  });

  it('logs a deleted participant out', async () => {
    const created = await admin.post('/api/admin/participants', { name: 'Temp' });
    const temp = t.client();
    await temp.loginAs(created.body.id);
    expect((await temp.get('/api/lobbies')).status).toBe(200);
    await admin.del(`/api/admin/participants/${created.body.id}`);
    expect((await temp.get('/api/lobbies')).status).toBe(401);
  });
});

describe('rulesets', () => {
  it('seeds classic-10x10 as the default, and lists it for everyone without lobby counts for participants', async () => {
    const forAlice = await alice.get('/api/rulesets');
    expect(forAlice.body).toHaveLength(1);
    expect(forAlice.body[0]).toMatchObject({ enabled: true, isDefault: true, lobbyCount: null });
    expect(forAlice.body[0].ruleset.id).toBe('classic-10x10');
    expect((await admin.get('/api/rulesets')).body[0].lobbyCount).toBe(0);
  });

  it('validates new rulesets and keeps ids unique', async () => {
    const ok = await admin.post('/api/admin/rulesets', ruleset('quick-8x8'));
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ enabled: true, isDefault: false });
    expect((await admin.post('/api/admin/rulesets', ruleset('quick-8x8'))).status).toBe(400);
    const bad = await admin.post('/api/admin/rulesets', ruleset('Bad Id!', { width: 4 }));
    expect(bad.status).toBe(400);
    expect(bad.body.error.details.problems.length).toBeGreaterThan(0);
    expect((await admin.post('/api/admin/rulesets', ruleset('no-fit', { fleet: [8, 8, 8, 8, 8, 8] }))).status).toBe(400);
    expect((await admin.post('/api/admin/rulesets', { id: 'half' })).status).toBe(400);
    expect((await alice.post('/api/admin/rulesets', ruleset('sneaky-one'))).status).toBe(403);
  });

  it('lists the default first and disabled rulesets last; creating a ruleset does not change the default', async () => {
    await admin.post('/api/admin/rulesets', ruleset('zz-newest'));
    await admin.patch('/api/admin/rulesets/quick-8x8', { enabled: false });
    const ids = (await alice.get('/api/rulesets')).body.map((r: { ruleset: { id: string } }) => r.ruleset.id);
    expect(ids[0]).toBe('classic-10x10');
    expect(ids.at(-1)).toBe('quick-8x8');
    await admin.patch('/api/admin/rulesets/quick-8x8', { enabled: true });
  });

  it('lets the admin pick the default among enabled rulesets, and protects it from being disabled', async () => {
    expect((await admin.patch('/api/admin/rulesets/classic-10x10', { enabled: false })).status).toBe(409);
    expect((await admin.post('/api/admin/rulesets/quick-8x8/default')).body.isDefault).toBe(true);
    expect((await alice.get('/api/rulesets')).body[0].ruleset.id).toBe('quick-8x8');
    expect((await admin.patch('/api/admin/rulesets/quick-8x8', { enabled: false })).status).toBe(409);
    await admin.patch('/api/admin/rulesets/classic-10x10', { enabled: false });
    expect((await admin.post('/api/admin/rulesets/classic-10x10/default')).status).toBe(409);
    await admin.patch('/api/admin/rulesets/classic-10x10', { enabled: true });
    await admin.post('/api/admin/rulesets/classic-10x10/default');
    expect((await alice.post('/api/admin/rulesets/classic-10x10/default')).status).toBe(403);
    expect((await admin.post('/api/admin/rulesets/nope/default')).status).toBe(404);
  });

  it('never lets the last enabled ruleset be disabled', async () => {
    const all = (await admin.get('/api/rulesets')).body as { ruleset: { id: string }; enabled: boolean; isDefault: boolean }[];
    for (const r of all.filter((x) => x.enabled && !x.isDefault)) await admin.patch(`/api/admin/rulesets/${r.ruleset.id}`, { enabled: false });
    expect((await admin.patch('/api/admin/rulesets/classic-10x10', { enabled: false })).status).toBe(409);
    for (const r of all) await admin.patch(`/api/admin/rulesets/${r.ruleset.id}`, { enabled: true });
  });
});

describe('settings and audit', () => {
  it('validates and applies settings, and shows the limits to participants', async () => {
    expect((await admin.patch('/api/admin/settings', { maxBatterySize: 0 })).status).toBe(400);
    expect((await admin.patch('/api/admin/settings', { maxBatterySize: 20_000 })).status).toBe(400);
    expect((await admin.patch('/api/admin/settings', { maxBatterySize: 50, allowGodMode: false })).body).toMatchObject({ maxBatterySize: 50, allowGodMode: false });
    expect((await alice.get('/api/platform')).body).toMatchObject({ maxBatterySize: 50, allowGodMode: false, limits: { maxStrikes: 3 } });
    await admin.patch('/api/admin/settings', { maxBatterySize: 1000, allowGodMode: true });
    expect((await t.client().get('/api/platform')).status).toBe(401);
  });

  it('records sensitive actions, newest first, for the admin only', async () => {
    await admin.patch('/api/admin/settings', { allowGodMode: false });
    await admin.patch('/api/admin/settings', { allowGodMode: true });
    const log = (await admin.get('/api/admin/audit')).body as { action: string; actor: string }[];
    expect(log[0]).toMatchObject({ action: 'god_mode_policy_changed', actor: 'admin:admin' });
    expect(log.map((e) => e.action)).toEqual(expect.arrayContaining(['login', 'participant_created', 'ruleset_created', 'default_ruleset_changed']));
    expect((await alice.get('/api/admin/audit')).status).toBe(403);
  });
});

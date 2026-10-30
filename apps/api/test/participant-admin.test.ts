/* eslint-disable @typescript-eslint/no-explicit-any -- JSON responses are inspected loosely */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TOKEN_PATTERN } from '@bsc/protocol';
import { AccountsService } from '../src/platform/accounts.service.js';
import { TestProgram } from './helpers/program.js';
import { eventually, startTestApp, tokenFor, wait, type Client, type TestApp } from './helpers/testApp.js';
import { World } from './helpers/world.js';

const as = async (t: TestApp, name: string): Promise<Client> => {
  const c = t.client();
  await c.loginAs(t.people[name] as string);
  return c;
};

const lobbyWith = (c: Client, opponent: object) => c.post('/api/lobbies', { opponent, rulesetId: 'classic-10x10' });
const person = (t: TestApp, name: string) => ({ kind: 'participant', participantId: t.people[name] });

describe('deleting a participant deletes their lobbies', () => {
  let t: TestApp;
  let admin: Client;
  beforeEach(async () => {
    t = await startTestApp({ names: ['Alice', 'Bruno', 'Chen'] });
    admin = t.client();
    await admin.loginAdmin();
  });
  afterEach(async () => {
    await t.close();
  });

  it('removes every lobby they have a seat in, whoever created it, and leaves the others alone', async () => {
    const alice = await as(t, 'Alice');
    const bruno = await as(t, 'Bruno');
    const chen = await as(t, 'Chen');
    const theirs = (await lobbyWith(chen, { kind: 'bot', bot: 'random' })).body.id; // created by Chen
    const foreign = (await lobbyWith(bruno, person(t, 'Chen'))).body.id; // created by Bruno, Chen is the opponent
    const unrelated = (await lobbyWith(alice, person(t, 'Bruno'))).body.id;
    expect((await admin.get('/api/admin/participants')).body.find((p: any) => p.name === 'Chen').lobbyCount).toBe(2);

    expect((await admin.del(`/api/admin/participants/${t.people.Chen}`)).status).toBe(204);

    expect((await bruno.get(`/api/lobbies/${foreign}`)).status).toBe(404);
    const remaining = (await admin.get('/api/admin/lobbies')).body.map((l: any) => l.id);
    expect(remaining).toEqual([unrelated]);
    expect((await t.store.listLobbies()).map((l) => l.id)).toEqual([unrelated]);
    expect((await admin.get('/api/admin/participants')).body.map((p: any) => p.name)).toEqual(['Alice', 'Bruno']);
    expect((await chen.get('/api/lobbies')).status).toBe(401); // logged out
    expect((await bruno.get('/api/lobbies')).body.map((l: any) => l.id)).toEqual([unrelated]);

    const audit = (await admin.get('/api/admin/audit')).body as any[];
    const deleted = audit.filter((e) => e.action === 'lobby_deleted');
    expect(deleted.map((e) => e.target).sort()).toEqual([foreign, theirs].sort());
    expect(deleted.every((e) => e.actor === 'admin:admin' && e.detail === 'with Chen')).toBe(true);
    expect(audit.some((e) => e.action === 'participant_deleted' && e.target === 'Chen')).toBe(true);
  });

  it('still deletes a participant who is in no lobby, and answers 404 for one that does not exist', async () => {
    const alice = await as(t, 'Alice');
    const bruno = await as(t, 'Bruno');
    const keep = (await lobbyWith(alice, person(t, 'Bruno'))).body.id;
    expect((await admin.del(`/api/admin/participants/${t.people.Chen}`)).status).toBe(204);
    // A missing participant must not cost anyone a lobby.
    expect((await admin.del('/api/admin/participants/p_missing')).status).toBe(404);
    expect((await bruno.get(`/api/lobbies/${keep}`)).status).toBe(200);
  });

  it('only an admin can do it', async () => {
    const alice = await as(t, 'Alice');
    const mine = (await lobbyWith(alice, { kind: 'bot', bot: 'random' })).body.id;
    expect((await alice.del(`/api/admin/participants/${t.people.Alice}`)).status).toBe(403);
    expect((await t.client().del(`/api/admin/participants/${t.people.Alice}`)).status).toBe(401);
    expect((await alice.get(`/api/lobbies/${mine}`)).status).toBe(200);
  });
});

describe('deleting a participant in the middle of a battery', () => {
  let w: World;
  beforeEach(async () => {
    w = await World.create();
  });
  afterEach(async () => {
    await w.close();
  });

  it('stops the games, closes both programs, and leaves nothing running', async () => {
    const admin = w.t.client();
    await admin.loginAdmin();
    const { lobby, a, b } = await w.readyLobby();
    await w.start(lobby.id, 200);
    await eventually(() => a.of('turn').length > 0, 5000, 'the battery to be running');

    expect((await admin.del(`/api/admin/participants/${w.t.people.Bruno}`)).status).toBe(204);

    expect((await a.waitForClose()).code).toBe(4000);
    expect((await b.waitForClose()).code).toBe(4000);
    expect((await w.alice.get(`/api/lobbies/${lobby.id}`)).status).toBe(404);
    expect((await w.alice.get('/api/lobbies')).body).toEqual([]);
    // Nothing keeps playing after the lobby is gone.
    const turns = a.of('turn').length;
    await wait(300);
    expect(a.of('turn').length).toBe(turns);
    // The surviving participant's program can no longer join the deleted lobby.
    const late = await TestProgram.connect(w.t.url, { token: w.aliceToken, lobby: lobby.id });
    expect((await late.waitForClose()).code).not.toBe(1000);
  });
});

describe('resetting a participant token', () => {
  let t: TestApp;
  let admin: Client;
  let accounts: AccountsService;
  beforeEach(async () => {
    t = await startTestApp({ names: ['Alice', 'Bruno'] });
    admin = t.client();
    await admin.loginAdmin();
    accounts = t.app.get(AccountsService);
  });
  afterEach(async () => {
    await t.close();
  });

  it('takes the token away, leaves a notice for its owner, and lets them create a new one', async () => {
    const alice = await as(t, 'Alice');
    const old = await tokenFor(alice);
    expect((await admin.get('/api/admin/participants')).body.find((p: any) => p.name === 'Alice').tokenCreatedAt).not.toBeNull();

    const reset = await admin.post(`/api/admin/participants/${t.people.Alice}/token/reset`);
    expect(reset.status).toBe(200);
    expect(reset.body).toMatchObject({ name: 'Alice', tokenCreatedAt: null });
    expect(JSON.stringify(reset.body)).not.toContain(old);
    expect(accounts.findByToken(old)).toBeNull();
    const stored = (await t.store.listParticipants()).find((p) => p.id === t.people.Alice);
    expect(stored).toMatchObject({ tokenHash: null, tokenPreview: null, tokenCreatedAt: null });

    // Back to "no token yet", plus a notice.
    expect((await alice.get('/api/me/token')).body).toEqual({ exists: false, preview: null, createdAt: null, replaced: false, notice: { at: expect.any(Number) } });
    expect((await alice.post('/api/me/token/replace')).status).toBe(409);

    // Creating a new one works, differs from the old one, and clears the notice.
    const fresh = await alice.post('/api/me/token');
    expect(fresh.status).toBe(201);
    expect(fresh.body.token).toMatch(TOKEN_PATTERN);
    expect(fresh.body.token).not.toBe(old);
    expect((await alice.get('/api/me/token')).body).toMatchObject({ exists: true, replaced: false, notice: null });
    expect(accounts.findByToken(fresh.body.token)?.id).toBe(t.people.Alice);

    const audit = (await admin.get('/api/admin/audit')).body as any[];
    expect(audit.find((e) => e.action === 'token_reset')).toMatchObject({ actor: 'admin:admin', target: 'Alice' });
  });

  it('can be acknowledged like any other notice', async () => {
    const alice = await as(t, 'Alice');
    await tokenFor(alice);
    await admin.post(`/api/admin/participants/${t.people.Alice}/token/reset`);
    expect((await alice.post('/api/me/token/notice/ack')).status).toBe(204);
    expect((await alice.get('/api/me/token')).body).toMatchObject({ exists: false, notice: null });
  });

  it('refuses a participant without a token, an unknown one, and anyone but an admin', async () => {
    const alice = await as(t, 'Alice');
    const url = (id: string) => `/api/admin/participants/${id}/token/reset`;
    const none = await admin.post(url(t.people.Bruno as string));
    expect(none.status).toBe(409);
    expect(none.body.error.message).toMatch(/no token/);
    expect((await admin.post(url('p_missing'))).status).toBe(404);
    await tokenFor(alice);
    expect((await alice.post(url(t.people.Alice as string))).status).toBe(403);
    expect((await t.client().post(url(t.people.Alice as string))).status).toBe(401);
    expect(accounts.get(t.people.Alice as string)?.tokenHash).not.toBeNull(); // untouched
  });

  it('does not touch other participants', async () => {
    const alice = await as(t, 'Alice');
    const bruno = await as(t, 'Bruno');
    await tokenFor(alice);
    const brunoToken = await tokenFor(bruno);
    await admin.post(`/api/admin/participants/${t.people.Alice}/token/reset`);
    expect(accounts.findByToken(brunoToken)?.id).toBe(t.people.Bruno);
    expect((await bruno.get('/api/me/token')).body).toMatchObject({ exists: true, notice: null });
  });
});

describe('resetting a token while programs are connected', () => {
  let w: World;
  beforeEach(async () => {
    w = await World.create();
  });
  afterEach(async () => {
    await w.close();
  });

  it('disconnects the programs with close code 4000, and the old token no longer joins', async () => {
    const admin = w.t.client();
    await admin.loginAdmin();
    const { lobby, a, b } = await w.readyLobby();
    expect((await admin.post(`/api/admin/participants/${w.t.people.Alice}/token/reset`)).status).toBe(200);

    const closed = await a.waitForClose();
    expect(closed.code).toBe(4000);
    expect(closed.reason).toMatch(/reset by an admin/);
    expect(b.closed).toBeNull(); // the opponent stays connected
    await eventually(async () => (await w.lobby(lobby.id)).seats[0].connection === 'disconnected');

    const old = await TestProgram.connect(w.t.url, { token: w.aliceToken, lobby: lobby.id });
    expect((await old.waitForClose()).code).toBe(4401);

    // After creating a new token the program is welcome again.
    w.aliceToken = await tokenFor(w.alice);
    const back = await w.connect('alice', lobby.id);
    await back.waitForFrame('welcome');
  });
});

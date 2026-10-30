/* eslint-disable @typescript-eslint/no-explicit-any -- JSON responses are inspected loosely */
import { afterEach, describe, expect, it } from 'vitest';
import { TestProgram } from './helpers/program.js';
import { startTestApp, tokenFor, type Client, type TestApp } from './helpers/testApp.js';

/** Per-participant policy: programs connect over wss:// only, unless the admin allows plain ws://. */

let t: TestApp;
afterEach(async () => {
  await t.close();
});

async function setup(env: Record<string, string> = {}) {
  t = await startTestApp({ names: ['Alice', 'Bruno'], secureOnly: true, env: { HELLO_TIMEOUT_MS: '2000', ...env } });
  const admin = t.client();
  await admin.loginAdmin();
  const alice = t.client();
  await alice.loginAs(t.people.Alice as string);
  const token = await tokenFor(alice);
  const lobby = (await alice.post('/api/lobbies', { opponent: { kind: 'bot', bot: 'hunt-target' }, rulesetId: 'classic-10x10' })).body;
  return { admin, alice, token, lobby };
}

const allow = (admin: Client, t: TestApp, name: string, allowInsecure: boolean) => admin.patch(`/api/admin/participants/${t.people[name]}`, { allowInsecure });

describe('plain ws:// per participant', () => {
  it('is forbidden by default: a plain connection gets tls_required and close code 4403', async () => {
    const { token, lobby } = await setup();
    const p = await TestProgram.connect(t.url, { token, lobby: lobby.id });
    expect((await p.waitForClose()).code).toBe(4403);
    expect(p.received).toHaveLength(1);
    expect(p.received[0]).toMatchObject({ type: 'error', code: 'tls_required', fatal: true });
  });

  it('does not reveal anything to a wrong token: auth_failed still comes first', async () => {
    const { lobby } = await setup();
    const p = await TestProgram.connect(t.url, { token: 'bsc_' + 'a'.repeat(24), lobby: lobby.id });
    expect((await p.waitForClose()).code).toBe(4401);
  });

  it('is accepted for a participant the admin has allowed, and every new participant starts forbidden', async () => {
    const { admin, token, lobby } = await setup();
    const list = (await admin.get('/api/admin/participants')).body;
    expect(list.map((p: any) => p.allowInsecure)).toEqual([false, false]);
    const r = await allow(admin, t, 'Alice', true);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ name: 'Alice', allowInsecure: true });
    const p = await TestProgram.connect(t.url, { token, lobby: lobby.id });
    await p.waitForFrame('welcome');
    expect(p.closed).toBeNull();
    const created = await admin.post('/api/admin/participants', { name: 'Dana' });
    expect(created.body.allowInsecure).toBe(false);
  });

  it('accepts a connection that came through a trusted TLS-terminating proxy', async () => {
    const { token, lobby } = await setup({ TRUST_PROXY_HOPS: '1' });
    const p = await TestProgram.connect(t.url, { token, lobby: lobby.id, headers: { 'x-forwarded-for': '203.0.113.5', 'x-forwarded-proto': 'https' } });
    await p.waitForFrame('welcome');
    const plain = await TestProgram.connect(t.url, { token, lobby: lobby.id, headers: { 'x-forwarded-for': '203.0.113.5', 'x-forwarded-proto': 'http' } });
    expect((await plain.waitForClose()).code).toBe(4403);
  });

  it('ignores X-Forwarded-Proto when no proxy is trusted (a client cannot claim TLS)', async () => {
    const { token, lobby } = await setup();
    const p = await TestProgram.connect(t.url, { token, lobby: lobby.id, headers: { 'x-forwarded-proto': 'https' } });
    expect((await p.waitForClose()).code).toBe(4403);
  });

  it('counts proxies from the right: a forged leading value does not help', async () => {
    const { token, lobby } = await setup({ TRUST_PROXY_HOPS: '1' });
    const p = await TestProgram.connect(t.url, { token, lobby: lobby.id, headers: { 'x-forwarded-proto': 'https, http' } });
    expect((await p.waitForClose()).code).toBe(4403);
  });

  it('forbidding it again drops that participant\'s open plain connections, and only theirs', async () => {
    const { admin, alice, token, lobby } = await setup();
    await allow(admin, t, 'Alice', true);
    const secure = (await tokenFor(await (async () => {
      const bruno = t.client();
      await bruno.loginAs(t.people.Bruno as string);
      return bruno;
    })()));
    await allow(admin, t, 'Bruno', true);
    const brunoLobby = (await alice.post('/api/lobbies', { opponent: { kind: 'participant', participantId: t.people.Bruno }, rulesetId: 'classic-10x10' })).body;
    const a = await TestProgram.connect(t.url, { token, lobby: brunoLobby.id });
    const b = await TestProgram.connect(t.url, { token: secure, lobby: brunoLobby.id });
    await a.waitForFrame('welcome');
    await b.waitForFrame('welcome');
    await allow(admin, t, 'Alice', false);
    expect((await a.waitForClose()).code).toBe(4000);
    await new Promise((r) => setTimeout(r, 100));
    expect(b.closed).toBeNull();
    // and she cannot come back
    const again = await TestProgram.connect(t.url, { token, lobby: lobby.id });
    expect((await again.waitForClose()).code).toBe(4403);
  });

  it('records the policy changes in the audit log, and setting the same value again is a no-op', async () => {
    const { admin } = await setup();
    await allow(admin, t, 'Alice', true);
    await allow(admin, t, 'Alice', true);
    await allow(admin, t, 'Alice', false);
    const log = (await admin.get('/api/admin/audit')).body.filter((e: any) => e.action.startsWith('insecure_'));
    expect(log.map((e: any) => e.action).sort()).toEqual(['insecure_allowed', 'insecure_forbidden']);
    expect(log[0].target).toBe('Alice');
  });

  it('PATCH validates its body and can rename and change the policy in one call', async () => {
    const { admin } = await setup();
    const id = t.people.Alice;
    expect((await admin.patch(`/api/admin/participants/${id}`, {})).status).toBe(400);
    expect((await admin.patch(`/api/admin/participants/${id}`, { allowInsecure: 'yes' })).status).toBe(400);
    expect((await admin.patch(`/api/admin/participants/p_missing`, { allowInsecure: true })).status).toBe(404);
    const both = await admin.patch(`/api/admin/participants/${id}`, { name: 'Alice B.', allowInsecure: true });
    expect(both.body).toMatchObject({ name: 'Alice B.', allowInsecure: true });
  });

  it('only the admin can change it', async () => {
    const { alice } = await setup();
    expect((await alice.patch(`/api/admin/participants/${t.people.Alice}`, { allowInsecure: true })).status).toBe(403);
  });
});

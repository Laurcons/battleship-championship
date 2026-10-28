import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TOKEN_PATTERN } from '@bsc/protocol';
import { startTestApp, type Client, type TestApp } from './helpers/testApp.js';

let t: TestApp;
let alice: Client;
let bruno: Client;
beforeAll(async () => {
  t = await startTestApp();
  alice = t.client();
  await alice.loginAs(t.people.Alice as string);
  bruno = t.client();
  await bruno.loginAs(t.people.Bruno as string);
});
afterAll(async () => {
  await t.close();
});

describe('program tokens', () => {
  it('starts empty: nothing exists until the participant asks', async () => {
    expect((await alice.get('/api/me/token')).body).toEqual({ exists: false, preview: null, createdAt: null, replaced: false, notice: null });
    expect((await alice.post('/api/me/token/replace')).status).toBe(409);
  });

  it('creates a token once, shows it once, and keeps only a hash and the last four characters', async () => {
    const created = await alice.post('/api/me/token');
    expect(created.status).toBe(201);
    expect(created.body.token).toMatch(TOKEN_PATTERN);
    expect((await alice.post('/api/me/token')).status).toBe(409);
    const info = (await alice.get('/api/me/token')).body;
    expect(info).toMatchObject({ exists: true, replaced: false, notice: null });
    expect(info.preview).toBe(`bsc_••••••••${created.body.token.slice(-4)}`);
    expect(JSON.stringify(info)).not.toContain(created.body.token);
    const stored = (await t.store.listParticipants()).find((p) => p.id === t.people.Alice);
    expect(stored?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(stored)).not.toContain(created.body.token);
  });

  it('replaces the token: the new one differs, is shown once, and the old one stops working', async () => {
    const first = (await bruno.post('/api/me/token')).body.token as string;
    const second = (await bruno.post('/api/me/token/replace')).body.token as string;
    expect(second).not.toBe(first);
    expect((await bruno.get('/api/me/token')).body).toMatchObject({ exists: true, replaced: true, notice: null });
    const accounts = t.app.get((await import('../src/platform/accounts.service.js')).AccountsService);
    expect(accounts.findByToken(first)).toBeNull();
    expect(accounts.findByToken(second)?.id).toBe(t.people.Bruno);
    expect(accounts.findByToken('bsc_' + 'x'.repeat(32))).toBeNull();
    expect(accounts.findByToken('not a token')).toBeNull();
  });

  it('shows a notice when the token was replaced from another session, until acknowledged', async () => {
    const accounts = t.app.get((await import('../src/platform/accounts.service.js')).AccountsService);
    await accounts.replaceTokenElsewhere(t.people.Bruno as string);
    const info = (await bruno.get('/api/me/token')).body;
    expect(info.notice).toEqual({ at: expect.any(Number) });
    expect((await bruno.post('/api/me/token/notice/ack')).status).toBe(204);
    expect((await bruno.get('/api/me/token')).body.notice).toBeNull();
  });

  it('keeps tokens private: each participant only ever acts on their own', async () => {
    const chen = t.client();
    await chen.loginAs(t.people.Chen as string);
    expect((await chen.get('/api/me/token')).body.exists).toBe(false);
    const admin = t.client();
    await admin.loginAdmin();
    expect((await admin.post('/api/me/token')).status).toBe(403);
    expect((await t.client().post('/api/me/token')).status).toBe(401);
  });

  it('audits creation and replacement separately', async () => {
    const admin = t.client();
    await admin.loginAdmin();
    const actions = (await admin.get('/api/admin/audit')).body.map((e: { action: string }) => e.action);
    expect(actions).toContain('token_created');
    expect(actions).toContain('token_replaced');
  });
});

describe('login rate limiting', () => {
  it('locks out repeated wrong passwords with a Retry-After, per client address', async () => {
    const limited = await startTestApp({ env: { LOGIN_ATTEMPTS: '3', LOGIN_WINDOW_MS: '60000' } });
    try {
      const c = limited.client();
      for (let i = 0; i < 3; i++) expect((await c.post('/api/auth/gate', { password: 'wrong' })).status).toBe(401);
      const blocked = await c.post('/api/auth/gate', { password: 'wrong' });
      expect(blocked.status).toBe(429);
      expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
      // Even the right password is refused while locked out, and admin login shares the limit.
      expect((await c.post('/api/auth/gate', { password: 'correct horse battery staple' })).status).toBe(429);
      expect((await c.post('/api/auth/admin', { username: 'admin', password: 'admin-secret-1' })).status).toBe(429);
    } finally {
      await limited.close();
    }
  });

  it('uses the forwarded address only when proxies are trusted', async () => {
    const trusting = await startTestApp({ env: { LOGIN_ATTEMPTS: '2', TRUST_PROXY_HOPS: '1' } });
    try {
      const c = trusting.client();
      const as = (ip: string) => ({ 'x-forwarded-for': ip });
      for (let i = 0; i < 2; i++) await c.request('POST', '/api/auth/gate', { password: 'x' }, as('9.9.9.9'));
      expect((await c.request('POST', '/api/auth/gate', { password: 'x' }, as('9.9.9.9'))).status).toBe(429);
      expect((await c.request('POST', '/api/auth/gate', { password: 'x' }, as('8.8.8.8'))).status).toBe(401);
    } finally {
      await trusting.close();
    }
    const direct = await startTestApp({ env: { LOGIN_ATTEMPTS: '2' } });
    try {
      const c = direct.client();
      for (let i = 0; i < 2; i++) await c.request('POST', '/api/auth/gate', { password: 'x' }, { 'x-forwarded-for': '1.1.1.1' });
      // A spoofed header must not give an attacker a fresh allowance.
      expect((await c.request('POST', '/api/auth/gate', { password: 'x' }, { 'x-forwarded-for': '2.2.2.2' })).status).toBe(429);
    } finally {
      await direct.close();
    }
  });
});

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp, Client, SHARED_PASSWORD, type TestApp } from './helpers/testApp.js';

let t: TestApp;
beforeAll(async () => {
  t = await startTestApp();
});
afterAll(async () => {
  await t.close();
});

describe('sessions', () => {
  it('reports no session for an anonymous visitor', async () => {
    const c = t.client();
    expect(await c.get('/api/session')).toMatchObject({ status: 200, body: null });
  });

  it('logs a participant in with the shared password and a name, and out again', async () => {
    const c = t.client();
    const gate = await c.post('/api/auth/gate', { password: SHARED_PASSWORD });
    expect(gate.status).toBe(200);
    expect(gate.body.map((p: { name: string }) => p.name)).toEqual(['Alice', 'Bruno', 'Chen']);
    // The gate alone is not a login.
    expect((await c.get('/api/session')).body).toBeNull();
    expect((await c.get('/api/lobbies')).status).toBe(401);
    const login = await c.post('/api/auth/participant', { participantId: t.people.Alice });
    expect(login.body).toEqual({ role: 'participant', participantId: t.people.Alice, name: 'Alice' });
    expect((await c.get('/api/session')).body).toMatchObject({ name: 'Alice' });
    expect((await c.post('/api/auth/logout')).status).toBe(204);
    expect((await c.get('/api/session')).body).toBeNull();
    expect((await c.get('/api/lobbies')).status).toBe(401);
  });

  it('rejects a wrong shared password without revealing anything', async () => {
    const c = t.client();
    const r = await c.post('/api/auth/gate', { password: 'nope' });
    expect(r.status).toBe(401);
    expect(r.body).toEqual({ error: { code: 'invalid_credentials', message: 'Wrong password.' } });
  });

  it('refuses the name step without the password step, and unknown names', async () => {
    const c = t.client();
    expect((await c.post('/api/auth/participant', { participantId: t.people.Alice })).status).toBe(401);
    await c.post('/api/auth/gate', { password: SHARED_PASSWORD });
    expect((await c.post('/api/auth/participant', { participantId: 'p_nobody' })).status).toBe(404);
  });

  it('issues a fresh session id at login (no session fixation) and the cookie is HttpOnly + SameSite', async () => {
    const c = t.client();
    const gate = await fetch(`${t.url}/api/auth/gate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: t.url },
      body: JSON.stringify({ password: SHARED_PASSWORD }),
    });
    const gateCookie = gate.headers.getSetCookie()[0] as string;
    expect(gateCookie).toMatch(/HttpOnly/i);
    expect(gateCookie).toMatch(/SameSite=Lax/i);
    c.cookie = gateCookie.split(';')[0] as string;
    const before = c.cookie;
    await c.post('/api/auth/participant', { participantId: t.people.Alice });
    expect(c.cookie).not.toBe(before);
    // The gate cookie no longer works.
    const stale = new Client(t.url, t.url);
    stale.cookie = before;
    expect((await stale.post('/api/auth/participant', { participantId: t.people.Bruno })).status).toBe(401);
  });

  it('logs the admin in and keeps admin and participant roles apart', async () => {
    const admin = t.client();
    expect((await admin.post('/api/auth/admin', { username: 'admin', password: 'wrong' })).status).toBe(401);
    await admin.loginAdmin();
    expect((await admin.get('/api/session')).body).toEqual({ role: 'admin', username: 'admin' });
    expect((await admin.get('/api/admin/settings')).status).toBe(200);
    const alice = t.client();
    await alice.loginAs(t.people.Alice);
    expect((await alice.get('/api/admin/settings')).status).toBe(403);
    expect((await alice.get('/api/admin/audit')).status).toBe(403);
    expect((await admin.get('/api/me/token')).status).toBe(403);
  });
});

describe('transport hardening', () => {
  it('sets a strict CSP and no-store on API responses', async () => {
    const r = await t.client().get('/api/session');
    expect(r.headers.get('content-security-policy')).toContain("script-src 'self'");
    expect(r.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(r.headers.get('x-powered-by')).toBeNull();
  });

  it('rejects state-changing requests from another origin or with a non-JSON body', async () => {
    const c = t.client();
    const cross = await c.request('POST', '/api/auth/gate', { password: SHARED_PASSWORD }, { origin: 'https://evil.example' });
    expect(cross.status).toBe(403);
    const form = await c.request('POST', '/api/auth/gate', 'password=x', { 'content-type': 'application/x-www-form-urlencoded' });
    expect(form.status).toBe(403);
    const fetchSite = await c.request('POST', '/api/auth/logout', {}, { 'sec-fetch-site': 'cross-site', origin: '' });
    expect(fetchSite.status).toBe(403);
  });

  it('answers malformed and oversized bodies with a JSON error, not a stack trace', async () => {
    const c = t.client();
    const bad = await c.request('POST', '/api/auth/gate', '{nope');
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('validation');
    const big = await c.request('POST', '/api/auth/gate', JSON.stringify({ password: 'x'.repeat(40_000) }));
    expect(big.status).toBe(413);
    expect(JSON.stringify(big.body)).not.toMatch(/at .*\.ts/);
    const wrongShape = await c.post('/api/auth/gate', { password: 5 });
    expect(wrongShape.status).toBe(400);
  });

  it('answers unknown API routes with a JSON 404', async () => {
    const r = await t.client().get('/api/nothing-here');
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('not_found');
  });
});

describe('health and flood protection', () => {
  it('answers a health check without logging in', async () => {
    expect(await t.client().get('/api/health')).toMatchObject({ status: 200, body: { ok: true } });
  });

  it('caps requests per client address and says when to retry', async () => {
    const limited = await startTestApp({ env: { API_RATE_LIMIT: '30' } });
    try {
      const c = limited.client();
      const statuses: number[] = [];
      for (let i = 0; i < 40; i++) statuses.push((await c.get('/api/session')).status);
      expect(statuses.filter((s) => s === 200).length).toBeGreaterThanOrEqual(25);
      const blocked = await c.get('/api/session');
      expect(blocked.status).toBe(429);
      expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
      expect(blocked.body.error.code).toBe('rate_limited');
    } finally {
      await limited.close();
    }
  });
});

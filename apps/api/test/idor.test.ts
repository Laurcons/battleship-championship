import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp, type Client, type TestApp } from './helpers/testApp.js';

/**
 * Every HTTP route, called as every kind of caller. If a route is added without a row here, the
 * route-coverage test below fails.
 */

let t: TestApp;
const roles: Record<string, Client> = {};
let lobbyId: string;

beforeAll(async () => {
  t = await startTestApp();
  roles.anonymous = t.client();
  roles.admin = t.client();
  await roles.admin!.loginAdmin();
  for (const name of ['Alice', 'Bruno', 'Chen']) {
    roles[name] = t.client();
    await roles[name]!.loginAs(t.people[name] as string);
  }
  // Alice (seat 1) vs Bruno (seat 2); Chen is the outsider.
  lobbyId = (await roles.Alice!.post('/api/lobbies', { opponent: { kind: 'participant', participantId: t.people.Bruno }, rulesetId: 'classic-10x10' })).body.id;
});
afterAll(async () => {
  await t.close();
});

type Expectation = Partial<Record<'anonymous' | 'admin' | 'Alice' | 'Bruno' | 'Chen', number>>;
interface Row {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: (ctx: { lobby: string; alice: string }) => string;
  body?: unknown;
  expect: Expectation;
  /** Mutating rows that would change the fixture run last. */
  destructive?: boolean;
}

const MEMBERS = { Alice: 200, Bruno: 200 };
const rows: Row[] = [
  { method: 'GET', path: () => '/api/session', expect: { anonymous: 200, admin: 200, Alice: 200, Bruno: 200, Chen: 200 } },
  { method: 'GET', path: () => '/api/rulesets', expect: { anonymous: 200, admin: 200, Alice: 200, Bruno: 200, Chen: 200 } },
  { method: 'GET', path: () => '/api/participants', expect: { anonymous: 401, admin: 200, Alice: 200, Bruno: 200, Chen: 200 } },
  { method: 'GET', path: () => '/api/platform', expect: { anonymous: 401, admin: 200, Alice: 200, Bruno: 200, Chen: 200 } },
  { method: 'GET', path: () => '/api/me/token', expect: { anonymous: 401, admin: 403, Alice: 200, Bruno: 200, Chen: 200 } },
  { method: 'GET', path: () => '/api/lobbies', expect: { anonymous: 401, admin: 200, Alice: 200, Bruno: 200, Chen: 200 } },
  { method: 'GET', path: ({ lobby }) => `/api/lobbies/${lobby}`, expect: { anonymous: 401, admin: 200, ...MEMBERS, Chen: 404 } },
  { method: 'GET', path: ({ lobby }) => `/api/lobbies/${lobby}/series`, expect: { anonymous: 401, admin: 200, ...MEMBERS, Chen: 404 } },
  { method: 'GET', path: ({ lobby }) => `/api/lobbies/${lobby}/games`, expect: { anonymous: 401, admin: 200, ...MEMBERS, Chen: 404 } },
  { method: 'GET', path: ({ lobby }) => `/api/lobbies/${lobby}/games/g_unknown`, expect: { anonymous: 401, admin: 404, Alice: 404, Bruno: 404, Chen: 404 } },
  { method: 'GET', path: ({ lobby }) => `/api/lobbies/${lobby}/report`, expect: { anonymous: 401, admin: 200, ...MEMBERS, Chen: 404 } },
  // Frame logs: the admin and the seat's owner only. Seat 1 is Alice's, seat 2 is Bruno's.
  { method: 'GET', path: ({ lobby }) => `/api/lobbies/${lobby}/frames/1`, expect: { anonymous: 401, admin: 200, Alice: 200, Bruno: 403, Chen: 404 } },
  { method: 'GET', path: ({ lobby }) => `/api/lobbies/${lobby}/frames/2`, expect: { anonymous: 401, admin: 200, Alice: 403, Bruno: 200, Chen: 404 } },
  { method: 'GET', path: ({ lobby }) => `/api/lobbies/${lobby}/frames/3`, expect: { anonymous: 401, admin: 404, Alice: 404, Bruno: 404, Chen: 404 } },
  { method: 'POST', path: () => '/api/lobbies', body: { opponent: { kind: 'bot', bot: 'random' }, rulesetId: 'classic-10x10' }, expect: { anonymous: 401, admin: 403, Alice: 201, Bruno: 201, Chen: 201 } },
  { method: 'POST', path: () => '/api/me/token/notice/ack', expect: { anonymous: 401, admin: 403, Alice: 204, Bruno: 204, Chen: 204 } },
  // Actions in a lobby: its players only. The lobby is waiting for programs, so players get a 409 (a valid request that cannot run yet).
  { method: 'POST', path: ({ lobby }) => `/api/lobbies/${lobby}/start`, body: { games: 1 }, expect: { anonymous: 401, admin: 403, Alice: 409, Bruno: 409, Chen: 404 } },
  { method: 'POST', path: ({ lobby }) => `/api/lobbies/${lobby}/restart-game`, expect: { anonymous: 401, admin: 403, Alice: 409, Bruno: 409, Chen: 404 } },
  { method: 'POST', path: ({ lobby }) => `/api/lobbies/${lobby}/reset-series`, expect: { anonymous: 401, admin: 403, Alice: 409, Bruno: 409, Chen: 404 } },
  // Admin-only.
  { method: 'GET', path: () => '/api/admin/participants', expect: { anonymous: 401, admin: 200, Alice: 403, Bruno: 403, Chen: 403 } },
  { method: 'POST', path: () => '/api/admin/participants', body: { name: 'Zed' }, expect: { anonymous: 401, admin: 201, Alice: 403, Bruno: 403, Chen: 403 } },
  { method: 'PATCH', path: ({ alice }) => `/api/admin/participants/${alice}`, body: { name: 'Alice' }, expect: { anonymous: 401, admin: 200, Alice: 403, Bruno: 403, Chen: 403 } },
  { method: 'DELETE', path: () => '/api/admin/participants/p_nobody', expect: { anonymous: 401, admin: 404, Alice: 403, Bruno: 403, Chen: 403 } },
  { method: 'POST', path: () => '/api/admin/participants/p_nobody/token/reset', expect: { anonymous: 401, admin: 404, Alice: 403, Bruno: 403, Chen: 403 } },
  { method: 'GET', path: () => '/api/admin/token-activity', expect: { anonymous: 401, admin: 200, Alice: 403, Bruno: 403, Chen: 403 } },
  { method: 'GET', path: () => '/api/admin/token-activity/connections', expect: { anonymous: 401, admin: 200, Alice: 403, Bruno: 403, Chen: 403 } },
  { method: 'GET', path: () => '/api/admin/participants/p_nobody/activity', expect: { anonymous: 401, admin: 404, Alice: 403, Bruno: 403, Chen: 403 } },
  { method: 'POST', path: () => '/api/admin/participants/p_nobody/activity/review', expect: { anonymous: 401, admin: 404, Alice: 403, Bruno: 403, Chen: 403 } },
  { method: 'POST', path: () => '/api/admin/rulesets', body: { id: 'x' }, expect: { anonymous: 401, admin: 400, Alice: 403, Bruno: 403, Chen: 403 } },
  { method: 'PATCH', path: () => '/api/admin/rulesets/classic-10x10', body: { enabled: true }, expect: { anonymous: 401, admin: 200, Alice: 403, Bruno: 403, Chen: 403 } },
  { method: 'POST', path: () => '/api/admin/rulesets/classic-10x10/default', expect: { anonymous: 401, admin: 200, Alice: 403, Bruno: 403, Chen: 403 } },
  { method: 'GET', path: () => '/api/admin/settings', expect: { anonymous: 401, admin: 200, Alice: 403, Bruno: 403, Chen: 403 } },
  { method: 'PATCH', path: () => '/api/admin/settings', body: { maxBatterySize: 1000 }, expect: { anonymous: 401, admin: 200, Alice: 403, Bruno: 403, Chen: 403 } },
  { method: 'GET', path: () => '/api/admin/audit', expect: { anonymous: 401, admin: 200, Alice: 403, Bruno: 403, Chen: 403 } },
  { method: 'GET', path: () => '/api/admin/lobbies', expect: { anonymous: 401, admin: 200, Alice: 403, Bruno: 403, Chen: 403 } },
  // Deleting the lobby comes last: members and the admin may, the outsider may not.
  { method: 'DELETE', path: ({ lobby }) => `/api/lobbies/${lobby}`, expect: { anonymous: 401, Chen: 404 } },
];

describe('access matrix', () => {
  for (const row of rows) {
    for (const [role, status] of Object.entries(row.expect)) {
      it(`${role} ${row.method} ${row.path({ lobby: 'LOBBY', alice: 'ALICE' })} -> ${status}`, async () => {
        const res = await roles[role]!.request(row.method, row.path({ lobby: lobbyId, alice: t.people.Alice as string }), row.body);
        expect(res.status).toBe(status);
      });
    }
  }

  it('does not reveal whether a lobby exists: an unknown id and a foreign lobby look the same', async () => {
    const foreign = await roles.Chen!.get(`/api/lobbies/${lobbyId}`);
    const missing = await roles.Chen!.get('/api/lobbies/ZZZZ-ZZZZ-0');
    expect(foreign.status).toBe(404);
    expect(foreign.body).toEqual(missing.body);
  });

  it('covers every route of the application', () => {
    // Login and logout are public by design and tested in http.test.ts; token creation in accounts.test.ts.
    const elsewhere = ['GET /api/health', 'POST /api/auth/gate', 'POST /api/auth/participant', 'POST /api/auth/admin', 'POST /api/auth/logout', 'POST /api/me/token', 'POST /api/me/token/replace'];
    const pattern = (method: string, path: string) =>
      `${method} ${path.replace(/\/games\/[^/]+$/, '/games/:id').replace(/\/frames\/\d$/, '/frames/:id').replace(/\/admin\/(participants|rulesets)\/[^/]+/, '/admin/$1/:id').replace(/\/lobbies\/(LOBBY|:id)/, '/lobbies/:id').replace(/\/(rulesets)\/:id/, '/$1/:id')}`;
    const covered = new Set(rows.map((r) => pattern(r.method, r.path({ lobby: 'LOBBY', alice: 'ALICE' }))));
    const routes: string[] = [];
    const router = (t.app.getHttpAdapter().getInstance() as { router?: { stack: { route?: { path: string; methods: Record<string, boolean> } }[] } }).router;
    for (const layer of router?.stack ?? []) {
      if (!layer.route) continue;
      for (const m of Object.keys(layer.route.methods)) routes.push(`${m.toUpperCase()} ${layer.route.path.replace(/:(gameId|seat)\b/, ':id')}`);
    }
    expect(routes.length).toBeGreaterThan(20);
    const missing = routes.filter((r) => !covered.has(r) && !elsewhere.includes(r) && !r.endsWith('/live'));
    expect(missing).toEqual([]);
  });

  it('refuses a live view to everyone who may not see the lobby', async () => {
    expect((await roles.anonymous!.get(`/api/lobbies/${lobbyId}/live`)).status).toBe(401);
    expect((await roles.Chen!.get(`/api/lobbies/${lobbyId}/live`)).status).toBe(404);
  });
});

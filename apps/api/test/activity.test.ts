/* eslint-disable @typescript-eslint/no-explicit-any -- JSON responses are inspected loosely */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ActivityService } from '../src/platform/activity.service.js';
import { MemoryStore } from '../src/store/memory.js';
import { TestProgram } from './helpers/program.js';
import { eventually, startTestApp, wait, type Client } from './helpers/testApp.js';
import { World } from './helpers/world.js';

const MIN = 60_000;
/** What a reverse proxy adds: the client address and the protocol it spoke. */
const via = (ip: string, proto: 'https' | 'http' = 'https') => ({ 'x-forwarded-for': ip, 'x-forwarded-proto': proto });

/** A clock the test moves by hand, so "two minutes later" does not take two minutes. */
const manualClock = () => {
  const clock = { t: Date.now(), now: () => clock.t };
  return clock;
};

let w: World;
let admin: Client;
let clock: ReturnType<typeof manualClock>;
beforeEach(async () => {
  clock = manualClock();
  w = await World.create({ TRUST_PROXY_HOPS: '1', GRACE_MS: '3000' }, undefined, clock);
  admin = w.t.client();
  await admin.loginAdmin();
});
afterEach(async () => {
  await w.close();
});

const activity = async (name: 'Alice' | 'Bruno' | 'Chen') => (await admin.get(`/api/admin/participants/${w.t.people[name]}/activity`)).body;
const auditActions = async () => ((await admin.get('/api/admin/audit')).body as any[]).map((e) => e.action);
const kinds = (a: any) => a.signals.map((s: any) => s.kind);

describe('the connection history', () => {
  it('records each connection with address, mode, program and lobby, and closes it when the program leaves', async () => {
    const lobby = await w.newLobby();
    const a = await w.connect('alice', lobby.id, { headers: via('84.1.1.1'), program: { name: 'my-bot', version: '0.3.1' } });
    await a.waitForFrame('welcome');
    const open = (await activity('Alice')).connections[0];
    expect(open).toMatchObject({ ip: '84.1.1.1', secure: true, lobbyId: lobby.id, seat: 1, endedAt: null, endReason: null, program: { name: 'my-bot', version: '0.3.1' }, participant: { name: 'Alice' } });

    a.close();
    await eventually(async () => (await activity('Alice')).connections[0].endedAt !== null);
    expect((await activity('Alice')).connections[0]).toMatchObject({ endReason: 'Closed by the program.' });
  });

  it('says why a connection ended when the platform ended it, and when the peer vanished', async () => {
    const lobby = await w.newLobby();
    const a = await w.connect('alice', lobby.id, { headers: via('84.1.1.1') });
    await a.waitForFrame('welcome');
    await w.alice.post('/api/me/token/replace');
    await a.waitForClose();
    await eventually(async () => (await activity('Alice')).connections[0].endedAt !== null);
    expect((await activity('Alice')).connections[0].endReason).toMatch(/Token replaced/);

  });

  it('keeps the address the proxy reports, and treats a connection as plain when the proxy says http', async () => {
    const lobby = await w.newLobby();
    const a = await w.connect('alice', lobby.id, { headers: via('2a02:2f0e::7', 'http') });
    await a.waitForFrame('welcome');
    expect((await activity('Alice')).connections[0]).toMatchObject({ ip: '2a02:2f0e::7', secure: false });
  });

  it('writes the audit log only when the address, mode or program changes', async () => {
    const lobby = await w.newLobby();
    const connectAndLeave = async (headers: Record<string, string>, program: { name: string; version: string }) => {
      const p = await w.connect('alice', lobby.id, { headers, program });
      await p.waitForFrame('welcome');
      p.close();
      await p.waitForClose();
      clock.t += 1000;
    };
    await connectAndLeave(via('84.1.1.1'), { name: 'bot', version: '1' });
    await connectAndLeave(via('84.1.1.1'), { name: 'bot', version: '1' }); // nothing new
    await connectAndLeave(via('84.1.1.1'), { name: 'bot', version: '2' }); // new version
    await connectAndLeave(via('91.2.2.2'), { name: 'bot', version: '2' }); // new address
    await connectAndLeave(via('91.2.2.2', 'http'), { name: 'bot', version: '2' }); // plain
    const entries = ((await admin.get('/api/admin/audit')).body as any[]).filter((e) => e.action === 'program_connected').reverse();
    expect(entries.map((e) => e.detail)).toEqual([
      '84.1.1.1 · wss · bot 1 · first connection',
      '84.1.1.1 · wss · bot 2',
      '91.2.2.2 · wss · bot 2',
      '91.2.2.2 · ws · bot 2',
    ]);
    expect(entries.every((e) => e.actor === 'Alice' && e.target === lobby.id)).toBe(true);
    expect((await activity('Alice')).connections).toHaveLength(5); // the history keeps every one
  });

  it('survives a restart: the history is still there, and connections left open are closed', async () => {
    const store = new MemoryStore();
    const first = await World.create({ TRUST_PROXY_HOPS: '1' }, store);
    const lobby = await first.newLobby();
    const p = await first.connect('alice', lobby.id, { headers: via('84.1.1.1') });
    await p.waitForFrame('welcome');
    await first.t.app.get(ActivityService).flush();
    const people = first.t.people;
    // Stop without letting the connection close cleanly.
    p.kill();
    await first.t.app.close();

    const second = await startTestApp({ store, env: { TRUST_PROXY_HOPS: '1' }, names: [] });
    const adm = second.client();
    await adm.loginAdmin();
    const a = (await adm.get(`/api/admin/participants/${people.Alice}/activity`)).body;
    expect(a.connections).toHaveLength(1);
    expect(a.connections[0]).toMatchObject({ ip: '84.1.1.1', lobbyId: lobby.id });
    expect(a.connections[0].endedAt).not.toBeNull();
    await second.close();
  });

  it('drops history older than 30 days when the platform starts, and when a participant is deleted', async () => {
    const store = new MemoryStore();
    const t = await startTestApp({ store, names: ['Alice'] });
    const alice = t.people.Alice as string;
    await store.addConnection({ id: 'c_old', participantId: alice, kind: 'connected', at: 1, endedAt: 2, endReason: 'x', ip: '84.1.1.1', secure: true, programName: null, programVersion: null, lobbyId: 'L', seat: 1, takeoverIp: null });
    await t.close();
    const again = await startTestApp({ store, names: [] });
    expect(await store.listConnections(0)).toEqual([]);
    await again.close();

    const solo = await startTestApp({ names: ['Zed'] });
    const adm = solo.client();
    await adm.loginAdmin();
    await solo.store.addConnection({ id: 'c_1', participantId: solo.people.Zed as string, kind: 'connected', at: Date.now(), endedAt: null, endReason: null, ip: '84.1.1.1', secure: true, programName: null, programVersion: null, lobbyId: 'L', seat: 1, takeoverIp: null });
    expect((await solo.store.listConnections(0)).length).toBe(1);
    await adm.del(`/api/admin/participants/${solo.people.Zed}`);
    expect(await solo.store.listConnections(0)).toEqual([]);
    await solo.close();
  });
});

describe('signals', () => {
  it('flags an address the token has not been seen from before, and goes quiet once reviewed — until something new happens', async () => {
    const lobby = await w.newLobby();
    const use = async (ip: string) => {
      const p = await w.connect('alice', lobby.id, { headers: via(ip) });
      await p.waitForFrame('welcome');
      p.close();
      await p.waitForClose();
      clock.t += 5 * MIN;
    };
    await use('84.1.1.1');
    expect(kinds(await activity('Alice'))).toEqual([]); // the first address is the baseline, not news

    await use('91.2.2.2');
    let a = await activity('Alice');
    expect(a.signals.map((s: any) => [s.kind, s.severity, s.reviewed])).toEqual([['new_address', 'notice', false]]);
    const row = (await admin.get('/api/admin/participants')).body.find((p: any) => p.name === 'Alice');
    expect(row.activity).toMatchObject({ lastConnection: { ip: '91.2.2.2', secure: true }, unreviewed: { high: 0, notice: 1, info: 0 } });

    const reviewed = await admin.post(`/api/admin/participants/${w.t.people.Alice}/activity/review`);
    expect(reviewed.status).toBe(200);
    expect(reviewed.body.activity.unreviewed).toEqual({ high: 0, notice: 0, info: 0 });
    a = await activity('Alice');
    expect(a.signals.map((s: any) => s.reviewed)).toEqual([true]); // still listed, as reviewed
    expect(a.reviewedAt).toBeGreaterThan(0);

    clock.t += 1000;
    await use('77.3.3.3'); // something new after the review
    a = await activity('Alice');
    expect(a.signals.filter((s: any) => !s.reviewed).map((s: any) => s.kind).sort()).toEqual(['many_addresses', 'new_address']); // the third address in a week counts too
    expect(a.signals.filter((s: any) => s.reviewed).map((s: any) => s.ips)).toEqual([['91.2.2.2']]); // the earlier one stays reviewed
    expect(await auditActions()).toContain('activity_reviewed');
  });

  it('flags a live connection taken over by another address', async () => {
    const lobby = await w.newLobby();
    const first = await w.connect('alice', lobby.id, { headers: via('84.1.1.1') });
    await first.waitForFrame('welcome');
    clock.t += 10_000;
    const second = await w.connect('alice', lobby.id, { headers: via('91.2.2.2') });
    await second.waitForFrame('welcome');
    expect((await first.waitForClose()).code).toBe(4000);

    const a = await activity('Alice');
    const taken = a.signals.find((s: any) => s.kind === 'taken_over');
    expect(taken).toMatchObject({ severity: 'high', ips: ['84.1.1.1', '91.2.2.2'], reviewed: false });
    expect(a.connections.find((c: any) => c.ip === '84.1.1.1')).toMatchObject({ takeoverIp: '91.2.2.2', endReason: 'Replaced by a newer connection.', flaggedBy: [taken.id] });
    expect(await auditActions()).toContain('program_replaced');
  });

  it('does not flag a program restarting from the same address, or a connection nobody heard from for a while', async () => {
    const lobby = await w.newLobby();
    const first = await w.connect('alice', lobby.id, { headers: via('84.1.1.1') });
    await first.waitForFrame('welcome');
    const same = await w.connect('alice', lobby.id, { headers: via('84.1.1.1') });
    await same.waitForFrame('welcome');
    await first.waitForClose();
    expect(kinds(await activity('Alice'))).not.toContain('taken_over');

    clock.t += 5 * MIN; // the old connection has been silent for a long time (half-open)
    const other = await w.connect('alice', lobby.id, { headers: via('91.2.2.2') });
    await other.waitForFrame('welcome');
    await same.waitForClose();
    const a = await activity('Alice');
    expect(kinds(a)).not.toContain('taken_over');
    expect(kinds(a)).toContain('new_address'); // but the new address is still news
  });

  it('flags the same token on two addresses at the same time, once they have overlapped for a minute', async () => {
    const one = await w.newLobby();
    const two = await w.newLobby();
    const a1 = await w.connect('alice', one.id, { headers: via('84.1.1.1') });
    await a1.waitForFrame('welcome');
    const a2 = await w.connect('alice', two.id, { headers: via('91.2.2.2') });
    await a2.waitForFrame('welcome');
    expect(kinds(await activity('Alice'))).not.toContain('concurrent_addresses'); // not yet a minute
    clock.t += 2 * MIN;
    const a = await activity('Alice');
    const both = a.signals.find((s: any) => s.kind === 'concurrent_addresses');
    expect(both).toMatchObject({ severity: 'high', ips: ['84.1.1.1', '91.2.2.2'] });
    expect(both.connectionIds).toHaveLength(2);
  });

  it('flags a valid token tried on a lobby that is not theirs — once in a while — and says nothing different to the program', async () => {
    const lobby = await w.newLobby(); // Alice vs Bruno
    const chen = w.t.client();
    await chen.loginAs(w.t.people.Chen);
    const chenToken = (await chen.post('/api/me/token')).body.token as string;
    const tryIt = async () => {
      const p = await TestProgram.connect(w.t.url, { token: chenToken, lobby: lobby.id, headers: via('77.3.3.3') });
      return (await p.waitForClose()).code;
    };
    const wrongToken = await TestProgram.connect(w.t.url, { token: 'bsc_' + 'x'.repeat(32), lobby: lobby.id, headers: via('77.3.3.3') });
    const wrongCode = (await wrongToken.waitForClose()).code;
    expect(await tryIt()).toBe(wrongCode); // indistinguishable for the program
    expect(await tryIt()).toBe(wrongCode); // repeated within ten minutes: not recorded again

    const c = await activity('Chen');
    expect(c.denied).toHaveLength(1);
    expect(c.denied[0]).toMatchObject({ kind: 'denied', ip: '77.3.3.3', lobbyId: lobby.id, seat: null });
    expect(c.signals.map((s: any) => [s.kind, s.severity])).toEqual([['foreign_lobby', 'high']]);
    expect((await auditActions()).filter((x) => x === 'program_denied')).toHaveLength(1);
    // Nothing was recorded for the wrong token (it belongs to nobody), and the owners are untouched.
    expect((await activity('Alice')).denied).toEqual([]);

    clock.t += 11 * MIN;
    await tryIt();
    expect((await activity('Chen')).denied).toHaveLength(2);
  });

  it('notes plain ws:// once per address, as information', async () => {
    const lobby = await w.newLobby();
    for (let i = 0; i < 2; i++) {
      const p = await w.connect('alice', lobby.id, { headers: via('84.1.1.1', 'http') });
      await p.waitForFrame('welcome');
      p.close();
      await p.waitForClose();
    }
    const a = await activity('Alice');
    expect(a.signals.map((s: any) => [s.kind, s.severity])).toEqual([['plain_ws', 'info']]);
  });

  it('notes an address shared by several participants, for each of them', async () => {
    const lobby = await w.newLobby();
    const a = await w.connect('alice', lobby.id, { headers: via('84.1.1.1') });
    await a.waitForFrame('welcome');
    clock.t += MIN;
    const b = await w.connect('bruno', lobby.id, { headers: via('84.1.1.1') });
    await b.waitForFrame('welcome');
    for (const [name, other] of [['Alice', 'Bruno'], ['Bruno', 'Alice']] as const) {
      const shared = (await activity(name)).signals.find((s: any) => s.kind === 'shared_address');
      expect(shared, name).toMatchObject({ severity: 'info', ips: ['84.1.1.1'] });
      expect(shared.message).toContain(other);
    }
    expect((await activity('Alice')).addresses[0]).toMatchObject({ ip: '84.1.1.1', alsoUsedBy: [{ name: 'Bruno' }] });
  });

  it('counts a reset as the answer: resetting a token marks the participant reviewed', async () => {
    const lobby = await w.newLobby();
    for (const ip of ['84.1.1.1', '91.2.2.2']) {
      const p = await w.connect('alice', lobby.id, { headers: via(ip) });
      await p.waitForFrame('welcome');
      p.close();
      await p.waitForClose();
      clock.t += MIN;
    }
    expect((await activity('Alice')).signals.some((s: any) => !s.reviewed)).toBe(true);
    await admin.post(`/api/admin/participants/${w.t.people.Alice}/token/reset`);
    expect((await activity('Alice')).signals.every((s: any) => s.reviewed)).toBe(true);
  });
});

describe('the monitor', () => {
  it('summarizes signals across participants, newest first, and counts who was active', async () => {
    const lobby = await w.newLobby();
    for (const [who, ip] of [['alice', '84.1.1.1'], ['alice', '91.2.2.2'], ['bruno', '77.3.3.3']] as const) {
      const p = await w.connect(who, lobby.id, { headers: via(ip) });
      await p.waitForFrame('welcome');
      p.close();
      await p.waitForClose();
      clock.t += MIN;
    }
    const m = (await admin.get('/api/admin/token-activity')).body;
    expect(m.summary).toMatchObject({ needsAttention: 0, notices: 1, activeLast24h: 2, participants: 3 });
    expect(m.signals.map((s: any) => [s.participant.name, s.kind])).toEqual([['Alice', 'new_address']]);
    expect(m.proxyWarning).toBeNull();

    const recent = (await admin.get('/api/admin/token-activity/connections')).body as any[];
    expect(recent.map((c) => [c.participant.name, c.ip])).toEqual([['Bruno', '77.3.3.3'], ['Alice', '91.2.2.2'], ['Alice', '84.1.1.1']]);
  });

  it('warns when every address is the proxy itself', async () => {
    const lobby = await w.newLobby();
    for (const who of ['alice', 'bruno'] as const) {
      const p = await w.connect(who, lobby.id); // no forwarded address: the socket address is loopback
      await p.waitForFrame('welcome');
      await wait(5);
    }
    expect((await admin.get('/api/admin/token-activity')).body.proxyWarning).toMatch(/TRUST_PROXY_HOPS/);
  });

  it('leaves out participants that have been deleted', async () => {
    const lobby = await w.newLobby();
    const p = await w.connect('alice', lobby.id, { headers: via('84.1.1.1') });
    await p.waitForFrame('welcome');
    await admin.del(`/api/admin/participants/${w.t.people.Alice}`);
    expect((await admin.get('/api/admin/token-activity/connections')).body).toEqual([]);
    expect((await admin.get(`/api/admin/participants/${w.t.people.Alice}/activity`)).status).toBe(404);
  });
});

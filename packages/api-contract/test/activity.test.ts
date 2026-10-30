import { describe, expect, it } from 'vitest';
import { ACTIVITY, addressesOf, computeSignals, formatDuration, isPrivateAddress, proxyWarning, type ConnectionFact } from '../src/activity.js';

const MIN = 60_000;
const DAY = 24 * 3_600_000;
const NOW = 100 * DAY;
const names: Record<string, string> = { a: 'Alice', b: 'Bruno', c: 'Chen' };
const nameOf = (id: string) => names[id] ?? id;

let counter = 0;
const conn = (over: Partial<ConnectionFact> & { participantId: string; ip: string; at: number }): ConnectionFact => ({
  id: `c${++counter}`,
  kind: 'connected',
  endedAt: over.at + 5 * MIN,
  endReason: 'Closed by the program.',
  secure: true,
  program: { name: 'bot', version: '1' },
  lobbyId: 'LOBBY-1',
  seat: 1,
  takeoverIp: null,
  ...over,
});
const kinds = (facts: ConnectionFact[], now = NOW) => computeSignals(facts, now, nameOf).map((s) => s.kind);

describe('signals from the connection history', () => {
  it('raises nothing for a participant who always connects from one address', () => {
    const facts = [1, 2, 3].map((i) => conn({ participantId: 'a', ip: '84.1.1.1', at: NOW - i * DAY }));
    expect(computeSignals(facts, NOW, nameOf)).toEqual([]);
  });

  it('does not treat the very first address as news, but flags the next new one', () => {
    const facts = [conn({ participantId: 'a', ip: '84.1.1.1', at: NOW - 3 * DAY }), conn({ participantId: 'a', ip: '91.2.2.2', at: NOW - DAY })];
    const signals = computeSignals(facts, NOW, nameOf);
    expect(signals.map((s) => [s.kind, s.severity, s.at, s.ips])).toEqual([['new_address', 'notice', NOW - DAY, ['91.2.2.2']]]);
  });

  it('flags two addresses in use at once, but only when they overlap long enough', () => {
    const long = [conn({ participantId: 'a', ip: '84.1.1.1', at: NOW - 20 * MIN, endedAt: NOW }), conn({ participantId: 'a', ip: '91.2.2.2', at: NOW - 10 * MIN, endedAt: NOW })];
    const concurrent = computeSignals(long, NOW, nameOf).find((s) => s.kind === 'concurrent_addresses');
    expect(concurrent).toMatchObject({ severity: 'high', at: NOW - 10 * MIN, ips: ['84.1.1.1', '91.2.2.2'] });
    expect(concurrent?.message).toContain('10 min');
    const brief = [conn({ participantId: 'a', ip: '84.1.1.1', at: NOW - 20 * MIN, endedAt: NOW - 9 * MIN }), conn({ participantId: 'a', ip: '91.2.2.2', at: NOW - 9.5 * MIN })];
    expect(kinds(brief)).not.toContain('concurrent_addresses');
  });

  it('counts an open connection as lasting until now, and ignores overlaps between the same address', () => {
    const open = [conn({ participantId: 'a', ip: '84.1.1.1', at: NOW - 30 * MIN, endedAt: null }), conn({ participantId: 'a', ip: '91.2.2.2', at: NOW - 5 * MIN, endedAt: null })];
    expect(kinds(open)).toContain('concurrent_addresses');
    const same = [conn({ participantId: 'a', ip: '84.1.1.1', at: NOW - 30 * MIN, endedAt: null }), conn({ participantId: 'a', ip: '84.1.1.1', at: NOW - 20 * MIN, endedAt: null })];
    expect(kinds(same)).toEqual([]);
  });

  it('flags a connection taken over by another address while it was active', () => {
    const facts = [
      conn({ participantId: 'a', ip: '84.1.1.1', at: NOW - 2 * DAY }),
      conn({ participantId: 'a', ip: '84.1.1.1', at: NOW - 10 * MIN, endedAt: NOW - 2 * MIN, takeoverIp: '91.2.2.2', endReason: 'Replaced by a newer connection.' }),
      conn({ participantId: 'a', ip: '91.2.2.2', at: NOW - 2 * MIN, endedAt: null }),
    ];
    const taken = computeSignals(facts, NOW, nameOf).find((s) => s.kind === 'taken_over');
    expect(taken).toMatchObject({ severity: 'high', at: NOW - 2 * MIN, ips: ['84.1.1.1', '91.2.2.2'] });
  });

  it('flags a valid token tried on a lobby that is not theirs', () => {
    const facts = [conn({ participantId: 'a', ip: '84.1.1.1', at: NOW - 3 * MIN, kind: 'denied', lobbyId: 'ZZZZ-1', endedAt: NOW - 3 * MIN, seat: null })];
    const [signal] = computeSignals(facts, NOW, nameOf);
    expect(signal).toMatchObject({ kind: 'foreign_lobby', severity: 'high', participant: { id: 'a', name: 'Alice' } });
    expect(signal?.message).toContain('ZZZZ-1');
  });

  it('notices three or more addresses in a week, and stops when they fall out of the window', () => {
    const ips = ['84.1.1.1', '91.2.2.2', '77.3.3.3'];
    const facts = ips.map((ip, i) => conn({ participantId: 'a', ip, at: NOW - (3 - i) * DAY }));
    expect(kinds(facts)).toContain('many_addresses');
    const old = ips.map((ip, i) => conn({ participantId: 'a', ip, at: NOW - (20 - i) * DAY }));
    expect(kinds(old)).not.toContain('many_addresses');
    const two = facts.slice(0, 2);
    expect(kinds(two)).not.toContain('many_addresses');
  });

  it('notes plain ws:// once per address, as information only', () => {
    const facts = [1, 2, 3].map((i) => conn({ participantId: 'a', ip: '84.1.1.1', secure: false, at: NOW - i * DAY }));
    const signals = computeSignals(facts, NOW, nameOf);
    expect(signals.map((s) => [s.kind, s.severity])).toEqual([['plain_ws', 'info']]);
  });

  it('notes an address shared by several participants, at the moment the second one appeared, for each of them', () => {
    const facts = [
      conn({ participantId: 'a', ip: '84.1.1.1', at: NOW - 3 * DAY }),
      conn({ participantId: 'b', ip: '84.1.1.1', at: NOW - 2 * DAY }),
      conn({ participantId: 'c', ip: '99.9.9.9', at: NOW - DAY }),
    ];
    const shared = computeSignals(facts, NOW, nameOf).filter((s) => s.kind === 'shared_address');
    expect(shared.map((s) => [s.participant.name, s.at, s.severity]).sort()).toEqual([
      ['Alice', NOW - 2 * DAY, 'info'],
      ['Bruno', NOW - 2 * DAY, 'info'],
    ]);
    expect(shared.find((s) => s.participant.id === 'a')?.message).toContain('Bruno');
  });

  it('does not call a private address shared (that is the proxy, not a person)', () => {
    const facts = [conn({ participantId: 'a', ip: '10.0.0.5', at: NOW - 3 * DAY }), conn({ participantId: 'b', ip: '10.0.0.5', at: NOW - 2 * DAY })];
    expect(kinds(facts)).toEqual([]);
  });

  it('lists the newest first and gives every signal a distinct id', () => {
    const facts = [
      conn({ participantId: 'a', ip: '84.1.1.1', at: NOW - 5 * DAY, secure: false }),
      conn({ participantId: 'a', ip: '91.2.2.2', at: NOW - 3 * DAY }),
      conn({ participantId: 'a', ip: '77.3.3.3', at: NOW - DAY }),
    ];
    const signals = computeSignals(facts, NOW, nameOf);
    expect(signals.map((s) => s.at)).toEqual([...signals.map((s) => s.at)].sort((x, y) => y - x));
    expect(new Set(signals.map((s) => s.id)).size).toBe(signals.length);
  });
});

describe('proxy warning', () => {
  it('warns when everything comes from private addresses or from one address', () => {
    const priv = [conn({ participantId: 'a', ip: '172.18.0.4', at: NOW - DAY }), conn({ participantId: 'b', ip: '172.18.0.4', at: NOW - DAY })];
    expect(proxyWarning(priv, NOW)).toMatch(/TRUST_PROXY_HOPS/);
    const one = ['a', 'b', 'c'].map((p) => conn({ participantId: p, ip: '84.1.1.1', at: NOW - DAY }));
    expect(proxyWarning(one, NOW)).toMatch(/same address/);
  });

  it('stays quiet for normal traffic and for too little data', () => {
    const normal = [conn({ participantId: 'a', ip: '84.1.1.1', at: NOW - DAY }), conn({ participantId: 'b', ip: '91.2.2.2', at: NOW - DAY })];
    expect(proxyWarning(normal, NOW)).toBeNull();
    expect(proxyWarning([conn({ participantId: 'a', ip: '127.0.0.1', at: NOW - DAY })], NOW)).toBeNull();
    expect(proxyWarning([], NOW)).toBeNull();
  });
});

describe('addresses of a participant', () => {
  it('summarizes each address, with the modes used and who else was seen on it', () => {
    const facts = [
      conn({ participantId: 'a', ip: '84.1.1.1', at: NOW - 3 * DAY }),
      conn({ participantId: 'a', ip: '84.1.1.1', at: NOW - DAY, secure: false, endedAt: NOW - DAY + MIN }),
      conn({ participantId: 'a', ip: '91.2.2.2', at: NOW - 5 * DAY }),
      conn({ participantId: 'b', ip: '84.1.1.1', at: NOW - 2 * DAY }),
    ];
    const list = addressesOf(facts, 'a', NOW, nameOf);
    expect(list.map((x) => x.ip)).toEqual(['84.1.1.1', '91.2.2.2']); // most recently seen first
    expect(list[0]).toMatchObject({ connections: 2, modes: ['wss', 'ws'], alsoUsedBy: [{ id: 'b', name: 'Bruno' }], firstSeen: NOW - 3 * DAY });
    expect(list[1]).toMatchObject({ connections: 1, modes: ['wss'], alsoUsedBy: [] });
  });
});

describe('helpers', () => {
  it('recognizes private addresses', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.9', '172.16.0.1', '172.31.255.1', '::1', 'fd00::1', '::ffff:10.0.0.1', 'unknown']) expect(isPrivateAddress(ip), ip).toBe(true);
    for (const ip of ['84.1.1.1', '172.15.0.1', '172.32.0.1', '2a02:2f0e::1']) expect(isPrivateAddress(ip), ip).toBe(false);
  });

  it('formats durations', () => {
    expect([5_000, 60_000, 192_000, 3_600_000, 3_900_000].map(formatDuration)).toEqual(['5 s', '1 min', '3 min 12 s', '1 h', '1 h 5 min']);
  });

  it('keeps the documented thresholds', () => {
    expect(ACTIVITY).toMatchObject({ overlapMs: 60_000, activeMs: 30_000, manyAddresses: 3, retentionDays: 30 });
  });
});

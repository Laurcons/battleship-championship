import type {
  ActivitySignal,
  ActivitySummary,
  AddressSummary,
  ConnectionRecord,
  ParticipantActivity,
  ParticipantRef,
  Seat,
  SignalKind,
  SignalSeverity,
  TokenMonitor,
} from './types.js';

/**
 * How tokens are being used, worked out from the history of program connections. Pure functions: the
 * API runs them on the stored history and the browser mock runs them on its own, so both agree.
 */

/** One accepted connection of a program, or one denied attempt (a valid token on somebody else's lobby). */
export interface ConnectionFact {
  id: string;
  participantId: string;
  kind: 'connected' | 'denied';
  at: number;
  /** Null while the connection is open. */
  endedAt: number | null;
  endReason: string | null;
  ip: string;
  secure: boolean;
  program: { name: string; version: string } | null;
  lobbyId: string;
  seat: Seat | null;
  takeoverIp: string | null;
}

export const ACTIVITY = {
  /** Window for "recent": addresses in use, shared addresses. */
  windowMs: 7 * 24 * 3_600_000,
  /** Two addresses must overlap this long to count as "at once". */
  overlapMs: 60_000,
  /** A connection taken over by another address counts when it was heard from this recently. */
  activeMs: 30_000,
  /** This many different addresses in the window is worth a notice. */
  manyAddresses: 3,
  /** How long connection history is kept. */
  retentionDays: 30,
} as const;

const SEVERITY: Record<SignalKind, SignalSeverity> = {
  concurrent_addresses: 'high',
  taken_over: 'high',
  foreign_lobby: 'high',
  new_address: 'notice',
  many_addresses: 'notice',
  plain_ws: 'info',
  shared_address: 'info',
};

export const SEVERITY_RANK: Record<SignalSeverity, number> = { high: 0, notice: 1, info: 2 };

/** Loopback, private and link-local addresses: what the platform sees when it is not looking through its proxy. */
export function isPrivateAddress(ip: string): boolean {
  const v4 = ip.replace(/^::ffff:/i, '');
  if (/^127\./.test(v4) || /^10\./.test(v4) || /^192\.168\./.test(v4) || /^169\.254\./.test(v4)) return true;
  const m = /^172\.(\d+)\./.exec(v4);
  if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return true;
  const lower = ip.toLowerCase();
  return lower === '::1' || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80') || ip === 'unknown';
}

export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${s % 60} s`.replace(/ 0 s$/, '');
  const h = Math.floor(m / 60);
  return `${h} h ${m % 60} min`.replace(/ 0 min$/, '');
}

type RawSignal = Omit<ActivitySignal, 'reviewed'>;

/** Every signal the history supports, newest first. `reviewed` is left to the caller (it depends on the participant). */
export function computeSignals(facts: ConnectionFact[], now: number, nameOf: (participantId: string) => string): RawSignal[] {
  const out: RawSignal[] = [];
  const ref = (id: string): ParticipantRef => ({ id, name: nameOf(id) });
  const push = (kind: SignalKind, participantId: string, at: number, message: string, ips: string[], connectionIds: string[], tag = '') =>
    out.push({ id: `${kind}:${participantId}:${at}:${tag || ips.join('+')}`, kind, severity: SEVERITY[kind], participant: ref(participantId), at, message, ips, connectionIds });

  const connected = facts.filter((f) => f.kind === 'connected').sort((a, b) => a.at - b.at);
  const byParticipant = new Map<string, ConnectionFact[]>();
  for (const f of connected) byParticipant.set(f.participantId, [...(byParticipant.get(f.participantId) ?? []), f]);
  const windowStart = now - ACTIVITY.windowMs;

  for (const [pid, rows] of byParticipant) {
    const end = (f: ConnectionFact) => f.endedAt ?? now;

    // The same token on two addresses at once.
    for (let i = 0; i < rows.length; i++) {
      const a = rows[i] as ConnectionFact;
      for (let j = i + 1; j < rows.length; j++) {
        const b = rows[j] as ConnectionFact;
        if (b.at >= end(a)) break; // sorted by start: nothing later overlaps `a`
        if (a.ip === b.ip) continue;
        const start = Math.max(a.at, b.at);
        const overlap = Math.min(end(a), end(b)) - start;
        if (overlap < ACTIVITY.overlapMs) continue;
        push('concurrent_addresses', pid, start, `Token in use from ${a.ip} and ${b.ip} at the same time for ${formatDuration(overlap)}.`, [a.ip, b.ip], [a.id, b.id]);
      }
    }

    // A live connection taken over by another address.
    for (const f of rows) {
      if (!f.takeoverIp) continue;
      push('taken_over', pid, f.endedAt ?? f.at, `The connection from ${f.ip} was taken over by ${f.takeoverIp} while it was active.`, [f.ip, f.takeoverIp], [f.id]);
    }

    // Addresses: first sighting of each, and how many are in use.
    const first = new Map<string, ConnectionFact>();
    for (const f of rows) if (!first.has(f.ip)) first.set(f.ip, f);
    const baseline = (rows[0] as ConnectionFact).ip; // the first address ever seen is the baseline, not news
    for (const [ip, f] of first) {
      if (ip === baseline) continue;
      push('new_address', pid, f.at, `New address ${ip}.`, [ip], [f.id]);
    }
    const recent = new Set(rows.filter((f) => f.at >= windowStart).map((f) => f.ip));
    if (recent.size >= ACTIVITY.manyAddresses) {
      const at = Math.max(...[...recent].map((ip) => (first.get(ip) as ConnectionFact).at));
      const ips = [...recent].sort();
      push('many_addresses', pid, at, `${recent.size} different addresses in the last 7 days: ${ips.join(', ')}.`, ips, rows.filter((f) => recent.has(f.ip) && f === first.get(f.ip)).map((f) => f.id), String(recent.size));
    }

    // Plain ws://: once per address.
    const plainSeen = new Set<string>();
    for (const f of rows) {
      if (f.secure || plainSeen.has(f.ip)) continue;
      plainSeen.add(f.ip);
      push('plain_ws', pid, f.at, `Connected over plain ws:// from ${f.ip}: the token travels unencrypted.`, [f.ip], [f.id]);
    }
  }

  // A valid token tried on a lobby that is not theirs.
  for (const f of facts) {
    if (f.kind !== 'denied') continue;
    push('foreign_lobby', f.participantId, f.at, `Token used on lobby ${f.lobbyId}, which is not theirs (from ${f.ip}).`, [f.ip], [f.id]);
  }

  // One address used by several participants.
  const onAddress = new Map<string, Map<string, ConnectionFact>>();
  for (const f of connected) {
    if (f.at < windowStart || isPrivateAddress(f.ip)) continue;
    const m = onAddress.get(f.ip) ?? new Map<string, ConnectionFact>();
    if (!m.has(f.participantId)) m.set(f.participantId, f);
    onAddress.set(f.ip, m);
  }
  for (const [ip, m] of onAddress) {
    if (m.size < 2) continue;
    const times = [...m.values()].map((f) => f.at).sort((a, b) => a - b);
    const at = times[1] as number; // the moment a second participant showed up
    for (const [pid, f] of m) {
      const others = [...m.keys()].filter((id) => id !== pid).map(nameOf);
      push('shared_address', pid, at, `Address ${ip} is also used by ${others.join(', ')}.`, [ip], [f.id]);
    }
  }

  return out.sort((a, b) => b.at - a.at || SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}

/** A warning when the addresses look like the platform's own proxy, which would make every signal meaningless. */
export function proxyWarning(facts: ConnectionFact[], now: number): string | null {
  const recent = facts.filter((f) => f.kind === 'connected' && f.at >= now - ACTIVITY.windowMs);
  const participants = new Set(recent.map((f) => f.participantId));
  const ips = new Set(recent.map((f) => f.ip));
  if (participants.size >= 2 && [...ips].every(isPrivateAddress)) {
    return `Every connection comes from a private address (${[...ips].slice(0, 3).join(', ')}). The platform is probably not seeing the real client addresses: check TRUST_PROXY_HOPS.`;
  }
  if (participants.size >= 3 && ips.size === 1) {
    return `Every connection comes from the same address (${[...ips][0]}). Check TRUST_PROXY_HOPS, unless everyone really is on one network.`;
  }
  return null;
}

/** The addresses one participant's token has been used from. */
export function addressesOf(facts: ConnectionFact[], participantId: string, now: number, nameOf: (id: string) => string): AddressSummary[] {
  const mine = facts.filter((f) => f.kind === 'connected' && f.participantId === participantId);
  const windowStart = now - ACTIVITY.windowMs;
  const byIp = new Map<string, ConnectionFact[]>();
  for (const f of mine) byIp.set(f.ip, [...(byIp.get(f.ip) ?? []), f]);
  return [...byIp.entries()]
    .map(([ip, rows]) => {
      const others = new Set(
        isPrivateAddress(ip) ? [] : facts.filter((f) => f.kind === 'connected' && f.ip === ip && f.participantId !== participantId && f.at >= windowStart).map((f) => f.participantId),
      );
      return {
        ip,
        firstSeen: Math.min(...rows.map((f) => f.at)),
        lastSeen: Math.max(...rows.map((f) => f.endedAt ?? now)),
        connections: rows.length,
        modes: (['wss', 'ws'] as const).filter((m) => rows.some((f) => f.secure === (m === 'wss'))),
        alsoUsedBy: [...others].map((id) => ({ id, name: nameOf(id) })).sort((a, b) => a.name.localeCompare(b.name)),
      };
    })
    .sort((a, b) => b.lastSeen - a.lastSeen);
}

// --- read models: what the admin pages show -------------------------------------------------------

const DAY_MS = 24 * 3_600_000;
const SHOWN_CONNECTIONS = 100;
const SHOWN_DENIED = 50;
const RECENT_CONNECTIONS = 200;

/** Everything the read models need. `facts` must be sorted by start time, oldest first, and only for participants that exist. */
export interface ActivityInputs {
  facts: ConnectionFact[];
  now: number;
  nameOf: (participantId: string) => string;
  /** Signals raised at or before this moment count as reviewed. */
  reviewedAt: (participantId: string) => number;
}

export function signalsOf(inp: ActivityInputs): ActivitySignal[] {
  return computeSignals(inp.facts, inp.now, inp.nameOf).map((s) => ({ ...s, reviewed: s.at <= inp.reviewedAt(s.participant.id) }));
}

/** Per participant who has connected or has a signal: the last connection and the unreviewed signals by severity. */
export function summariesOf(inp: ActivityInputs): Map<string, ActivitySummary> {
  const out = new Map<string, ActivitySummary>();
  for (const f of inp.facts) {
    if (f.kind !== 'connected') continue;
    out.set(f.participantId, { lastConnection: { at: f.at, ip: f.ip, secure: f.secure }, unreviewed: { high: 0, notice: 0, info: 0 } });
  }
  for (const s of signalsOf(inp)) {
    if (s.reviewed) continue;
    const entry = out.get(s.participant.id) ?? { lastConnection: null, unreviewed: { high: 0, notice: 0, info: 0 } };
    entry.unreviewed[s.severity]++;
    out.set(s.participant.id, entry);
  }
  return out;
}

export function monitorOf(inp: ActivityInputs & { participantCount: number }): TokenMonitor {
  const signals = signalsOf(inp);
  const unreviewed = signals.filter((s) => !s.reviewed);
  const active = new Set(inp.facts.filter((f) => f.kind === 'connected' && (f.endedAt === null || f.endedAt >= inp.now - DAY_MS)).map((f) => f.participantId));
  return {
    summary: {
      needsAttention: unreviewed.filter((s) => s.severity === 'high').length,
      notices: unreviewed.filter((s) => s.severity === 'notice').length,
      infos: unreviewed.filter((s) => s.severity === 'info').length,
      activeLast24h: active.size,
      participants: inp.participantCount,
    },
    signals,
    proxyWarning: proxyWarning(inp.facts, inp.now),
  };
}

function recordsOf(facts: ConnectionFact[], signals: ActivitySignal[], ref: (id: string) => ParticipantRef): ConnectionRecord[] {
  const flagged = new Map<string, string[]>();
  for (const s of signals) for (const id of s.connectionIds) flagged.set(id, [...(flagged.get(id) ?? []), s.id]);
  return facts.map((f) => ({
    id: f.id,
    participant: ref(f.participantId),
    kind: f.kind,
    at: f.at,
    endedAt: f.endedAt,
    ip: f.ip,
    secure: f.secure,
    program: f.program,
    lobbyId: f.lobbyId,
    seat: f.seat,
    endReason: f.endReason,
    takeoverIp: f.takeoverIp,
    flaggedBy: flagged.get(f.id) ?? [],
  }));
}

/** The newest connections of everybody, newest first. */
export function recentConnectionsOf(inp: ActivityInputs): ConnectionRecord[] {
  const connected = inp.facts.filter((f) => f.kind === 'connected').slice(-RECENT_CONNECTIONS).reverse();
  return recordsOf(connected, signalsOf(inp), (id) => ({ id, name: inp.nameOf(id) }));
}

/** One participant's addresses, signals (unreviewed and most severe first) and connection history. */
export function participantActivityOf(inp: ActivityInputs & { participantId: string; tokenCreatedAt: number | null }): ParticipantActivity {
  const { participantId } = inp;
  const signals = signalsOf(inp)
    .filter((s) => s.participant.id === participantId)
    .sort((a, b) => Number(a.reviewed) - Number(b.reviewed) || SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.at - a.at);
  const mine = inp.facts.filter((f) => f.participantId === participantId);
  const connected = mine.filter((f) => f.kind === 'connected');
  const recent = connected.filter((f) => f.at >= inp.now - ACTIVITY.windowMs);
  const last = connected.at(-1);
  const ref = (id: string): ParticipantRef => ({ id, name: inp.nameOf(id) });
  return {
    participant: ref(participantId),
    tokenCreatedAt: inp.tokenCreatedAt,
    reviewedAt: inp.reviewedAt(participantId),
    connections7d: recent.length,
    addresses7d: new Set(recent.map((f) => f.ip)).size,
    lastConnection: last ? { at: last.at, ip: last.ip, secure: last.secure } : null,
    signals,
    addresses: addressesOf(inp.facts, participantId, inp.now, inp.nameOf),
    connections: recordsOf(connected.slice(-SHOWN_CONNECTIONS).reverse(), signals, ref),
    denied: recordsOf(mine.filter((f) => f.kind === 'denied').slice(-SHOWN_DENIED).reverse(), signals, ref),
  };
}

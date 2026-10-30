import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  ACTIVITY,
  monitorOf,
  participantActivityOf,
  recentConnectionsOf,
  summariesOf,
  type ActivityInputs,
  type ActivitySummary,
  type ConnectionFact,
  type ConnectionRecord,
  type ParticipantActivity,
  type TokenMonitor,
} from '@bsc/api-contract';
import type { Seat } from '@bsc/engine';
import { STORE, type ConnectionRow, type ParticipantRow, type Store } from '../store/store.js';
import { AccountsService } from './accounts.service.js';
import { AuditService } from './audit.service.js';
import { CLOCK, newId, type Clock } from './util.js';

const DAY_MS = 24 * 3_600_000;
const PRUNE_INTERVAL_MS = 3_600_000;
/** A denied attempt is recorded at most this often per participant, address and lobby. */
const DENIED_EVERY_MS = 10 * 60_000;

export interface ConnectionInfo {
  ip: string;
  secure: boolean;
  program: { name: string; version: string } | null;
  lobbyId: string;
  seat: Seat;
  /** When the seat's previous program was last heard from, if it was connected. */
  previousSeenAt: number | null;
}

const EMPTY_SUMMARY: ActivitySummary = { lastConnection: null, unreviewed: { high: 0, notice: 0, info: 0 } };

/**
 * Where each token has been used from. Every accepted program connection (and every valid token tried on
 * somebody else's lobby) is kept for 30 days; the signals worth an admin's attention are worked out from
 * that history when asked, so nothing about them is stored except the admin's "reviewed" moment.
 * Writes never block a connection: they are queued and failures are logged.
 */
@Injectable()
export class ActivityService {
  private readonly logger = new Logger('activity');
  /** Oldest first. */
  private rows: ConnectionRow[] = [];
  private byId = new Map<string, ConnectionRow>();
  private lastConnected = new Map<string, ConnectionRow>();
  private deniedAt = new Map<string, number>();
  private queue: Promise<void> = Promise.resolve();
  private pruneTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject(STORE) private readonly store: Store,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AccountsService) private readonly accounts: AccountsService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async init(): Promise<void> {
    const now = this.clock.now();
    await this.store.pruneConnections(now - ACTIVITY.retentionDays * DAY_MS);
    // A restart closed every connection; whatever is still marked open is stale.
    await this.store.endOpenConnections(now, 'The platform restarted.');
    this.rows = await this.store.listConnections(0);
    this.byId = new Map(this.rows.map((r) => [r.id, r]));
    this.lastConnected = new Map();
    for (const r of this.rows) if (r.kind === 'connected') this.lastConnected.set(r.participantId, r);
    this.pruneTimer = setInterval(() => this.prune(), PRUNE_INTERVAL_MS);
    this.pruneTimer.unref();
  }

  dispose(): void {
    if (this.pruneTimer) clearInterval(this.pruneTimer);
    this.pruneTimer = null;
  }

  /** Resolves when everything queued so far has been written (tests, shutdown). */
  flush(): Promise<void> {
    return this.queue;
  }

  private enqueue(job: () => Promise<void>): void {
    this.queue = this.queue.then(job).catch((error: unknown) => this.logger.error(error instanceof Error ? error.message : String(error)));
  }

  private prune(): void {
    const before = this.clock.now() - ACTIVITY.retentionDays * DAY_MS;
    this.rows = this.rows.filter((r) => r.at >= before);
    this.byId = new Map(this.rows.map((r) => [r.id, r]));
    this.enqueue(() => this.store.pruneConnections(before));
  }

  // --- recording -------------------------------------------------------------------------------

  /** A program has been accepted. Returns the id to pass to `ended` when the connection closes. */
  connected(p: ParticipantRow, info: ConnectionInfo): string {
    const now = this.clock.now();
    const previous = this.lastConnected.get(p.id);

    // The program this one replaces on the same seat: noteworthy when another address takes over a live one.
    for (const old of this.rows) {
      if (old.endedAt !== null || old.kind !== 'connected' || old.participantId !== p.id || old.lobbyId !== info.lobbyId || old.seat !== info.seat) continue;
      const active = info.previousSeenAt !== null && now - info.previousSeenAt <= ACTIVITY.activeMs;
      const takeover = old.ip !== info.ip && active ? info.ip : null;
      this.finish(old, now, 'Replaced by a newer connection.', takeover);
      if (takeover) this.note(p.name, 'program_replaced', info.lobbyId, `${old.ip} → ${info.ip}`);
    }

    const row: ConnectionRow = {
      id: newId('c', 12),
      participantId: p.id,
      kind: 'connected',
      at: now,
      endedAt: null,
      endReason: null,
      ip: info.ip,
      secure: info.secure,
      programName: info.program?.name.slice(0, 100) ?? null,
      programVersion: info.program?.version.slice(0, 100) ?? null,
      lobbyId: info.lobbyId,
      seat: info.seat,
      takeoverIp: null,
    };
    this.add(row);
    this.lastConnected.set(p.id, row);

    // The audit log gets the changes, the history gets everything.
    const changed = !previous || previous.ip !== row.ip || previous.secure !== row.secure || previous.programName !== row.programName || previous.programVersion !== row.programVersion;
    if (changed) {
      const program = row.programName ? `${row.programName}${row.programVersion ? ` ${row.programVersion}` : ''}` : 'unnamed program';
      this.note(p.name, 'program_connected', info.lobbyId, `${row.ip} · ${row.secure ? 'wss' : 'ws'} · ${program}${previous ? '' : ' · first connection'}`);
    }
    return row.id;
  }

  /** The connection closed. A connection that was already closed (taken over) keeps its first reason. */
  ended(id: string, reason: string): void {
    const row = this.byId.get(id);
    if (row && row.endedAt === null) this.finish(row, this.clock.now(), reason, null);
  }

  /** A valid token was tried on a lobby that is not the participant's. Recorded at most once in a while per address and lobby. */
  denied(p: ParticipantRow, info: { ip: string; secure: boolean; lobbyId: string }): void {
    const now = this.clock.now();
    const key = `${p.id}|${info.ip}|${info.lobbyId}`;
    if (now - (this.deniedAt.get(key) ?? -Infinity) < DENIED_EVERY_MS) return;
    this.deniedAt.set(key, now);
    if (this.deniedAt.size > 5000) this.deniedAt.clear();
    this.add({
      id: newId('c', 12),
      participantId: p.id,
      kind: 'denied',
      at: now,
      endedAt: now,
      endReason: 'Refused: not their lobby.',
      ip: info.ip,
      secure: info.secure,
      programName: null,
      programVersion: null,
      lobbyId: info.lobbyId,
      seat: null,
      takeoverIp: null,
    });
    this.note(p.name, 'program_denied', info.lobbyId, `${info.ip} · ${info.secure ? 'wss' : 'ws'} · token is valid but the lobby is not theirs`);
  }

  private add(row: ConnectionRow): void {
    this.rows.push(row);
    this.byId.set(row.id, row);
    this.enqueue(() => this.store.addConnection(row));
  }

  private finish(row: ConnectionRow, endedAt: number, reason: string, takeoverIp: string | null): void {
    row.endedAt = endedAt;
    row.endReason = reason.slice(0, 200);
    row.takeoverIp = takeoverIp;
    this.enqueue(() => this.store.endConnection(row.id, endedAt, row.endReason ?? reason, takeoverIp));
  }

  private note(actor: string, action: string, target: string, detail: string): void {
    void this.audit.record(actor, action, target, detail).catch((error: unknown) => this.logger.error(String(error)));
  }

  // --- reading ---------------------------------------------------------------------------------

  private nameOf = (id: string): string => this.accounts.nameOf(id);

  /** The inputs of the read models: the history of participants that still exist. */
  private inputs(): ActivityInputs {
    const facts: ConnectionFact[] = this.rows
      .filter((r) => this.accounts.get(r.participantId))
      .map((r) => ({
        id: r.id,
        participantId: r.participantId,
        kind: r.kind,
        at: r.at,
        endedAt: r.endedAt,
        endReason: r.endReason,
        ip: r.ip,
        secure: r.secure,
        program: r.programName ? { name: r.programName, version: r.programVersion ?? '' } : null,
        lobbyId: r.lobbyId,
        seat: r.seat as Seat | null,
        takeoverIp: r.takeoverIp,
      }));
    return { facts, now: this.clock.now(), nameOf: this.nameOf, reviewedAt: (id) => this.accounts.get(id)?.activityReviewedAt ?? 0 };
  }

  /** Per participant: the last connection and the unreviewed signals, for the participants list. */
  summaries(): Map<string, ActivitySummary> {
    return summariesOf(this.inputs());
  }

  emptySummary(): ActivitySummary {
    return structuredClone(EMPTY_SUMMARY);
  }

  monitor(): TokenMonitor {
    return monitorOf({ ...this.inputs(), participantCount: this.accounts.list().length });
  }

  recent(): ConnectionRecord[] {
    return recentConnectionsOf(this.inputs());
  }

  detail(participantId: string): ParticipantActivity {
    const p = this.accounts.get(participantId);
    if (!p) throw new Error('unknown participant');
    return participantActivityOf({ ...this.inputs(), participantId, tokenCreatedAt: p.tokenCreatedAt });
  }
}

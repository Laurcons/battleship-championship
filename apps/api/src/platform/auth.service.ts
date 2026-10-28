import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ApiError, type ParticipantRef, type Session } from '@bsc/api-contract';
import { CONFIG, type Config } from '../config.js';
import { STORE, type Store, type WebSessionRow } from '../store/store.js';
import { AccountsService } from './accounts.service.js';
import { AuditService } from './audit.service.js';
import type { Viewer } from './policy.js';
import { CLOCK, RateLimiter, sha256Hex, verifyPassword, type Clock } from './util.js';

const GATE_TTL_MS = 15 * 60_000;

export interface Issued<T> {
  value: T;
  /** The new session cookie value to set, if the session changed. */
  cookie?: string;
}

/** Shared password gate, participant and admin login, and the sessions behind the cookie. */
@Injectable()
export class AuthService {
  private readonly limiter: RateLimiter;

  constructor(
    @Inject(STORE) private readonly store: Store,
    @Inject(CONFIG) private readonly config: Config,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AccountsService) private readonly accounts: AccountsService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {
    this.limiter = new RateLimiter(config.loginRate.attempts, config.loginRate.windowMs, clock);
  }

  private async createSession(role: WebSessionRow['role'], extra: Partial<WebSessionRow>, ttlMs: number): Promise<string> {
    const cookie = randomBytes(32).toString('base64url');
    const now = this.clock.now();
    await this.store.saveSession({
      idHash: sha256Hex(cookie),
      role,
      participantId: null,
      adminUsername: null,
      createdAt: now,
      expiresAt: now + ttlMs,
      ...extra,
    });
    return cookie;
  }

  private async load(cookie: string | undefined): Promise<WebSessionRow | null> {
    if (!cookie || cookie.length > 100) return null;
    const row = await this.store.getSession(sha256Hex(cookie));
    if (!row) return null;
    if (row.expiresAt <= this.clock.now()) {
      await this.store.deleteSession(row.idHash);
      return null;
    }
    return row;
  }

  /** The signed-in viewer behind a session cookie, or null. Gate-only sessions have no identity. */
  async viewerFor(cookie: string | undefined): Promise<Viewer | null> {
    const row = await this.load(cookie);
    if (!row) return null;
    if (row.role === 'admin' && row.adminUsername) return { role: 'admin', username: row.adminUsername };
    if (row.role === 'participant' && row.participantId) {
      const p = this.accounts.get(row.participantId);
      return p ? { role: 'participant', participantId: p.id, name: p.name } : null;
    }
    return null;
  }

  sessionOf(viewer: Viewer): Session {
    return viewer.role === 'admin'
      ? { role: 'admin', username: viewer.username }
      : { role: 'participant', participantId: viewer.participantId, name: viewer.name };
  }

  private checkLimit(key: string): void {
    const retryAfterSec = this.limiter.retryAfterSec(key);
    if (retryAfterSec > 0) {
      throw new ApiError('rate_limited', `Too many failed attempts. Try again in ${retryAfterSec} s.`, { retryAfterSec });
    }
  }

  /** Step 1 of participant login. Failures are rate limited per client address. */
  async verifySharedPassword(ip: string, password: string): Promise<Issued<ParticipantRef[]>> {
    this.checkLimit(ip);
    if (!(await verifyPassword(password, this.config.sharedPassword))) {
      this.limiter.hit(ip);
      throw new ApiError('invalid_credentials', 'Wrong password.');
    }
    const cookie = await this.createSession('gate', {}, GATE_TTL_MS);
    return { value: this.accounts.list(), cookie };
  }

  /** Step 2: turns a verified gate session into a participant session (the session id changes). */
  async loginParticipant(cookie: string | undefined, participantId: string): Promise<Issued<Session>> {
    const gate = await this.load(cookie);
    if (!gate || gate.role !== 'gate') throw new ApiError('unauthenticated', 'Enter the shared password first.');
    const p = this.accounts.get(participantId);
    if (!p) throw new ApiError('not_found', 'Unknown participant.');
    await this.store.deleteSession(gate.idHash);
    const fresh = await this.createSession('participant', { participantId: p.id }, this.config.sessionTtlMs);
    await this.audit.record(p.name, 'login');
    return { value: { role: 'participant', participantId: p.id, name: p.name }, cookie: fresh };
  }

  async loginAdmin(ip: string, username: string, password: string): Promise<Issued<Session>> {
    this.checkLimit(ip);
    const userOk = username === this.config.admin.username;
    // Always verify, so response time does not reveal whether the username was right.
    const passOk = await verifyPassword(password, this.config.admin.password);
    if (!userOk || !passOk) {
      this.limiter.hit(ip);
      throw new ApiError('invalid_credentials', 'Wrong username or password.');
    }
    const cookie = await this.createSession('admin', { adminUsername: username }, this.config.sessionTtlMs);
    await this.audit.record(`admin:${username}`, 'login');
    return { value: { role: 'admin', username }, cookie };
  }

  async logout(cookie: string | undefined): Promise<void> {
    if (cookie) await this.store.deleteSession(sha256Hex(cookie));
  }

  async purgeExpired(): Promise<void> {
    await this.store.deleteExpiredSessions(this.clock.now());
  }
}

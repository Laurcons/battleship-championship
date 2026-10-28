import { Inject, Injectable } from '@nestjs/common';
import { generateToken, TOKEN_PATTERN } from '@bsc/protocol';
import { ApiError, type AdminParticipant, type MyToken, type ParticipantRef } from '@bsc/api-contract';
import { STORE, type ParticipantRow, type Store } from '../store/store.js';
import { AuditService } from './audit.service.js';
import { CLOCK, Mutex, newId, randomBytesUint8, sha256Hex, type Clock } from './util.js';

const NAME_PATTERN = /^[\p{L}\p{N} ._-]{1,24}$/u;

/** Participants and their program tokens. */
@Injectable()
export class AccountsService {
  private byId = new Map<string, ParticipantRow>();
  private byTokenHash = new Map<string, string>();
  private readonly lock = new Mutex();
  /** Listeners told when a participant's token was replaced, so their connections can be dropped. */
  private tokenReplacedListeners: ((participantId: string) => void)[] = [];
  /** Set by the lobby service: in how many lobbies a participant has a seat. */
  lobbyCounter: (participantId: string) => number = () => 0;

  constructor(
    @Inject(STORE) private readonly store: Store,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async init(): Promise<void> {
    for (const row of await this.store.listParticipants()) this.index(row);
  }

  private index(row: ParticipantRow): void {
    this.byId.set(row.id, row);
    for (const [hash, id] of this.byTokenHash) if (id === row.id) this.byTokenHash.delete(hash);
    if (row.tokenHash) this.byTokenHash.set(row.tokenHash, row.id);
  }

  onTokenReplaced(listener: (participantId: string) => void): void {
    this.tokenReplacedListeners.push(listener);
  }

  get(id: string): ParticipantRow | undefined {
    return this.byId.get(id);
  }

  nameOf(id: string): string {
    return this.byId.get(id)?.name ?? '(deleted)';
  }

  ref(id: string): ParticipantRef {
    return { id, name: this.nameOf(id) };
  }

  list(): ParticipantRef[] {
    return [...this.byId.values()].map((p) => ({ id: p.id, name: p.name })).sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Finds the owner of a program token, or null. The comparison is on the hash, never the token. */
  findByToken(token: string): ParticipantRow | null {
    if (!TOKEN_PATTERN.test(token)) return null;
    const id = this.byTokenHash.get(sha256Hex(token));
    return id ? (this.byId.get(id) ?? null) : null;
  }

  // --- tokens ----------------------------------------------------------------------------------

  tokenInfo(participantId: string): MyToken {
    const p = this.require(participantId);
    return {
      exists: p.tokenHash !== null,
      preview: p.tokenPreview ? `bsc_••••••••${p.tokenPreview}` : null,
      createdAt: p.tokenCreatedAt,
      replaced: p.tokenReplaced,
      notice: p.tokenNoticeAt === null ? null : { at: p.tokenNoticeAt },
    };
  }

  createToken(participantId: string): Promise<{ token: string }> {
    return this.lock.run(async () => {
      const p = this.require(participantId);
      if (p.tokenHash) throw new ApiError('conflict', 'You already have a token. Replace it instead.');
      const token = await this.issue(p, false);
      await this.audit.record(p.name, 'token_created');
      return { token };
    });
  }

  replaceToken(participantId: string): Promise<{ token: string }> {
    return this.lock.run(async () => {
      const p = this.require(participantId);
      if (!p.tokenHash) throw new ApiError('conflict', "You don't have a token yet. Create one first.");
      const token = await this.issue(p, true);
      await this.audit.record(p.name, 'token_replaced');
      this.tokenReplacedListeners.forEach((l) => l(p.id));
      return { token };
    });
  }

  /** Test and operations hook: the token was replaced from another session; the owner gets a notice. */
  replaceTokenElsewhere(participantId: string): Promise<{ token: string }> {
    return this.lock.run(async () => {
      const p = this.require(participantId);
      const token = await this.issue(p, true, true);
      await this.audit.record('(another session)', 'token_replaced', p.name);
      this.tokenReplacedListeners.forEach((l) => l(p.id));
      return { token };
    });
  }

  private async issue(p: ParticipantRow, replaced: boolean, notice = false): Promise<string> {
    const token = generateToken(randomBytesUint8);
    const now = this.clock.now();
    const next: ParticipantRow = {
      ...p,
      tokenHash: sha256Hex(token),
      tokenPreview: token.slice(-4),
      tokenCreatedAt: now,
      tokenReplaced: replaced,
      tokenNoticeAt: notice ? now : null,
    };
    await this.store.saveParticipant(next);
    this.index(next);
    return token;
  }

  acknowledgeTokenNotice(participantId: string): Promise<void> {
    return this.lock.run(async () => {
      const p = this.require(participantId);
      if (p.tokenNoticeAt === null) return;
      const next = { ...p, tokenNoticeAt: null };
      await this.store.saveParticipant(next);
      this.index(next);
    });
  }

  // --- admin -----------------------------------------------------------------------------------

  private adminView(p: ParticipantRow): AdminParticipant {
    return { id: p.id, name: p.name, createdAt: p.createdAt, tokenCreatedAt: p.tokenCreatedAt, lobbyCount: this.lobbyCounter(p.id) };
  }

  adminList(): AdminParticipant[] {
    return [...this.byId.values()].map((p) => this.adminView(p)).sort((a, b) => a.name.localeCompare(b.name));
  }

  private validateName(name: string, exceptId?: string): string {
    const trimmed = name.trim();
    if (!NAME_PATTERN.test(trimmed)) {
      throw new ApiError('validation', 'Names are 1-24 characters: letters, digits, spaces, dots, dashes and underscores.');
    }
    for (const p of this.byId.values()) {
      if (p.id !== exceptId && p.name.toLowerCase() === trimmed.toLowerCase()) {
        throw new ApiError('conflict', `There is already a participant called "${trimmed}".`);
      }
    }
    return trimmed;
  }

  create(actor: string, name: string): Promise<AdminParticipant> {
    return this.lock.run(async () => {
      const row: ParticipantRow = {
        id: newId('p'),
        name: this.validateName(name),
        tokenHash: null,
        tokenPreview: null,
        tokenCreatedAt: null,
        tokenReplaced: false,
        tokenNoticeAt: null,
        createdAt: this.clock.now(),
      };
      await this.store.saveParticipant(row);
      this.index(row);
      await this.audit.record(actor, 'participant_created', row.name);
      return this.adminView(row);
    });
  }

  rename(actor: string, id: string, name: string): Promise<AdminParticipant> {
    return this.lock.run(async () => {
      const p = this.byId.get(id);
      if (!p) throw new ApiError('not_found', 'Participant not found.');
      const next = { ...p, name: this.validateName(name, id) };
      await this.store.saveParticipant(next);
      this.index(next);
      await this.audit.record(actor, 'participant_renamed', p.name, `now ${next.name}`);
      return this.adminView(next);
    });
  }

  delete(actor: string, id: string): Promise<void> {
    return this.lock.run(async () => {
      const p = this.byId.get(id);
      if (!p) throw new ApiError('not_found', 'Participant not found.');
      const lobbies = this.lobbyCounter(id);
      if (lobbies > 0) {
        throw new ApiError('conflict', `${p.name} is part of ${lobbies} lobb${lobbies === 1 ? 'y' : 'ies'}. Delete those first.`);
      }
      await this.store.deleteSessionsOf(id);
      await this.store.deleteParticipant(id);
      this.byId.delete(id);
      for (const [hash, owner] of this.byTokenHash) if (owner === id) this.byTokenHash.delete(hash);
      await this.audit.record(actor, 'participant_deleted', p.name);
    });
  }

  private require(id: string): ParticipantRow {
    const p = this.byId.get(id);
    if (!p) throw new ApiError('not_found', 'Participant not found.');
    return p;
  }
}

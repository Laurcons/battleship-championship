import { Inject, Injectable } from '@nestjs/common';
import type { AuditEntry } from '@bsc/api-contract';
import { STORE, type Store } from '../store/store.js';
import { CLOCK, type Clock } from './util.js';

const MAX_LISTED = 500;

@Injectable()
export class AuditService {
  constructor(
    @Inject(STORE) private readonly store: Store,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async record(actor: string, action: string, target: string | null = null, detail: string | null = null): Promise<void> {
    await this.store.appendAudit({
      at: this.clock.now(),
      actor: actor.slice(0, 120),
      action,
      target: target?.slice(0, 200) ?? null,
      detail: detail?.slice(0, 500) ?? null,
    });
  }

  async list(): Promise<AuditEntry[]> {
    return this.store.listAudit(MAX_LISTED);
  }
}

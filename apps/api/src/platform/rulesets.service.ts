import { Inject, Injectable } from '@nestjs/common';
import { CLASSIC_10X10, validateRuleset, type Ruleset } from '@bsc/engine';
import { ApiError, type RulesetInfo } from '@bsc/api-contract';
import { STORE, type RulesetRow, type Store } from '../store/store.js';
import { AuditService } from './audit.service.js';
import { SettingsService } from './settings.service.js';
import { CLOCK, Mutex, type Clock } from './util.js';

@Injectable()
export class RulesetsService {
  private rows = new Map<string, RulesetRow>();
  private readonly lock = new Mutex();
  /** Set by the lobby service: how many lobbies use a ruleset (shown to the admin). */
  lobbyCounter: (rulesetId: string) => number = () => 0;

  constructor(
    @Inject(STORE) private readonly store: Store,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async init(): Promise<void> {
    for (const row of await this.store.listRulesets()) this.rows.set(row.ruleset.id, row);
    if (this.rows.size === 0) {
      const seed: RulesetRow = { ruleset: CLASSIC_10X10, enabled: true, createdAt: this.clock.now() };
      await this.store.saveRuleset(seed);
      this.rows.set(seed.ruleset.id, seed);
    }
    const current = this.rows.get(this.settings.defaultRulesetId);
    if (!current?.enabled) {
      const fallback = [...this.rows.values()].filter((r) => r.enabled).sort((a, b) => a.createdAt - b.createdAt)[0];
      if (fallback) await this.settings.setDefaultRulesetId(fallback.ruleset.id);
    }
  }

  get(id: string): RulesetRow | undefined {
    return this.rows.get(id);
  }

  private info(row: RulesetRow, admin: boolean): RulesetInfo {
    return {
      ruleset: row.ruleset,
      enabled: row.enabled,
      createdAt: row.createdAt,
      lobbyCount: admin ? this.lobbyCounter(row.ruleset.id) : null,
      isDefault: row.ruleset.id === this.settings.defaultRulesetId,
    };
  }

  /** The default first, then the other enabled rulesets (newest first), then the disabled ones (newest first). */
  list(admin: boolean): RulesetInfo[] {
    const defaultId = this.settings.defaultRulesetId;
    const rank = (r: RulesetRow) => (r.ruleset.id === defaultId ? 0 : r.enabled ? 1 : 2);
    return [...this.rows.values()]
      .sort((a, b) => rank(a) - rank(b) || b.createdAt - a.createdAt || a.ruleset.id.localeCompare(b.ruleset.id))
      .map((r) => this.info(r, admin));
  }

  create(actor: string, ruleset: Ruleset): Promise<RulesetInfo> {
    return this.lock.run(async () => {
      const problems = validateRuleset(ruleset);
      if (this.rows.has(ruleset.id)) problems.unshift(`a ruleset called "${ruleset.id}" already exists.`);
      if (problems.length > 0) throw new ApiError('validation', problems.join(' '), { problems });
      const row: RulesetRow = { ruleset, enabled: true, createdAt: this.clock.now() };
      await this.store.saveRuleset(row);
      this.rows.set(ruleset.id, row);
      await this.audit.record(actor, 'ruleset_created', ruleset.id);
      return this.info(row, true);
    });
  }

  setEnabled(actor: string, id: string, enabled: boolean): Promise<RulesetInfo> {
    return this.lock.run(async () => {
      const row = this.rows.get(id);
      if (!row) throw new ApiError('not_found', 'Ruleset not found.');
      if (!enabled && row.enabled && [...this.rows.values()].filter((r) => r.enabled).length === 1) {
        throw new ApiError('conflict', 'At least one ruleset must stay enabled.');
      }
      if (!enabled && id === this.settings.defaultRulesetId) {
        throw new ApiError('conflict', `"${id}" is the default ruleset. Make another ruleset the default before disabling it.`);
      }
      const updated = { ...row, enabled };
      await this.store.saveRuleset(updated);
      this.rows.set(id, updated);
      await this.audit.record(actor, enabled ? 'ruleset_enabled' : 'ruleset_disabled', id);
      return this.info(updated, true);
    });
  }

  setDefault(actor: string, id: string): Promise<RulesetInfo> {
    return this.lock.run(async () => {
      const row = this.rows.get(id);
      if (!row) throw new ApiError('not_found', 'Ruleset not found.');
      if (!row.enabled) throw new ApiError('conflict', `"${id}" is disabled. Enable it before making it the default.`);
      if (this.settings.defaultRulesetId !== id) {
        await this.settings.setDefaultRulesetId(id);
        await this.audit.record(actor, 'default_ruleset_changed', id);
      }
      return this.info(row, true);
    });
  }
}

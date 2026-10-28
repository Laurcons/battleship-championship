import { Inject, Injectable } from '@nestjs/common';
import { ApiError, type PlatformInfo, type PlatformSettings } from '@bsc/api-contract';
import { CONFIG, type Config } from '../config.js';
import { STORE, type Store } from '../store/store.js';
import { AuditService } from './audit.service.js';
import { Mutex } from './util.js';

const DEFAULTS = { allowGodMode: true, maxBatterySize: 1000, defaultRulesetId: 'classic-10x10' };
const MAX_BATTERY_LIMIT = 10_000;

/** Admin-controlled settings, cached in memory and written through to the store. */
@Injectable()
export class SettingsService {
  private values = { ...DEFAULTS };
  private readonly lock = new Mutex();

  constructor(
    @Inject(STORE) private readonly store: Store,
    @Inject(CONFIG) private readonly config: Config,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async init(): Promise<void> {
    const saved = await this.store.getSettings();
    if (saved.allowGodMode !== undefined) this.values.allowGodMode = saved.allowGodMode === 'true';
    if (saved.maxBatterySize !== undefined) this.values.maxBatterySize = Number(saved.maxBatterySize);
    if (saved.defaultRulesetId !== undefined) this.values.defaultRulesetId = saved.defaultRulesetId;
  }

  get allowGodMode(): boolean {
    return this.values.allowGodMode;
  }
  get maxBatterySize(): number {
    return this.values.maxBatterySize;
  }
  get defaultRulesetId(): string {
    return this.values.defaultRulesetId;
  }

  async setDefaultRulesetId(id: string): Promise<void> {
    await this.store.setSetting('defaultRulesetId', id);
    this.values.defaultRulesetId = id;
  }

  info(): PlatformInfo {
    const l = this.config.limits;
    return {
      allowGodMode: this.values.allowGodMode,
      maxBatterySize: this.values.maxBatterySize,
      limits: { moveMs: l.moveMs, placeMs: l.placeMs, graceMs: l.graceMs, maxStrikes: l.maxStrikes, idleExpiryMs: l.idleExpiryMs },
    };
  }

  adminView(): PlatformSettings {
    const l = this.config.limits;
    return {
      allowGodMode: this.values.allowGodMode,
      maxBatterySize: this.values.maxBatterySize,
      constants: [
        { label: 'Move timeout', value: `${l.moveMs / 1000} s` },
        { label: 'Placement timeout', value: `${l.placeMs / 1000} s` },
        { label: 'Disconnect grace (resume window)', value: `${l.graceMs / 1000} s` },
        { label: 'Idle lobby expiry', value: `${l.idleExpiryMs / 3_600_000} h` },
        { label: 'Open lobbies per participant', value: String(l.maxOpenLobbies) },
        { label: 'Invalid-move strikes before forfeit', value: String(l.maxStrikes) },
      ],
    };
  }

  update(actor: string, patch: { allowGodMode?: boolean; maxBatterySize?: number }): Promise<PlatformSettings> {
    return this.lock.run(async () => {
      if (patch.maxBatterySize !== undefined) {
        const n = patch.maxBatterySize;
        if (!Number.isInteger(n) || n < 1 || n > MAX_BATTERY_LIMIT) {
          throw new ApiError('validation', `The maximum battery size must be a whole number between 1 and ${MAX_BATTERY_LIMIT}.`);
        }
        await this.store.setSetting('maxBatterySize', String(n));
        this.values.maxBatterySize = n;
        await this.audit.record(actor, 'max_battery_changed', null, String(n));
      }
      if (patch.allowGodMode !== undefined) {
        await this.store.setSetting('allowGodMode', String(patch.allowGodMode));
        this.values.allowGodMode = patch.allowGodMode;
        await this.audit.record(actor, 'god_mode_policy_changed', null, patch.allowGodMode ? 'allowed' : 'not allowed');
      }
      return this.adminView();
    });
  }
}

import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post } from '@nestjs/common';
import {
  participantNameSchema,
  participantPatchSchema,
  rulesetSchema,
  setEnabledSchema,
  updateSettingsSchema,
  type AdminParticipant,
  type AuditEntry,
  type LobbySummary,
  type PlatformSettings,
  type RulesetInfo,
} from '@bsc/api-contract';
import type { Ruleset } from '@bsc/engine';
import { AccountsService } from '../platform/accounts.service.js';
import { AuditService } from '../platform/audit.service.js';
import { LobbiesService } from '../platform/lobbies.service.js';
import { RulesetsService } from '../platform/rulesets.service.js';
import { SettingsService } from '../platform/settings.service.js';
import { Access, CurrentAdmin, ZodPipe } from './context.js';

type Admin = { username: string };
const who = (a: Admin) => `admin:${a.username}`;

@Controller('api/admin')
@Access('admin')
export class AdminController {
  constructor(
    @Inject(AccountsService) private readonly accounts: AccountsService,
    @Inject(RulesetsService) private readonly rulesets: RulesetsService,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(LobbiesService) private readonly lobbies: LobbiesService,
  ) {}

  @Get('participants')
  participants(): AdminParticipant[] {
    return this.accounts.adminList();
  }

  @Post('participants')
  @HttpCode(201)
  createParticipant(@CurrentAdmin() a: Admin, @Body(new ZodPipe(participantNameSchema)) body: { name: string }): Promise<AdminParticipant> {
    return this.accounts.create(who(a), body.name);
  }

  @Patch('participants/:id')
  async patchParticipant(
    @CurrentAdmin() a: Admin,
    @Param('id') id: string,
    @Body(new ZodPipe(participantPatchSchema)) body: { name?: string; allowInsecure?: boolean },
  ): Promise<AdminParticipant> {
    let result: AdminParticipant | undefined;
    if (body.name !== undefined) result = await this.accounts.rename(who(a), id, body.name);
    if (body.allowInsecure !== undefined) result = await this.accounts.setAllowInsecure(who(a), id, body.allowInsecure);
    return result as AdminParticipant;
  }

  @Delete('participants/:id')
  @HttpCode(204)
  async deleteParticipant(@CurrentAdmin() a: Admin, @Param('id') id: string): Promise<void> {
    // Their lobbies go first, whoever created them; a participant who does not exist is a 404 from `delete`.
    if (this.accounts.get(id)) await this.lobbies.deleteAllOf({ role: 'admin', username: a.username }, id);
    await this.accounts.delete(who(a), id);
  }

  @Post('participants/:id/token/reset')
  @HttpCode(200)
  resetToken(@CurrentAdmin() a: Admin, @Param('id') id: string): Promise<AdminParticipant> {
    return this.accounts.resetToken(who(a), id);
  }

  @Post('rulesets')
  @HttpCode(201)
  createRuleset(@CurrentAdmin() a: Admin, @Body(new ZodPipe(rulesetSchema)) body: Ruleset): Promise<RulesetInfo> {
    return this.rulesets.create(who(a), body);
  }

  @Patch('rulesets/:id')
  setEnabled(
    @CurrentAdmin() a: Admin,
    @Param('id') id: string,
    @Body(new ZodPipe(setEnabledSchema)) body: { enabled: boolean },
  ): Promise<RulesetInfo> {
    return this.rulesets.setEnabled(who(a), id, body.enabled);
  }

  @Post('rulesets/:id/default')
  @HttpCode(200)
  setDefault(@CurrentAdmin() a: Admin, @Param('id') id: string): Promise<RulesetInfo> {
    return this.rulesets.setDefault(who(a), id);
  }

  @Get('settings')
  getSettings(): PlatformSettings {
    return this.settings.adminView();
  }

  @Patch('settings')
  updateSettings(
    @CurrentAdmin() a: Admin,
    @Body(new ZodPipe(updateSettingsSchema)) body: { allowGodMode?: boolean; maxBatterySize?: number },
  ): Promise<PlatformSettings> {
    return this.settings.update(who(a), body);
  }

  @Get('audit')
  auditLog(): Promise<AuditEntry[]> {
    return this.audit.list();
  }

  @Get('lobbies')
  allLobbies(@CurrentAdmin() a: Admin): LobbySummary[] {
    return this.lobbies.list({ role: 'admin', username: a.username });
  }
}

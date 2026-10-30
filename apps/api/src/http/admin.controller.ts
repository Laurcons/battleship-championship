import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post } from '@nestjs/common';
import {
  ApiError,
  participantNameSchema,
  participantPatchSchema,
  rulesetSchema,
  setEnabledSchema,
  updateSettingsSchema,
  type AdminParticipant,
  type AuditEntry,
  type ConnectionRecord,
  type LobbySummary,
  type ParticipantActivity,
  type PlatformSettings,
  type RulesetInfo,
  type TokenMonitor,
} from '@bsc/api-contract';
import type { Ruleset } from '@bsc/engine';
import { AccountsService, type AdminParticipantBase } from '../platform/accounts.service.js';
import { ActivityService } from '../platform/activity.service.js';
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
    @Inject(ActivityService) private readonly activity: ActivityService,
    @Inject(RulesetsService) private readonly rulesets: RulesetsService,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(LobbiesService) private readonly lobbies: LobbiesService,
  ) {}

  /** Adds the connection activity to what the accounts know about a participant. */
  private withActivity(p: AdminParticipantBase, summaries = this.activity.summaries()): AdminParticipant {
    return { ...p, activity: summaries.get(p.id) ?? this.activity.emptySummary() };
  }

  @Get('participants')
  participants(): AdminParticipant[] {
    const summaries = this.activity.summaries();
    return this.accounts.adminList().map((p) => this.withActivity(p, summaries));
  }

  @Post('participants')
  @HttpCode(201)
  async createParticipant(@CurrentAdmin() a: Admin, @Body(new ZodPipe(participantNameSchema)) body: { name: string }): Promise<AdminParticipant> {
    return this.withActivity(await this.accounts.create(who(a), body.name));
  }

  @Patch('participants/:id')
  async patchParticipant(
    @CurrentAdmin() a: Admin,
    @Param('id') id: string,
    @Body(new ZodPipe(participantPatchSchema)) body: { name?: string; allowInsecure?: boolean },
  ): Promise<AdminParticipant> {
    let result: AdminParticipantBase | undefined;
    if (body.name !== undefined) result = await this.accounts.rename(who(a), id, body.name);
    if (body.allowInsecure !== undefined) result = await this.accounts.setAllowInsecure(who(a), id, body.allowInsecure);
    return this.withActivity(result as AdminParticipantBase);
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
  async resetToken(@CurrentAdmin() a: Admin, @Param('id') id: string): Promise<AdminParticipant> {
    return this.withActivity(await this.accounts.resetToken(who(a), id));
  }

  // --- how tokens are being used -------------------------------------------------------------

  @Get('token-activity')
  tokenMonitor(): TokenMonitor {
    return this.activity.monitor();
  }

  @Get('token-activity/connections')
  recentConnections(): ConnectionRecord[] {
    return this.activity.recent();
  }

  @Get('participants/:id/activity')
  participantActivity(@Param('id') id: string): ParticipantActivity {
    if (!this.accounts.get(id)) throw new ApiError('not_found', 'Participant not found.');
    return this.activity.detail(id);
  }

  @Post('participants/:id/activity/review')
  @HttpCode(200)
  async reviewActivity(@CurrentAdmin() a: Admin, @Param('id') id: string): Promise<AdminParticipant> {
    return this.withActivity(await this.accounts.reviewActivity(who(a), id));
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

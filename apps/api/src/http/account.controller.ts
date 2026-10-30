import { Controller, Get, HttpCode, Inject, Post } from '@nestjs/common';
import type { MyToken, ParticipantRef, PlatformInfo, RulesetInfo } from '@bsc/api-contract';
import { AccountsService } from '../platform/accounts.service.js';
import type { Viewer } from '../platform/policy.js';
import { RulesetsService } from '../platform/rulesets.service.js';
import { SettingsService } from '../platform/settings.service.js';
import { Access, CurrentParticipant, OptionalViewer } from './context.js';

@Controller('api')
export class AccountController {
  constructor(
    @Inject(AccountsService) private readonly accounts: AccountsService,
    @Inject(RulesetsService) private readonly rulesets: RulesetsService,
    @Inject(SettingsService) private readonly settings: SettingsService,
  ) {}

  @Get('me/token')
  @Access('participant')
  token(@CurrentParticipant() me: { participantId: string }): MyToken {
    return this.accounts.tokenInfo(me.participantId);
  }

  @Post('me/token')
  @HttpCode(201)
  @Access('participant')
  createToken(@CurrentParticipant() me: { participantId: string }): Promise<{ token: string }> {
    return this.accounts.createToken(me.participantId);
  }

  @Post('me/token/replace')
  @HttpCode(200)
  @Access('participant')
  replaceToken(@CurrentParticipant() me: { participantId: string }): Promise<{ token: string }> {
    return this.accounts.replaceToken(me.participantId);
  }

  @Post('me/token/notice/ack')
  @HttpCode(204)
  @Access('participant')
  async acknowledge(@CurrentParticipant() me: { participantId: string }): Promise<void> {
    await this.accounts.acknowledgeTokenNotice(me.participantId);
  }

  /** Public: the documentation lists the rulesets for visitors who have not logged in. Lobby counts are admin-only. */
  @Get('rulesets')
  @Access('public')
  listRulesets(@OptionalViewer() viewer: Viewer | undefined): RulesetInfo[] {
    return this.rulesets.list(viewer?.role === 'admin');
  }

  @Get('participants')
  @Access('any')
  listParticipants(): ParticipantRef[] {
    return this.accounts.list();
  }

  @Get('platform')
  @Access('any')
  platform(): PlatformInfo {
    return this.settings.info();
  }
}

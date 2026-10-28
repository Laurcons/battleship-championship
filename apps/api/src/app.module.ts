import { Inject, Injectable, Module, type DynamicModule, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { CONFIG, type Config } from './config.js';
import { AccountController } from './http/account.controller.js';
import { AdminController } from './http/admin.controller.js';
import { AuthController } from './http/auth.controller.js';
import { ApiErrorFilter } from './http/filters.js';
import { AccessGuard } from './http/guards.js';
import { LobbiesController } from './http/lobbies.controller.js';
import { AccountsService } from './platform/accounts.service.js';
import { AuditService } from './platform/audit.service.js';
import { AuthService } from './platform/auth.service.js';
import { LiveHub } from './platform/live-hub.js';
import { LobbiesService } from './platform/lobbies.service.js';
import { RulesetsService } from './platform/rulesets.service.js';
import { RuntimeService } from './platform/runtime/runtime.service.js';
import { SettingsService } from './platform/settings.service.js';
import { CLOCK, systemClock, type Clock } from './platform/util.js';
import { MemoryStore } from './store/memory.js';
import { PrismaStore } from './store/prisma.js';
import { STORE, type Store } from './store/store.js';
import { ProgramGateway } from './ws/program.gateway.js';

/** Loads persisted state in dependency order at startup, and releases resources at shutdown. */
@Injectable()
class BootService implements OnModuleInit, OnApplicationShutdown {
  private purgeTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject(STORE) private readonly store: Store,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(RulesetsService) private readonly rulesets: RulesetsService,
    @Inject(AccountsService) private readonly accounts: AccountsService,
    @Inject(LobbiesService) private readonly lobbies: LobbiesService,
    @Inject(LiveHub) private readonly hub: LiveHub,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(RuntimeService) private readonly runtime: RuntimeService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.store.init();
    await this.settings.init();
    await this.rulesets.init();
    await this.accounts.init();
    await this.lobbies.init();
    this.runtime.init();
    await this.auth.purgeExpired();
    this.purgeTimer = setInterval(() => void this.auth.purgeExpired().catch(() => undefined), 3_600_000);
    this.purgeTimer.unref();
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.purgeTimer) clearInterval(this.purgeTimer);
    this.lobbies.dispose();
    await this.store.close();
  }
}

export interface AppOptions {
  config: Config;
  /** Defaults to MariaDB when `config.databaseUrl` is set, otherwise memory. */
  store?: Store;
  clock?: Clock;
}

@Module({})
export class AppModule {
  static register(options: AppOptions): DynamicModule {
    const { config } = options;
    return {
      module: AppModule,
      controllers: [AuthController, AccountController, AdminController, LobbiesController],
      providers: [
        { provide: CONFIG, useValue: config },
        { provide: CLOCK, useValue: options.clock ?? systemClock },
        {
          provide: STORE,
          useValue: options.store ?? (config.databaseUrl ? new PrismaStore({ databaseUrl: config.databaseUrl }) : new MemoryStore()),
        },
        { provide: APP_GUARD, useClass: AccessGuard },
        { provide: APP_FILTER, useClass: ApiErrorFilter },
        AuditService,
        SettingsService,
        RulesetsService,
        AccountsService,
        AuthService,
        LobbiesService,
        LiveHub,
        RuntimeService,
        ProgramGateway,
        BootService,
      ],
    };
  }
}

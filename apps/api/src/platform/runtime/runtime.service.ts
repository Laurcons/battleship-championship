import { Inject, Injectable, Logger, type BeforeApplicationShutdown } from '@nestjs/common';
import { BOT_KINDS } from '@bsc/bots';
import { emptyHeatmap, type Seat } from '@bsc/engine';
import { ApiError, type LobbySummary } from '@bsc/api-contract';
import { CONFIG, type Config } from '../../config.js';
import { STORE, type SeatOwnerRow, type SeriesRow, type Store } from '../../store/store.js';
import { AccountsService } from '../accounts.service.js';
import { AuditService } from '../audit.service.js';
import type { Lobby } from '../lobby.js';
import { LobbiesService } from '../lobbies.service.js';
import { actorName, canActInLobby, type Viewer } from '../policy.js';
import { SettingsService } from '../settings.service.js';
import { CLOCK, newId, type Clock } from '../util.js';
import { LobbyRuntime, type RuntimeHost } from './lobby-runtime.js';

const SWEEP_INTERVAL_MS = 30_000;

/** Owns the runtime of every lobby, and the actions that start, restart and reset batteries. */
@Injectable()
export class RuntimeService implements BeforeApplicationShutdown {
  private readonly logger = new Logger('runtime');
  private runtimes = new Map<string, LobbyRuntime>();
  private sweeper: ReturnType<typeof setInterval> | null = null;
  private readonly host: RuntimeHost;

  constructor(
    @Inject(STORE) private readonly store: Store,
    @Inject(CONFIG) private readonly config: Config,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(LobbiesService) private readonly lobbies: LobbiesService,
    @Inject(AccountsService) private readonly accounts: AccountsService,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {
    const l = config.limits;
    this.host = {
      now: () => clock.now(),
      limits: { moveMs: l.moveMs, placeMs: l.placeMs, graceMs: l.graceMs, maxStrikes: l.maxStrikes },
      notify: (id, force) => lobbies.notify(id, force),
      touch: (lobby, save) => lobbies.touch(lobby, save),
      recordGame: (game, series) => store.recordGame(game, series),
      saveSeries: (lobby, series) => lobbies.saveSeries(lobby, series),
      log: (level, message) => (level === 'error' ? this.logger.error(message) : this.logger.warn(message)),
      ownerName: (owner) => this.ownerName(owner),
    };
    lobbies.onDelete((lobby) => {
      this.runtimes.get(lobby.id)?.destroy('The lobby was deleted.');
      this.runtimes.delete(lobby.id);
    });
    accounts.onTokenReplaced((participantId, why) =>
      this.dropParticipant(
        participantId,
        why === 'reset' ? 'Token reset by an admin: connection closed (close code 4000).' : 'Token replaced: connection closed (close code 4000).',
      ),
    );
  }

  private ownerName(owner: SeatOwnerRow): string {
    if (owner.kind === 'participant') return this.accounts.nameOf(owner.participantId);
    return `Practice bot: ${BOT_KINDS.find((b) => b.kind === owner.bot)?.label ?? owner.bot}`;
  }

  /** Starts the sweeper and resumes batteries that were running when the platform last stopped. */
  init(): void {
    for (const lobby of this.lobbies.all()) {
      if (lobby.currentSeries()?.status === 'running') this.runtimeFor(lobby).resumeAfterRestart();
    }
    this.sweeper = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS);
    this.sweeper.unref();
  }

  beforeApplicationShutdown(): void {
    if (this.sweeper) clearInterval(this.sweeper);
    for (const rt of this.runtimes.values()) rt.destroy('The platform is shutting down.');
    this.runtimes.clear();
  }

  runtimeFor(lobby: Lobby): LobbyRuntime {
    let rt = this.runtimes.get(lobby.id);
    if (!rt) {
      rt = new LobbyRuntime(lobby, this.host);
      this.runtimes.set(lobby.id, rt);
    }
    return rt;
  }

  /** Closes the programs of idle lobbies, so forgotten lobbies free their connections. */
  sweep(): void {
    for (const lobby of this.lobbies.all()) {
      if (this.lobbies.statusOf(lobby) !== 'expired') continue;
      const rt = this.runtimes.get(lobby.id);
      if (!rt) continue;
      for (const seat of [1, 2] as const) rt.dropSeat(seat, 'The lobby expired after being idle.');
    }
  }

  /** Disconnects every program of a participant (their token was replaced). */
  dropParticipant(participantId: string, reason: string): void {
    for (const lobby of this.lobbies.all()) {
      lobby.row.seats.forEach((owner, i) => {
        if (owner.kind === 'participant' && owner.participantId === participantId) this.runtimes.get(lobby.id)?.dropSeat((i + 1) as Seat, reason);
      });
    }
  }

  // --- actions from the web interface ----------------------------------------------------------

  private actionLobby(viewer: Viewer, lobbyId: string): Lobby {
    const lobby = this.lobbies.getFor(viewer, lobbyId);
    if (!canActInLobby(viewer, lobby)) throw new ApiError('forbidden', 'Only the players of a lobby can do this.');
    return lobby;
  }

  async start(viewer: Viewer, lobbyId: string, games: number): Promise<LobbySummary> {
    const lobby = this.actionLobby(viewer, lobbyId);
    const max = this.settings.maxBatterySize;
    if (!Number.isInteger(games) || games < 1 || games > max) {
      throw new ApiError('validation', `The number of games must be a whole number between 1 and ${max}.`);
    }
    const status = this.lobbies.statusOf(lobby);
    if (status !== 'ready') {
      throw new ApiError('conflict', status === 'waiting' ? 'Not every program is connected yet.' : `The lobby is ${status}.`);
    }
    const series: SeriesRow = {
      id: newId('s'),
      lobbyId: lobby.id,
      target: games,
      played: 0,
      score: { 1: 0, 2: 0 },
      status: 'running',
      abortReason: null,
      startedAt: this.clock.now(),
      endedAt: null,
      heatmap: emptyHeatmap(lobby.ruleset),
    };
    await this.lobbies.saveSeries(lobby, series);
    lobby.series.push(series);
    await this.audit.record(actorName(viewer), 'series_started', lobby.id, `${games} game${games === 1 ? '' : 's'}`);
    this.runtimeFor(lobby).startLoop();
    this.lobbies.notify(lobby.id, true);
    return this.lobbies.summary(lobby, viewer);
  }

  async restartGame(viewer: Viewer, lobbyId: string): Promise<LobbySummary> {
    const lobby = this.actionLobby(viewer, lobbyId);
    const rt = this.runtimeFor(lobby);
    if (!rt.isRunning()) throw new ApiError('conflict', 'No battery is running.');
    rt.restartGame();
    this.lobbies.touch(lobby);
    await this.audit.record(actorName(viewer), 'game_restarted', lobby.id);
    this.lobbies.notify(lobby.id, true);
    return this.lobbies.summary(lobby, viewer);
  }

  async resetSeries(viewer: Viewer, lobbyId: string): Promise<LobbySummary> {
    const lobby = this.actionLobby(viewer, lobbyId);
    const series = lobby.currentSeries();
    if (!series) throw new ApiError('conflict', 'There are no results to reset.');
    await this.runtimeFor(lobby).stopSeries();
    await this.lobbies.removeSeries(lobby, series.id);
    this.lobbies.touch(lobby, true);
    await this.audit.record(actorName(viewer), 'series_reset', lobby.id);
    this.lobbies.notify(lobby.id, true);
    return this.lobbies.summary(lobby, viewer);
  }
}

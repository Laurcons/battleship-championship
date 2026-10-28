import { BOT_KINDS } from '@bsc/bots';
import { aggregateSeries, redactEvents, type GameEvent, type Seat } from '@bsc/engine';
import { generateLobbyCode } from '@bsc/protocol';
import { Inject, Injectable } from '@nestjs/common';
import {
  ApiError,
  type Frame,
  type GameDetail,
  type GameListItem,
  type LiveUpdate,
  type LobbyStatus,
  type LobbySummary,
  type OpponentChoice,
  type SeatInfo,
  type SeatOwner,
  type SeriesInfo,
  type SeriesReport,
} from '@bsc/api-contract';
import { CONFIG, type Config } from '../config.js';
import { STORE, type GameMeta, type LobbyRow, type SeatOwnerRow, type SeriesRow, type Store } from '../store/store.js';
import { AccountsService } from './accounts.service.js';
import { AuditService } from './audit.service.js';
import { Lobby } from './lobby.js';
import {
  actorName,
  canAccessLobby,
  canDeleteLobby,
  canReadFrames,
  hiddenSeats,
  mySeats,
  viewerMode,
  type Viewer,
} from './policy.js';
import { RulesetsService } from './rulesets.service.js';
import { SettingsService } from './settings.service.js';
import { CLOCK, Mutex, type Clock } from './util.js';

const ACTIVITY_SAVE_INTERVAL_MS = 5_000;

type LobbyListener = (lobbyId: string, force: boolean) => void;

/** The in-memory registry of lobbies, with creation, deletion and every read model of a lobby. */
@Injectable()
export class LobbiesService {
  private lobbies = new Map<string, Lobby>();
  private readonly lock = new Mutex();
  private changeListeners: LobbyListener[] = [];
  private deleteListeners: ((lobby: Lobby) => void)[] = [];
  private activitySaves = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    @Inject(STORE) private readonly store: Store,
    @Inject(CONFIG) private readonly config: Config,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AccountsService) private readonly accounts: AccountsService,
    @Inject(RulesetsService) private readonly rulesets: RulesetsService,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {
    this.rulesets.lobbyCounter = (id) => [...this.lobbies.values()].filter((l) => l.row.rulesetId === id).length;
    this.accounts.lobbyCounter = (id) =>
      [...this.lobbies.values()].filter((l) => l.row.seats.some((s) => s.kind === 'participant' && s.participantId === id)).length;
  }

  async init(): Promise<void> {
    for (const row of await this.store.listLobbies()) {
      const rec = this.rulesets.get(row.rulesetId);
      if (!rec) continue; // cannot happen: rulesets are never deleted
      const lobby = new Lobby(row, rec.ruleset);
      lobby.series = await this.store.listSeries(row.id);
      this.lobbies.set(row.id, lobby);
    }
  }

  // --- registry --------------------------------------------------------------------------------

  onChange(listener: LobbyListener): void {
    this.changeListeners.push(listener);
  }

  onDelete(listener: (lobby: Lobby) => void): void {
    this.deleteListeners.push(listener);
  }

  /** Tells live viewers something changed. */
  notify(lobbyId: string, force = false): void {
    for (const l of this.changeListeners) l(lobbyId, force);
  }

  all(): Lobby[] {
    return [...this.lobbies.values()];
  }

  find(id: string): Lobby | undefined {
    return this.lobbies.get(id);
  }

  /** The lobby if the viewer may see it; everyone else gets the same "not found". */
  getFor(viewer: Viewer, id: string): Lobby {
    const lobby = this.lobbies.get(id);
    if (!lobby || !canAccessLobby(viewer, lobby)) throw new ApiError('not_found', 'Lobby not found.');
    return lobby;
  }

  /** Records activity. The row is saved at most every few seconds, and always when forced. */
  touch(lobby: Lobby, save = false): void {
    lobby.row = { ...lobby.row, lastActivityAt: this.clock.now() };
    if (save) {
      const timer = this.activitySaves.get(lobby.id);
      if (timer) clearTimeout(timer);
      this.activitySaves.delete(lobby.id);
      void this.store.saveLobby(lobby.row).catch(() => undefined);
      return;
    }
    if (this.activitySaves.has(lobby.id)) return;
    this.activitySaves.set(
      lobby.id,
      setTimeout(() => {
        this.activitySaves.delete(lobby.id);
        if (this.lobbies.has(lobby.id)) void this.store.saveLobby(lobby.row).catch(() => undefined);
      }, ACTIVITY_SAVE_INTERVAL_MS),
    );
  }

  /** Stops pending timers (shutdown, tests). */
  dispose(): void {
    for (const timer of this.activitySaves.values()) clearTimeout(timer);
    this.activitySaves.clear();
  }

  // --- status and read models ------------------------------------------------------------------

  statusOf(lobby: Lobby): LobbyStatus {
    const series = lobby.currentSeries();
    const allConnected = lobby.seats.every((s) => s.connection === 'connected');
    if (series?.status === 'running') return allConnected ? 'running' : 'paused';
    if (this.clock.now() - lobby.row.lastActivityAt > this.config.limits.idleExpiryMs) return 'expired';
    return allConnected ? 'ready' : 'waiting';
  }

  private ownerOf(row: SeatOwnerRow): SeatOwner {
    if (row.kind === 'bot') {
      const meta = BOT_KINDS.find((b) => b.kind === row.bot);
      return { kind: 'bot', bot: row.bot, name: `Practice bot: ${meta?.label ?? row.bot}` };
    }
    return { kind: 'participant', participantId: row.participantId, name: this.accounts.nameOf(row.participantId) };
  }

  private seatInfo(lobby: Lobby, seat: Seat): SeatInfo {
    const s = lobby.seats[seat - 1] as Lobby['seats'][number];
    return {
      seat,
      owner: this.ownerOf(lobby.row.seats[seat - 1] as SeatOwnerRow),
      connection: s.connection,
      program: s.program,
      graceEndsAt: s.graceEndsAt,
      latencyMs: s.latencyMs,
      lastSeenAt: s.lastSeenAt,
    };
  }

  seriesInfo(series: SeriesRow): SeriesInfo {
    const elapsed = this.clock.now() - series.startedAt;
    return {
      id: series.id,
      target: series.target,
      played: series.played,
      score: { ...series.score },
      status: series.status,
      abortReason: series.abortReason,
      startedAt: series.startedAt,
      endedAt: series.endedAt,
      etaMs: series.status === 'running' && series.played > 0 ? (elapsed / series.played) * (series.target - series.played) : null,
    };
  }

  summary(lobby: Lobby, viewer: Viewer): LobbySummary {
    const status = this.statusOf(lobby);
    const seats = mySeats(viewer, lobby);
    const series = lobby.currentSeries();
    return {
      id: lobby.id,
      rulesetId: lobby.row.rulesetId,
      ruleset: lobby.ruleset,
      godMode: lobby.row.godMode,
      stopOnInfraction: lobby.row.stopOnInfraction,
      viewerMode: viewerMode(viewer, lobby),
      createdAt: lobby.row.createdAt,
      createdBy: this.accounts.ref(lobby.row.createdBy),
      seats: [this.seatInfo(lobby, 1), this.seatInfo(lobby, 2)],
      mySeats: seats,
      status,
      series: series ? this.seriesInfo(series) : null,
      lastActivityAt: lobby.row.lastActivityAt,
      expiresAt: lobby.row.lastActivityAt + this.config.limits.idleExpiryMs,
      canStart: status === 'ready' && seats.length > 0,
    };
  }

  list(viewer: Viewer): LobbySummary[] {
    return this.all()
      .filter((l) => canAccessLobby(viewer, l))
      .map((l) => this.summary(l, viewer))
      .sort((a, b) => b.lastActivityAt - a.lastActivityAt);
  }

  private listItem(lobby: Lobby, meta: GameMeta): GameListItem {
    return {
      id: meta.id,
      seriesId: meta.seriesId,
      index: meta.index,
      first: meta.first,
      status: meta.status,
      winner: meta.winner,
      reason: meta.reason as GameListItem['reason'],
      shots: meta.shots,
      infractions: meta.infractions,
      startedAt: meta.startedAt,
      durationMs: meta.endedAt - meta.startedAt,
    };
  }

  private liveItem(lobby: Lobby): GameListItem | null {
    const live = lobby.live;
    if (!live) return null;
    const infractions = (seat: Seat) => live.events.filter((e) => e.type === 'infraction' && e.seat === seat).length;
    return {
      id: live.id,
      seriesId: live.seriesId,
      index: live.index,
      first: live.first,
      status: 'live',
      winner: null,
      reason: null,
      shots: { 1: live.state.shots[1].length, 2: live.state.shots[2].length },
      infractions: { 1: infractions(1), 2: infractions(2) },
      startedAt: live.startedAt,
      durationMs: this.clock.now() - live.startedAt,
    };
  }

  async listGames(viewer: Viewer, lobbyId: string, seriesId?: string): Promise<GameListItem[]> {
    const lobby = this.getFor(viewer, lobbyId);
    const id = seriesId ?? lobby.currentSeries()?.id;
    if (!id || !lobby.series.some((s) => s.id === id)) return [];
    const items = (await this.store.listGames(id)).map((m) => this.listItem(lobby, m));
    const live = this.liveItem(lobby);
    if (live && live.seriesId === id) items.push(live);
    return items.sort((a, b) => a.index - b.index || a.startedAt - b.startedAt);
  }

  private detail(lobby: Lobby, viewer: Viewer, item: GameListItem, rawEvents: GameEvent[], times: number[]): GameDetail {
    const mode = viewerMode(viewer, lobby);
    const finished = item.status === 'over';
    const hidden = hiddenSeats(viewer, lobby, finished);
    return {
      ...item,
      viewerMode: mode,
      rules: lobby.ruleset,
      events: redactEvents(lobby.ruleset, rawEvents, hidden, mode === 'god' || finished),
      eventTimes: [...times],
    };
  }

  async getGame(viewer: Viewer, lobbyId: string, gameId: string): Promise<GameDetail> {
    const lobby = this.getFor(viewer, lobbyId);
    if (lobby.live?.id === gameId) return this.liveDetail(lobby, viewer) as GameDetail;
    const row = await this.store.getGame(lobby.id, gameId);
    if (!row) throw new ApiError('not_found', 'Game not found.');
    return this.detail(lobby, viewer, this.listItem(lobby, row), row.events, row.times);
  }

  private liveDetail(lobby: Lobby, viewer: Viewer): GameDetail | null {
    const item = this.liveItem(lobby);
    return item && lobby.live ? this.detail(lobby, viewer, item, lobby.live.events, lobby.live.times) : null;
  }

  /** What a live viewer is sent: the lobby, and the live game (or the last finished one of the series). */
  async liveUpdate(lobby: Lobby, viewer: Viewer): Promise<LiveUpdate> {
    const live = this.liveDetail(lobby, viewer);
    if (live) return { lobby: this.summary(lobby, viewer), game: live };
    const series = lobby.currentSeries();
    let game: GameDetail | null = null;
    if (series) {
      const finished = (await this.store.listGames(series.id)).filter((g) => g.status === 'over').at(-1);
      if (finished) {
        const row = await this.store.getGame(lobby.id, finished.id);
        if (row) game = this.detail(lobby, viewer, this.listItem(lobby, row), row.events, row.times);
      }
    }
    return { lobby: this.summary(lobby, viewer), game };
  }

  listSeries(viewer: Viewer, lobbyId: string): SeriesInfo[] {
    return this.getFor(viewer, lobbyId).series.map((s) => this.seriesInfo(s));
  }

  async getSeriesReport(viewer: Viewer, lobbyId: string, seriesId?: string): Promise<SeriesReport | null> {
    const lobby = this.getFor(viewer, lobbyId);
    const series = seriesId ? lobby.series.find((s) => s.id === seriesId) : lobby.currentSeries();
    if (!series) return null;
    const summaries = await this.store.listSummaries(series.id);
    return {
      seriesId: series.id,
      info: this.seriesInfo(series),
      stats: aggregateSeries(summaries, lobby.ruleset),
      heatmap: series.heatmap,
    };
  }

  getFrameLog(viewer: Viewer, lobbyId: string, seat: Seat): Frame[] {
    const lobby = this.getFor(viewer, lobbyId);
    if (lobby.row.seats[seat - 1]?.kind !== 'participant') throw new ApiError('not_found', 'No program on that seat.');
    if (!canReadFrames(viewer, lobby, seat)) throw new ApiError('forbidden', "You can only read your own programs' frame logs.");
    return lobby.seats[seat - 1]?.frames.list() ?? [];
  }

  // --- create and delete -----------------------------------------------------------------------

  create(viewer: Viewer, input: { opponent: OpponentChoice; rulesetId: string; godMode?: boolean; stopOnInfraction?: boolean }): Promise<LobbySummary> {
    return this.lock.run(async () => {
      if (viewer.role !== 'participant') throw new ApiError('forbidden', 'Only participants can create lobbies.');
      const rec = this.rulesets.get(input.rulesetId);
      if (!rec) throw new ApiError('validation', 'Unknown ruleset.');
      if (!rec.enabled) throw new ApiError('conflict', `Ruleset "${input.rulesetId}" is disabled.`);
      const open = this.all().filter((l) => l.row.createdBy === viewer.participantId && this.statusOf(l) !== 'expired').length;
      const max = this.config.limits.maxOpenLobbies;
      if (open >= max) {
        throw new ApiError('conflict', `You already have ${open} open lobbies (the limit is ${max}). Delete one first.`);
      }
      let second: SeatOwnerRow;
      if (input.opponent.kind === 'participant') {
        if (!this.accounts.get(input.opponent.participantId)) throw new ApiError('validation', 'Unknown opponent.');
        second = { kind: 'participant', participantId: input.opponent.participantId };
      } else {
        if (!BOT_KINDS.some((b) => b.kind === (input.opponent as { bot: string }).bot)) {
          throw new ApiError('validation', 'Unknown practice bot.');
        }
        second = { kind: 'bot', bot: input.opponent.bot };
      }
      const selfPlay = second.kind === 'participant' && second.participantId === viewer.participantId;
      // God mode is the creator's choice. Against yourself or a bot there is nobody to protect, so it is always on.
      const forced = selfPlay || second.kind === 'bot';
      const requested = input.godMode ?? true;
      if (!forced && requested && !this.settings.allowGodMode) {
        throw new ApiError('conflict', 'The admin has turned god mode off for new lobbies between participants. Create the lobby without it.');
      }
      const now = this.clock.now();
      const row: LobbyRow = {
        id: this.uniqueCode(),
        rulesetId: rec.ruleset.id,
        godMode: forced || requested,
        stopOnInfraction: input.stopOnInfraction ?? false,
        createdBy: viewer.participantId,
        seats: [{ kind: 'participant', participantId: viewer.participantId }, second],
        createdAt: now,
        lastActivityAt: now,
      };
      await this.store.saveLobby(row);
      const lobby = new Lobby(row, rec.ruleset);
      this.lobbies.set(row.id, lobby);
      await this.audit.record(viewer.name, 'lobby_created', row.id, `ruleset ${row.rulesetId}, vs ${this.ownerOf(second).name}`);
      return this.summary(lobby, viewer);
    });
  }

  private uniqueCode(): string {
    for (;;) {
      const code = generateLobbyCode();
      if (!this.lobbies.has(code)) return code;
    }
  }

  delete(viewer: Viewer, id: string): Promise<void> {
    return this.lock.run(async () => {
      const lobby = this.getFor(viewer, id);
      if (!canDeleteLobby(viewer, lobby)) throw new ApiError('forbidden', 'You cannot delete this lobby.');
      this.lobbies.delete(id);
      const timer = this.activitySaves.get(id);
      if (timer) clearTimeout(timer);
      this.activitySaves.delete(id);
      for (const l of this.deleteListeners) l(lobby);
      await this.store.deleteLobby(id);
      await this.audit.record(actorName(viewer), 'lobby_deleted', id);
    });
  }

  // --- series and games, written by the runtime ------------------------------------------------

  async saveSeries(lobby: Lobby, series: SeriesRow): Promise<void> {
    await this.store.saveSeries(series);
    this.touch(lobby, true);
  }

  async removeSeries(lobby: Lobby, seriesId: string): Promise<void> {
    lobby.series = lobby.series.filter((s) => s.id !== seriesId);
    await this.store.deleteSeries(seriesId);
  }
}

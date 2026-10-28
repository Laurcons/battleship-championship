import { BOT_KINDS } from '@bsc/bots';
import {
  aggregateSeries,
  emptyHeatmap,
  redactEvents,
  validateRuleset,
  type Ruleset,
  type Seat,
} from '@bsc/engine';
import {
  ApiError,
  type AdminParticipant,
  type AuditEntry,
  type Frame,
  type GameDetail,
  type GameListItem,
  type LiveUpdate,
  type LobbyStatus,
  type LobbySummary,
  type MyToken,
  type OpponentChoice,
  type ParticipantRef,
  type PlatformInfo,
  type PlatformSettings,
  type RulesetInfo,
  type SeatInfo,
  type SeriesInfo,
  type SeriesReport,
  type Session,
  type ViewerMode,
} from '../api/types';
import { generateLobbyCode, toWireRuleset } from '@bsc/protocol';
import { buildFrames } from './frames';
import { newToken } from './util';
import { LobbyRunner, type RunnerHost, type Speed } from './runner';
import { createSeedState } from './seed';
import {
  addNote,
  PLATFORM_CONSTANTS,
  type GameRec,
  type LobbyRec,
  type MockState,
  type ParticipantRec,
  type SeatRec,
  type SeriesRec,
  type SimProfile,
} from './state';

export interface Persistence {
  load(): MockState | null;
  save(state: MockState): void;
  clear(): void;
}

export interface SessionStore {
  load(): Session | null;
  save(session: Session | null): void;
}

export const memoryPersistence = (): Persistence => {
  let saved: string | null = null;
  return {
    load: () => (saved ? (JSON.parse(saved) as MockState) : null),
    save: (state) => void (saved = JSON.stringify(state)),
    clear: () => void (saved = null),
  };
};

interface Subscriber {
  session: Session;
  callback: (update: LiveUpdate) => void;
}

const EMIT_INTERVAL_MS = 80;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 5;

export class MockServer implements RunnerHost {
  state: MockState;
  session: Session | null;
  private gatePassed = false;
  private failures: number[] = [];
  private runners = new Map<string, LobbyRunner>();
  private subscribers = new Map<string, Set<Subscriber>>();
  private emitTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private lastEmit = new Map<string, number>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private speedSetting: Speed = 'fast';

  constructor(
    private persistence: Persistence,
    private sessionStore: SessionStore = { load: () => null, save: () => undefined },
  ) {
    this.state = persistence.load() ?? createSeedState(Date.now());
    this.session = sessionStore.load();
    this.migrateSavedState();
    this.ensureDefaultRuleset();
    this.recoverAfterRestart(false);
    this.persistNow();
  }

  /** State saved by earlier versions: fill in what was added since. */
  private migrateSavedState(): void {
    const settings = this.state.settings as unknown as Record<string, unknown>;
    if (settings.allowGodMode === undefined) settings.allowGodMode = true; // it was the admin's "godModeDefault"
    delete settings.godModeDefault;
  }

  /** State saved before the admin could choose a default: fall back to the newest enabled ruleset. */
  private ensureDefaultRuleset(): void {
    const current = this.state.rulesets.find((r) => r.ruleset.id === this.state.settings.defaultRulesetId);
    if (current?.enabled) return;
    const fallback = [...this.state.rulesets].filter((r) => r.enabled).sort((a, b) => b.createdAt - a.createdAt)[0];
    if (fallback) this.state.settings.defaultRulesetId = fallback.ruleset.id;
  }

  // ---------------------------------------------------------------- RunnerHost

  now(): number {
    return Date.now();
  }

  speed(): Speed {
    return this.speedSetting;
  }

  nextId(prefix: string): string {
    this.state.counter++;
    return `${prefix}_${this.state.counter.toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  }

  changed(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.persistNow();
    }, 400);
  }

  /** Writes any pending change immediately (the page is about to go away). */
  flushSave(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.persistNow();
  }

  private persistNow(): void {
    try {
      this.persistence.save(this.state);
    } catch {
      // storage full or unavailable: the mock keeps working from memory
    }
  }

  emit(lobbyId: string, force = false): void {
    const now = this.now();
    const last = this.lastEmit.get(lobbyId) ?? 0;
    if (force || now - last >= EMIT_INTERVAL_MS) {
      this.flush(lobbyId);
      return;
    }
    if (!this.emitTimers.has(lobbyId)) {
      this.emitTimers.set(
        lobbyId,
        setTimeout(() => this.flush(lobbyId), EMIT_INTERVAL_MS - (now - last)),
      );
    }
  }

  private flush(lobbyId: string): void {
    const timer = this.emitTimers.get(lobbyId);
    if (timer) clearTimeout(timer);
    this.emitTimers.delete(lobbyId);
    this.lastEmit.set(lobbyId, this.now());
    const lobby = this.state.lobbies.find((l) => l.id === lobbyId);
    const subs = this.subscribers.get(lobbyId);
    if (!lobby || !subs) return;
    for (const sub of subs) {
      try {
        sub.callback(this.liveUpdate(lobby, sub.session));
      } catch {
        // a subscriber that no longer has access simply stops receiving updates
      }
    }
  }

  // ------------------------------------------------------------------ helpers

  private audit(actor: string, action: string, target: string | null = null, detail: string | null = null): void {
    const entry: AuditEntry = { id: this.nextId('a'), at: this.now(), actor, action, target, detail };
    this.state.audit.push(entry);
    if (this.state.audit.length > 500) this.state.audit.splice(0, this.state.audit.length - 500);
    this.changed();
  }

  private actorName(session: Session): string {
    return session.role === 'admin' ? `admin:${session.username}` : session.name;
  }

  private requireSession(): Session {
    if (!this.session) throw new ApiError('unauthenticated', 'You are not logged in.');
    return this.session;
  }

  private requireParticipant(): Extract<Session, { role: 'participant' }> {
    const session = this.requireSession();
    if (session.role !== 'participant') throw new ApiError('forbidden', 'Only participants can do this.');
    return session;
  }

  private requireAdmin(): Extract<Session, { role: 'admin' }> {
    const session = this.requireSession();
    if (session.role !== 'admin') throw new ApiError('forbidden', 'Only the admin can do this.');
    return session;
  }

  private participant(id: string): ParticipantRec | undefined {
    return this.state.participants.find((p) => p.id === id);
  }

  private ref(id: string): ParticipantRef {
    const p = this.participant(id);
    return { id, name: p?.name ?? '(deleted)' };
  }

  private ownsSeat(session: Session, seat: SeatRec): boolean {
    return session.role === 'participant' && seat.owner.kind === 'participant' && seat.owner.participantId === session.participantId;
  }

  /** Lobbies are visible to their participants and to the admin; everyone else gets "not found". */
  private lobbyFor(id: string, session: Session = this.requireSession()): LobbyRec {
    const lobby = this.state.lobbies.find((l) => l.id === id);
    const allowed = lobby && (session.role === 'admin' || lobby.seats.some((s) => this.ownsSeat(session, s)));
    if (!lobby || !allowed) throw new ApiError('not_found', 'Lobby not found.');
    return lobby;
  }

  private runner(lobby: LobbyRec): LobbyRunner {
    let runner = this.runners.get(lobby.id);
    if (!runner) {
      runner = new LobbyRunner(lobby, this);
      this.runners.set(lobby.id, runner);
    }
    return runner;
  }

  private statusOf(lobby: LobbyRec): LobbyStatus {
    const series = lobby.seriesList.at(-1);
    if (series?.status === 'running') {
      return lobby.seats.every((s) => s.connection === 'connected') ? 'running' : 'paused';
    }
    if (this.now() - lobby.lastActivityAt > PLATFORM_CONSTANTS.idleExpiryMs) return 'expired';
    return lobby.seats.every((s) => s.connection === 'connected') ? 'ready' : 'waiting';
  }

  private viewerMode(lobby: LobbyRec, session: Session): ViewerMode {
    return session.role === 'admin' || lobby.godMode ? 'god' : 'restricted';
  }

  private seriesInfo(series: SeriesRec): SeriesInfo {
    const elapsed = this.now() - series.startedAt;
    return {
      id: series.id,
      target: series.target,
      played: series.played,
      score: { ...series.score },
      status: series.status,
      abortReason: series.abortReason,
      startedAt: series.startedAt,
      endedAt: series.endedAt,
      etaMs:
        series.status === 'running' && series.played > 0
          ? (elapsed / series.played) * (series.target - series.played)
          : null,
    };
  }

  private seatInfo(seat: SeatRec): SeatInfo {
    return {
      seat: seat.seat,
      owner: seat.owner,
      connection: seat.connection,
      program: seat.program,
      graceEndsAt: seat.graceEndsAt,
      latencyMs: seat.latencyMs,
      lastSeenAt: seat.lastSeenAt,
    };
  }

  private summary(lobby: LobbyRec, session: Session): LobbySummary {
    const status = this.statusOf(lobby);
    const mySeats = lobby.seats.filter((s) => this.ownsSeat(session, s)).map((s) => s.seat);
    const series = lobby.seriesList.at(-1);
    return {
      id: lobby.id,
      rulesetId: lobby.rulesetId,
      ruleset: lobby.ruleset,
      godMode: lobby.godMode,
      viewerMode: this.viewerMode(lobby, session),
      createdAt: lobby.createdAt,
      createdBy: this.ref(lobby.createdBy),
      seats: [this.seatInfo(lobby.seats[0]), this.seatInfo(lobby.seats[1])],
      mySeats,
      status,
      series: series ? this.seriesInfo(series) : null,
      lastActivityAt: lobby.lastActivityAt,
      expiresAt: lobby.lastActivityAt + PLATFORM_CONSTANTS.idleExpiryMs,
      canStart: status === 'ready' && mySeats.length > 0,
    };
  }

  private gameListItem(lobby: LobbyRec, game: GameRec): GameListItem {
    const live = this.runners.get(lobby.id)?.liveGame();
    const isLive = live?.rec === game;
    const summary = game.summary;
    const shots = isLive && live
      ? { 1: live.state.shots[1].length, 2: live.state.shots[2].length }
      : (summary?.shots ?? { 1: 0, 2: 0 });
    const infractions = summary?.infractions ?? {
      1: (game.events ?? []).filter((e) => e.type === 'infraction' && e.seat === 1).length,
      2: (game.events ?? []).filter((e) => e.type === 'infraction' && e.seat === 2).length,
    };
    return {
      id: game.id,
      seriesId: game.seriesId,
      index: game.index,
      first: game.first,
      status: isLive ? 'live' : game.status === 'live' ? 'void' : game.status,
      winner: game.winner,
      reason: game.reason,
      shots,
      infractions,
      startedAt: game.startedAt,
      durationMs: (game.endedAt ?? this.now()) - game.startedAt,
    };
  }

  private gameDetail(lobby: LobbyRec, game: GameRec, session: Session): GameDetail {
    if (!game.events) {
      throw new ApiError('not_found', 'The mock only keeps the event log of the most recent 30 games.');
    }
    const mode = this.viewerMode(lobby, session);
    const finished = game.status === 'over';
    const hidden: Seat[] =
      mode === 'god' || finished ? [] : lobby.seats.filter((s) => !this.ownsSeat(session, s)).map((s) => s.seat);
    const events = redactEvents(lobby.ruleset, game.events, hidden, mode === 'god' || finished);
    return {
      ...this.gameListItem(lobby, game),
      viewerMode: mode,
      rules: lobby.ruleset,
      events,
      eventTimes: [...game.times],
    };
  }

  private liveUpdate(lobby: LobbyRec, session: Session): LiveUpdate {
    const live = this.runners.get(lobby.id)?.liveGame();
    const series = lobby.seriesList.at(-1);
    const shown =
      live?.rec ??
      [...lobby.games].reverse().find((g) => g.status === 'over' && g.seriesId === series?.id && g.events !== null);
    return {
      lobby: this.summary(lobby, session),
      game: shown ? this.gameDetail(lobby, shown, session) : null,
    };
  }

  private bumpActivity(lobby: LobbyRec): void {
    lobby.lastActivityAt = this.now();
    this.changed();
  }

  // ------------------------------------------------------------------ session

  getSession(): Session | null {
    return this.session;
  }

  private checkRateLimit(): void {
    const now = this.now();
    this.failures = this.failures.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
    if (this.failures.length >= RATE_LIMIT_MAX) {
      const retryAfterSec = Math.ceil((RATE_LIMIT_WINDOW_MS - (now - (this.failures[0] as number))) / 1000);
      throw new ApiError('rate_limited', `Too many failed attempts. Try again in ${retryAfterSec} s.`, { retryAfterSec });
    }
  }

  verifySharedPassword(password: string): ParticipantRef[] {
    this.checkRateLimit();
    if (password !== this.state.sharedPassword) {
      this.failures.push(this.now());
      throw new ApiError('invalid_credentials', 'Wrong password.');
    }
    this.gatePassed = true;
    return [...this.state.participants]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((p) => ({ id: p.id, name: p.name }));
  }

  loginParticipant(participantId: string): Session {
    if (!this.gatePassed) throw new ApiError('unauthenticated', 'Enter the shared password first.');
    const p = this.participant(participantId);
    if (!p) throw new ApiError('not_found', 'Unknown participant.');
    this.setSession({ role: 'participant', participantId: p.id, name: p.name });
    this.audit(p.name, 'login');
    return this.session as Session;
  }

  loginAdmin(username: string, password: string): Session {
    this.checkRateLimit();
    const { admin } = this.state;
    if (username !== admin.username || password !== admin.password) {
      this.failures.push(this.now());
      throw new ApiError('invalid_credentials', 'Wrong username or password.');
    }
    this.setSession({ role: 'admin', username });
    this.audit(`admin:${username}`, 'login');
    return this.session as Session;
  }

  logout(): void {
    this.setSession(null);
    this.gatePassed = false;
  }

  setSession(session: Session | null): void {
    this.session = session;
    this.sessionStore.save(session);
  }

  // ------------------------------------------------------------------ account

  getMyToken(): MyToken {
    const session = this.requireParticipant();
    const p = this.participant(session.participantId) as ParticipantRec;
    return {
      exists: p.token !== null,
      preview: p.token ? `bsc_••••••••${p.token.slice(-4)}` : null,
      createdAt: p.tokenCreatedAt,
      replaced: p.tokenReplaced,
      notice: p.tokenNotice,
    };
  }

  createToken(): { token: string } {
    const session = this.requireParticipant();
    const p = this.participant(session.participantId) as ParticipantRec;
    if (p.token) throw new ApiError('conflict', 'You already have a token. Replace it instead.');
    p.token = newToken();
    p.tokenCreatedAt = this.now();
    p.tokenReplaced = false;
    this.audit(p.name, 'token_created');
    return { token: p.token };
  }

  replaceToken(): { token: string } {
    const session = this.requireParticipant();
    const p = this.participant(session.participantId) as ParticipantRec;
    if (!p.token) throw new ApiError('conflict', "You don't have a token yet. Create one first.");
    p.token = newToken();
    p.tokenCreatedAt = this.now();
    p.tokenReplaced = true;
    p.tokenNotice = null;
    this.dropConnections(p.id, 'Token replaced: connection closed (close code 4000).');
    this.audit(p.name, 'token_replaced');
    return { token: p.token };
  }

  acknowledgeTokenNotice(): void {
    const session = this.requireParticipant();
    const p = this.participant(session.participantId) as ParticipantRec;
    p.tokenNotice = null;
    this.changed();
  }

  private dropConnections(participantId: string, note: string): void {
    for (const lobby of this.state.lobbies) {
      for (const seat of lobby.seats) {
        if (seat.owner.kind !== 'participant' || seat.owner.participantId !== participantId) continue;
        if (seat.connection === 'disconnected') continue;
        this.disconnectSeat(lobby, seat, note);
      }
    }
  }

  // --------------------------------------------------------- shared read data

  /** The default first, then the other enabled rulesets (newest first), then the disabled ones (newest first). */
  listRulesets(): RulesetInfo[] {
    const session = this.requireSession();
    const defaultId = this.state.settings.defaultRulesetId;
    const rank = (r: { enabled: boolean; ruleset: Ruleset }) => (r.ruleset.id === defaultId ? 0 : r.enabled ? 1 : 2);
    return [...this.state.rulesets]
      .sort((a, b) => rank(a) - rank(b) || b.createdAt - a.createdAt)
      .map((r) => ({
        ruleset: r.ruleset,
        enabled: r.enabled,
        createdAt: r.createdAt,
        lobbyCount: session.role === 'admin' ? this.state.lobbies.filter((l) => l.rulesetId === r.ruleset.id).length : null,
        isDefault: r.ruleset.id === defaultId,
      }));
  }

  listParticipants(): ParticipantRef[] {
    this.requireSession();
    return this.state.participants.map((p) => ({ id: p.id, name: p.name })).sort((a, b) => a.name.localeCompare(b.name));
  }

  getPlatformInfo(): PlatformInfo {
    this.requireSession();
    const c = PLATFORM_CONSTANTS;
    return {
      allowGodMode: this.state.settings.allowGodMode,
      maxBatterySize: this.state.settings.maxBatterySize,
      limits: { moveMs: c.moveTimeoutMs, placeMs: c.placeTimeoutMs, graceMs: c.graceMs, maxStrikes: c.maxStrikes, idleExpiryMs: c.idleExpiryMs },
    };
  }

  // ------------------------------------------------------------------ lobbies

  listLobbies(): LobbySummary[] {
    const session = this.requireSession();
    return this.state.lobbies
      .filter((l) => session.role === 'admin' || l.seats.some((s) => this.ownsSeat(session, s)))
      .map((l) => this.summary(l, session))
      .sort((a, b) => b.lastActivityAt - a.lastActivityAt);
  }

  getLobby(id: string): LobbySummary {
    const session = this.requireSession();
    return this.summary(this.lobbyFor(id, session), session);
  }

  createLobby(input: { opponent: OpponentChoice; rulesetId: string; godMode?: boolean }): LobbySummary {
    const session = this.requireParticipant();
    const rulesetRec = this.state.rulesets.find((r) => r.ruleset.id === input.rulesetId);
    if (!rulesetRec) throw new ApiError('validation', 'Unknown ruleset.');
    if (!rulesetRec.enabled) throw new ApiError('conflict', `Ruleset "${input.rulesetId}" is disabled.`);
    const open = this.state.lobbies.filter(
      (l) => l.createdBy === session.participantId && this.statusOf(l) !== 'expired',
    ).length;
    if (open >= PLATFORM_CONSTANTS.maxOpenLobbies) {
      throw new ApiError('conflict', `You already have ${open} open lobbies (the limit is ${PLATFORM_CONSTANTS.maxOpenLobbies}). Delete one first.`);
    }
    const me = this.participant(session.participantId) as ParticipantRec;
    const seat2Owner =
      input.opponent.kind === 'participant'
        ? (() => {
            const opp = this.participant(input.opponent.participantId);
            if (!opp) throw new ApiError('validation', 'Unknown opponent.');
            return { kind: 'participant' as const, participantId: opp.id, name: opp.name };
          })()
        : (() => {
            const bot = input.opponent.bot;
            const meta = BOT_KINDS.find((b) => b.kind === bot);
            if (!meta) throw new ApiError('validation', 'Unknown practice bot.');
            return { kind: 'bot' as const, bot, name: `Practice bot: ${meta.label}` };
          })();
    const now = this.now();
    const seatOf = (seat: Seat, owner: SeatRec['owner']): SeatRec => ({
      seat,
      owner,
      connection: owner.kind === 'bot' ? 'connected' : 'disconnected',
      program: owner.kind === 'bot' ? { name: `practice-${owner.bot}`, version: '1' } : null,
      graceEndsAt: null,
      latencyMs: owner.kind === 'bot' ? 0 : null,
      lastSeenAt: owner.kind === 'bot' ? now : null,
      profile: { brain: owner.kind === 'bot' ? owner.bot : 'hunt-target', fault: 'none' },
      notes: [],
    });
    const selfPlay = seat2Owner.kind === 'participant' && seat2Owner.participantId === me.id;
    // God mode is the creator's choice. Against yourself or a bot there is nobody to protect, so it is always on.
    const forced = selfPlay || seat2Owner.kind === 'bot';
    const requested = input.godMode ?? true;
    if (!forced && requested && !this.state.settings.allowGodMode) {
      throw new ApiError('conflict', 'The admin has turned god mode off for new lobbies between participants. Create the lobby without it.');
    }
    const lobby: LobbyRec = {
      id: this.uniqueLobbyCode(),
      rulesetId: rulesetRec.ruleset.id,
      ruleset: rulesetRec.ruleset,
      godMode: forced || requested,
      createdAt: now,
      createdBy: me.id,
      seats: [seatOf(1, { kind: 'participant', participantId: me.id, name: me.name }), seatOf(2, seat2Owner)],
      seriesList: [],
      games: [],
      lastActivityAt: now,
    };
    this.state.lobbies.push(lobby);
    this.audit(me.name, 'lobby_created', lobby.id, `ruleset ${lobby.rulesetId}, vs ${seat2Owner.name}`);
    return this.summary(lobby, session);
  }

  private uniqueLobbyCode(): string {
    for (;;) {
      const code = generateLobbyCode();
      if (!this.state.lobbies.some((l) => l.id === code)) return code;
    }
  }

  deleteLobby(id: string): void {
    const session = this.requireSession();
    const lobby = this.lobbyFor(id, session);
    const runner = this.runners.get(id);
    runner?.stop();
    this.runners.delete(id);
    this.state.lobbies = this.state.lobbies.filter((l) => l.id !== id);
    this.subscribers.delete(id);
    this.audit(this.actorName(session), 'lobby_deleted', lobby.id);
  }

  startSeries(lobbyId: string, games: number): LobbySummary {
    const session = this.requireParticipant();
    const lobby = this.lobbyFor(lobbyId, session);
    const { maxBatterySize } = this.state.settings;
    if (!Number.isInteger(games) || games < 1 || games > maxBatterySize) {
      throw new ApiError('validation', `The number of games must be a whole number between 1 and ${maxBatterySize}.`);
    }
    const status = this.statusOf(lobby);
    if (status !== 'ready') {
      throw new ApiError('conflict', status === 'waiting' ? 'Not every program is connected yet.' : `The lobby is ${status}.`);
    }
    const series: SeriesRec = {
      id: this.nextId('s'),
      target: games,
      played: 0,
      score: { 1: 0, 2: 0 },
      status: 'running',
      abortReason: null,
      startedAt: this.now(),
      endedAt: null,
      summaries: [],
      heatmap: emptyHeatmap(lobby.ruleset),
    };
    lobby.seriesList.push(series);
    if (lobby.seriesList.length > 10) lobby.seriesList.shift();
    this.bumpActivity(lobby);
    this.audit(this.actorName(session), 'series_started', lobby.id, `${games} game${games === 1 ? '' : 's'}`);
    this.runner(lobby).start();
    this.emit(lobby.id, true);
    return this.summary(lobby, session);
  }

  restartGame(lobbyId: string): LobbySummary {
    const session = this.requireParticipant();
    const lobby = this.lobbyFor(lobbyId, session);
    const runner = this.runner(lobby);
    if (!runner.isRunning()) throw new ApiError('conflict', 'No battery is running.');
    runner.voidLive();
    this.notifyReset(lobby, 'restart_game');
    this.bumpActivity(lobby);
    this.audit(this.actorName(session), 'game_restarted', lobby.id);
    runner.poke();
    this.emit(lobby.id, true);
    return this.summary(lobby, session);
  }

  resetSeries(lobbyId: string): LobbySummary {
    const session = this.requireParticipant();
    const lobby = this.lobbyFor(lobbyId, session);
    const series = lobby.seriesList.at(-1);
    if (!series) throw new ApiError('conflict', 'There are no results to reset.');
    const runner = this.runner(lobby);
    runner.stop();
    runner.voidLive();
    lobby.seriesList.pop();
    lobby.games = lobby.games.filter((g) => g.seriesId !== series.id);
    this.notifyReset(lobby, 'reset_series');
    this.bumpActivity(lobby);
    this.audit(this.actorName(session), 'series_reset', lobby.id);
    this.emit(lobby.id, true);
    return this.summary(lobby, session);
  }

  private notifyReset(lobby: LobbyRec, reason: 'restart_game' | 'reset_series'): void {
    for (const seat of lobby.seats) {
      if (seat.owner.kind === 'participant' && seat.connection !== 'disconnected') {
        addNote(seat, this.now(), 'to_program', JSON.stringify({ type: 'reset', reason }));
      }
    }
  }

  // --------------------------------------------------------------- lobby data

  listSeries(lobbyId: string): SeriesInfo[] {
    return this.lobbyFor(lobbyId).seriesList.map((s) => this.seriesInfo(s));
  }

  listGames(lobbyId: string, seriesId?: string): GameListItem[] {
    const lobby = this.lobbyFor(lobbyId);
    const id = seriesId ?? lobby.seriesList.at(-1)?.id;
    return lobby.games
      .filter((g) => g.seriesId === id)
      .map((g) => this.gameListItem(lobby, g))
      .sort((a, b) => a.index - b.index || a.startedAt - b.startedAt);
  }

  getGame(lobbyId: string, gameId: string): GameDetail {
    const session = this.requireSession();
    const lobby = this.lobbyFor(lobbyId, session);
    const game = lobby.games.find((g) => g.id === gameId);
    if (!game) throw new ApiError('not_found', 'Game not found.');
    return this.gameDetail(lobby, game, session);
  }

  getSeriesReport(lobbyId: string, seriesId?: string): SeriesReport | null {
    const lobby = this.lobbyFor(lobbyId);
    const series = seriesId ? lobby.seriesList.find((s) => s.id === seriesId) : lobby.seriesList.at(-1);
    if (!series) return null;
    return {
      seriesId: series.id,
      info: this.seriesInfo(series),
      stats: aggregateSeries(series.summaries, lobby.ruleset),
      heatmap: series.heatmap,
    };
  }

  getFrameLog(lobbyId: string, seat: Seat): Frame[] {
    const session = this.requireSession();
    const lobby = this.lobbyFor(lobbyId, session);
    const rec = lobby.seats[seat - 1];
    if (!rec || rec.owner.kind !== 'participant') throw new ApiError('not_found', 'No program on that seat.');
    if (session.role !== 'admin' && !this.ownsSeat(session, rec)) {
      throw new ApiError('forbidden', "You can only read your own programs' frame logs.");
    }
    return buildFrames(lobby, seat);
  }

  subscribeLobby(lobbyId: string, onUpdate: (update: LiveUpdate) => void): () => void {
    const session = this.requireSession();
    const lobby = this.lobbyFor(lobbyId, session);
    const sub: Subscriber = { session, callback: onUpdate };
    let set = this.subscribers.get(lobbyId);
    if (!set) this.subscribers.set(lobbyId, (set = new Set()));
    set.add(sub);
    queueMicrotask(() => {
      if (set.has(sub)) {
        try {
          onUpdate(this.liveUpdate(lobby, session));
        } catch {
          // ignore: the viewer may have lost access
        }
      }
    });
    return () => void set.delete(sub);
  }

  // -------------------------------------------------------------------- admin

  private adminParticipant(p: ParticipantRec): AdminParticipant {
    return {
      id: p.id,
      name: p.name,
      createdAt: p.createdAt,
      tokenCreatedAt: p.tokenCreatedAt,
      lobbyCount: this.state.lobbies.filter((l) => l.seats.some((s) => s.owner.kind === 'participant' && s.owner.participantId === p.id)).length,
    };
  }

  adminListParticipants(): AdminParticipant[] {
    this.requireAdmin();
    return this.state.participants.map((p) => this.adminParticipant(p)).sort((a, b) => a.name.localeCompare(b.name));
  }

  private validateName(name: string, exceptId?: string): string {
    const trimmed = name.trim();
    if (!/^[\p{L}\p{N} ._-]{1,24}$/u.test(trimmed)) {
      throw new ApiError('validation', 'Names are 1-24 characters: letters, digits, spaces, dots, dashes and underscores.');
    }
    if (this.state.participants.some((p) => p.id !== exceptId && p.name.toLowerCase() === trimmed.toLowerCase())) {
      throw new ApiError('conflict', `There is already a participant called "${trimmed}".`);
    }
    return trimmed;
  }

  adminCreateParticipant(name: string): AdminParticipant {
    const admin = this.requireAdmin();
    const p: ParticipantRec = {
      id: this.nextId('p'),
      name: this.validateName(name),
      token: null,
      tokenCreatedAt: null,
      tokenReplaced: false,
      tokenNotice: null,
      createdAt: this.now(),
    };
    this.state.participants.push(p);
    this.audit(`admin:${admin.username}`, 'participant_created', p.name);
    return this.adminParticipant(p);
  }

  adminRenameParticipant(id: string, name: string): AdminParticipant {
    const admin = this.requireAdmin();
    const p = this.participant(id);
    if (!p) throw new ApiError('not_found', 'Participant not found.');
    const old = p.name;
    p.name = this.validateName(name, id);
    for (const lobby of this.state.lobbies) {
      for (const seat of lobby.seats) {
        if (seat.owner.kind === 'participant' && seat.owner.participantId === id) seat.owner = { ...seat.owner, name: p.name };
      }
    }
    this.audit(`admin:${admin.username}`, 'participant_renamed', old, `now ${p.name}`);
    return this.adminParticipant(p);
  }

  adminDeleteParticipant(id: string): void {
    const admin = this.requireAdmin();
    const p = this.participant(id);
    if (!p) throw new ApiError('not_found', 'Participant not found.');
    const lobbies = this.adminParticipant(p).lobbyCount;
    if (lobbies > 0) {
      throw new ApiError('conflict', `${p.name} is part of ${lobbies} lobb${lobbies === 1 ? 'y' : 'ies'}. Delete those first.`);
    }
    this.state.participants = this.state.participants.filter((x) => x.id !== id);
    this.audit(`admin:${admin.username}`, 'participant_deleted', p.name);
  }

  adminCreateRuleset(ruleset: Ruleset): RulesetInfo {
    const admin = this.requireAdmin();
    const problems = validateRuleset(ruleset);
    if (this.state.rulesets.some((r) => r.ruleset.id === ruleset.id)) problems.unshift(`a ruleset called "${ruleset.id}" already exists.`);
    if (problems.length > 0) throw new ApiError('validation', problems.join(' '), { problems });
    this.state.rulesets.push({ ruleset, enabled: true, createdAt: this.now() });
    this.audit(`admin:${admin.username}`, 'ruleset_created', ruleset.id);
    return this.listRulesets().find((r) => r.ruleset.id === ruleset.id) as RulesetInfo;
  }

  adminSetRulesetEnabled(id: string, enabled: boolean): RulesetInfo {
    const admin = this.requireAdmin();
    const rec = this.state.rulesets.find((r) => r.ruleset.id === id);
    if (!rec) throw new ApiError('not_found', 'Ruleset not found.');
    if (!enabled && rec.enabled && this.state.rulesets.filter((r) => r.enabled).length === 1) {
      throw new ApiError('conflict', 'At least one ruleset must stay enabled.');
    }
    if (!enabled && id === this.state.settings.defaultRulesetId) {
      throw new ApiError('conflict', `"${id}" is the default ruleset. Make another ruleset the default before disabling it.`);
    }
    rec.enabled = enabled;
    this.audit(`admin:${admin.username}`, enabled ? 'ruleset_enabled' : 'ruleset_disabled', id);
    return this.listRulesets().find((r) => r.ruleset.id === id) as RulesetInfo;
  }

  adminSetDefaultRuleset(id: string): RulesetInfo {
    const admin = this.requireAdmin();
    const rec = this.state.rulesets.find((r) => r.ruleset.id === id);
    if (!rec) throw new ApiError('not_found', 'Ruleset not found.');
    if (!rec.enabled) throw new ApiError('conflict', `"${id}" is disabled. Enable it before making it the default.`);
    if (this.state.settings.defaultRulesetId !== id) {
      this.state.settings.defaultRulesetId = id;
      this.audit(`admin:${admin.username}`, 'default_ruleset_changed', id);
    }
    return this.listRulesets().find((r) => r.ruleset.id === id) as RulesetInfo;
  }

  adminGetSettings(): PlatformSettings {
    this.requireAdmin();
    const c = PLATFORM_CONSTANTS;
    return {
      allowGodMode: this.state.settings.allowGodMode,
      maxBatterySize: this.state.settings.maxBatterySize,
      constants: [
        { label: 'Move timeout', value: `${c.moveTimeoutMs / 1000} s` },
        { label: 'Placement timeout', value: `${c.placeTimeoutMs / 1000} s` },
        { label: 'Disconnect grace (resume window)', value: `${c.graceMs / 1000} s` },
        { label: 'Idle lobby expiry', value: `${c.idleExpiryMs / 3_600_000} h` },
        { label: 'Open lobbies per participant', value: String(c.maxOpenLobbies) },
        { label: 'Invalid-move strikes before forfeit', value: String(c.maxStrikes) },
      ],
    };
  }

  adminUpdateSettings(patch: { allowGodMode?: boolean; maxBatterySize?: number }): PlatformSettings {
    const admin = this.requireAdmin();
    if (patch.maxBatterySize !== undefined) {
      if (!Number.isInteger(patch.maxBatterySize) || patch.maxBatterySize < 1 || patch.maxBatterySize > 10_000) {
        throw new ApiError('validation', 'The maximum battery size must be a whole number between 1 and 10000.');
      }
      this.state.settings.maxBatterySize = patch.maxBatterySize;
      this.audit(`admin:${admin.username}`, 'max_battery_changed', null, String(patch.maxBatterySize));
    }
    if (patch.allowGodMode !== undefined) {
      this.state.settings.allowGodMode = patch.allowGodMode;
      this.audit(`admin:${admin.username}`, 'god_mode_policy_changed', null, patch.allowGodMode ? 'allowed' : 'not allowed');
    }
    this.changed();
    return this.adminGetSettings();
  }

  adminListAuditLog(): AuditEntry[] {
    this.requireAdmin();
    return [...this.state.audit].reverse();
  }

  adminListAllLobbies(): LobbySummary[] {
    const admin = this.requireAdmin();
    return this.state.lobbies.map((l) => this.summary(l, admin)).sort((a, b) => b.lastActivityAt - a.lastActivityAt);
  }

  // ------------------------------------------------- mock controls (dev panel)

  setSpeed(speed: Speed): void {
    this.speedSetting = speed;
  }

  getSpeed(): Speed {
    return this.speedSetting;
  }

  /** Brings a simulated program online on a participant-owned seat. */
  connectProgram(lobbyId: string, seatNo: Seat, profile?: SimProfile): void {
    const lobby = this.state.lobbies.find((l) => l.id === lobbyId);
    const seat = lobby?.seats[seatNo - 1];
    if (!lobby || !seat || seat.owner.kind !== 'participant') throw new ApiError('not_found', 'No such seat.');
    const owner = this.participant(seat.owner.participantId);
    if (!owner?.token) {
      throw new ApiError('conflict', `${seat.owner.name} has no token yet: a program cannot authenticate without one (close code 4401).`);
    }
    if (profile) seat.profile = profile;
    const now = this.now();
    const resumed = seat.connection === 'grace';
    seat.connection = 'connected';
    seat.graceEndsAt = null;
    seat.latencyMs = 5 + Math.floor(Math.random() * 40);
    seat.lastSeenAt = now;
    seat.program = { name: `sim-${seat.profile.brain}`, version: '0.1.0' };
    addNote(
      seat,
      now,
      'from_program',
      JSON.stringify({
        type: 'hello',
        token: 'bsc_••••••••',
        lobby: lobby.id,
        accepts: [lobby.rulesetId],
        program: seat.program,
        ...(resumed ? { session_id: 's_••••' } : {}),
      }),
    );
    addNote(
      seat,
      now,
      'to_program',
      JSON.stringify({
        type: 'welcome',
        session_id: 's_••••',
        seat: seat.seat,
        resumed,
        lobby: lobby.id,
        ruleset: toWireRuleset(lobby.ruleset),
        limits: {
          place_ms: PLATFORM_CONSTANTS.placeTimeoutMs,
          move_ms: PLATFORM_CONSTANTS.moveTimeoutMs,
          grace_ms: PLATFORM_CONSTANTS.graceMs,
          max_strikes: PLATFORM_CONSTANTS.maxStrikes,
        },
      }),
    );
    this.bumpActivity(lobby);
    this.runners.get(lobby.id)?.poke();
    this.emit(lobby.id, true);
  }

  disconnectProgram(lobbyId: string, seatNo: Seat): void {
    const lobby = this.state.lobbies.find((l) => l.id === lobbyId);
    const seat = lobby?.seats[seatNo - 1];
    if (!lobby || !seat || seat.owner.kind !== 'participant') throw new ApiError('not_found', 'No such seat.');
    this.disconnectSeat(lobby, seat, 'Connection closed by the program.');
  }

  private disconnectSeat(lobby: LobbyRec, seat: SeatRec, note: string): void {
    const now = this.now();
    const running = this.runners.get(lobby.id)?.isRunning() ?? false;
    seat.connection = running ? 'grace' : 'disconnected';
    seat.graceEndsAt = running ? now + PLATFORM_CONSTANTS.graceMs : null;
    seat.lastSeenAt = now;
    addNote(seat, now, 'note', running ? `${note} Resume window started.` : note);
    this.bumpActivity(lobby);
    this.runners.get(lobby.id)?.poke();
    this.emit(lobby.id, true);
  }

  setProfile(lobbyId: string, seatNo: Seat, profile: SimProfile): void {
    const seat = this.state.lobbies.find((l) => l.id === lobbyId)?.seats[seatNo - 1];
    if (!seat) throw new ApiError('not_found', 'No such seat.');
    seat.profile = profile;
    this.changed();
    this.emit(lobbyId, true);
  }

  /** Simulates a platform restart: games in progress are voided; programs must reconnect. */
  simulateServerRestart(): void {
    for (const runner of this.runners.values()) {
      runner.stop();
      runner.voidLive();
    }
    this.runners.clear();
    this.recoverAfterRestart(true);
    for (const lobby of this.state.lobbies) this.emit(lobby.id, true);
  }

  private recoverAfterRestart(announce: boolean): void {
    const now = this.now();
    for (const lobby of this.state.lobbies) {
      const running = lobby.seriesList.at(-1)?.status === 'running';
      for (const seat of lobby.seats) {
        if (seat.owner.kind !== 'participant') continue;
        if (seat.connection !== 'disconnected' || running) {
          seat.connection = running ? 'grace' : 'disconnected';
          seat.graceEndsAt = running ? now + PLATFORM_CONSTANTS.graceMs : null;
          if (announce) addNote(seat, now, 'note', 'Platform restarted: connection closed. Reconnect with hello.');
        }
      }
      for (const game of lobby.games) if (game.status === 'live') game.status = 'void';
      if (running) this.runner(lobby).start();
    }
  }

  expireLobby(lobbyId: string): void {
    const lobby = this.state.lobbies.find((l) => l.id === lobbyId);
    if (!lobby) throw new ApiError('not_found', 'No such lobby.');
    this.runners.get(lobbyId)?.stop();
    const series = lobby.seriesList.at(-1);
    if (series?.status === 'running') {
      this.runners.get(lobbyId)?.voidLive();
      series.status = 'aborted';
      series.abortReason = 'The lobby expired.';
      series.endedAt = this.now();
    }
    for (const seat of lobby.seats) if (seat.owner.kind === 'participant') seat.connection = 'disconnected';
    lobby.lastActivityAt = this.now() - PLATFORM_CONSTANTS.idleExpiryMs - 1000;
    this.changed();
    this.emit(lobbyId, true);
  }

  simulateTokenReplacedElsewhere(participantId: string): void {
    const p = this.participant(participantId);
    if (!p) throw new ApiError('not_found', 'Unknown participant.');
    if (!p.token) throw new ApiError('conflict', `${p.name} has no token to replace.`);
    p.token = newToken();
    p.tokenCreatedAt = this.now();
    p.tokenReplaced = true;
    p.tokenNotice = { at: this.now() };
    this.dropConnections(p.id, 'Token replaced: connection closed (close code 4000).');
    this.audit('(another session)', 'token_replaced', p.name);
  }

  /** Test helper: stops timers of a lobby so tests do not leak. */
  deleteLobbyForTest(id: string): void {
    this.runners.get(id)?.stop();
    this.runners.delete(id);
  }

  resetData(): void {
    for (const runner of this.runners.values()) runner.stop();
    this.runners.clear();
    this.subscribers.clear();
    this.persistence.clear();
    this.state = createSeedState(this.now());
    this.setSession(null);
    this.gatePassed = false;
    this.failures = [];
    this.persistNow();
  }
}

import {
  addGameToHeatmap,
  apply,
  createGame,
  decide,
  otherSeat,
  summarizeGame,
  type GameEvent,
  type Seat,
} from '@bsc/engine';
import {
  CLOSE,
  gameOverFrame,
  parseInbound,
  placeFrame,
  toWireRuleset,
  turnFrame,
  type FrameError,
  type GameplayErrorCode,
  type InboundFrame,
  type Welcome,
} from '@bsc/protocol';
import type { Frame } from '@bsc/api-contract';
import type { GameRow, SeatOwnerRow, SeriesRow } from '../../store/store.js';
import { Lobby, type LiveGame } from '../lobby.js';
import { newId } from '../util.js';
import { CancelToken } from './cancel.js';
import { BotLink, type SeatLink } from './seat-link.js';

export interface RuntimeLimits {
  moveMs: number;
  placeMs: number;
  graceMs: number;
  maxStrikes: number;
}

/** What the runtime needs from the platform around it. */
export interface RuntimeHost {
  now(): number;
  limits: RuntimeLimits;
  /** Tell live viewers that something changed. */
  notify(lobbyId: string, force?: boolean): void;
  /** Record activity on the lobby (resets its idle timer). */
  touch(lobby: Lobby, save?: boolean): void;
  /** Persist a finished or voided game together with the updated series (one transaction). */
  recordGame(game: GameRow, series: SeriesRow): Promise<void>;
  saveSeries(lobby: Lobby, series: SeriesRow): Promise<void>;
  log(level: 'warn' | 'error', message: string): void;
  /** The display name of whoever owns a seat. */
  ownerName(owner: SeatOwnerRow): string;
}

type AskOutcome =
  | { kind: 'reply'; frame: InboundFrame; ms: number }
  | { kind: 'invalid'; message: string; raw: string; ms: number }
  | { kind: 'timeout'; ms: number }
  | { kind: 'gone'; seat: Seat }
  | { kind: 'cancelled' };

type PendingResult =
  | { kind: 'reply'; frame: InboundFrame }
  | { kind: 'invalid'; message: string; raw: string }
  | { kind: 'disconnected' };

interface Pending {
  rid: number;
  expect: 'placement' | 'fire';
  settle(result: PendingResult): void;
}

export interface ReceiveResult {
  /** True when the frame was ignored or invalid in a way that counts towards the abuse limit. */
  counted: boolean;
}

const RAW_LIMIT = 500;
const truncate = (text: string): string => (text.length > RAW_LIMIT ? `${text.slice(0, RAW_LIMIT)}…` : text);

type GameEnd = 'finished' | 'voided' | 'aborted' | 'stopped';

/**
 * Runs the batteries of one lobby: connections, the request/response protocol with both programs,
 * misbehavior policy and persistence. All of its state is in memory except what is stored at game end.
 */
export class LobbyRuntime {
  private links: [SeatLink | null, SeatLink | null] = [null, null];
  private sessions: [string | null, string | null] = [null, null];
  private pending: [Pending | null, Pending | null] = [null, null];
  private rids: [number, number] = [0, 0];
  private graceTimers: [ReturnType<typeof setTimeout> | null, ReturnType<typeof setTimeout> | null] = [null, null];
  private graceExpired: [boolean, boolean] = [false, false];
  private waiters = new Set<() => void>();
  private loop: Promise<void> | null = null;
  private token: CancelToken | null = null;
  private stopped = false;
  private unsaved: { game: GameRow; series: SeriesRow }[] = [];

  constructor(
    readonly lobby: Lobby,
    private readonly host: RuntimeHost,
  ) {
    ([1, 2] as const).forEach((seat) => {
      const owner = lobby.row.seats[seat - 1];
      if (owner?.kind === 'bot') this.links[seat - 1] = new BotLink(owner.bot, lobby.ruleset, (text) => this.receive(seat, this.links[seat - 1] as SeatLink, text));
    });
  }

  // --- connections -----------------------------------------------------------------------------

  isRunning(): boolean {
    return this.lobby.currentSeries()?.status === 'running';
  }

  linkOf(seat: Seat): SeatLink | null {
    return this.links[seat - 1] ?? null;
  }

  sessionOf(seat: Seat): string | null {
    return this.sessions[seat - 1] ?? null;
  }

  private note(seat: Seat, text: string): void {
    this.lobby.seats[seat - 1]?.frames.add({ at: this.host.now(), dir: 'note', text });
  }

  private logFrame(seat: Seat, dir: Frame['dir'], text: string): void {
    if (this.lobby.isBotSeat(seat)) return;
    this.lobby.seats[seat - 1]?.frames.add({ at: this.host.now(), dir, text });
  }

  private send(seat: Seat, frame: object): void {
    const link = this.links[seat - 1];
    if (!link) return;
    const text = JSON.stringify(frame);
    this.logFrame(seat, 'to_program', text);
    try {
      link.send(text);
    } catch {
      // the socket died under us; the close handler will move the seat into its grace period
    }
  }

  /** Seats a connected program (the gateway has already authenticated it and chosen the seat). */
  attach(seat: Seat, link: SeatLink, program: { name: string; version: string } | null, helloText: string): Welcome {
    const state = this.lobby.seats[seat - 1] as Lobby['seats'][number];
    const previous = this.links[seat - 1];
    const resumed = state.connection === 'grace';
    this.links[seat - 1] = link;
    this.resolvePending(seat, { kind: 'disconnected' });
    if (previous && previous !== link) previous.close(CLOSE.CLOSED_BY_PLATFORM, 'Replaced by a newer connection.');
    this.clearGrace(seat);
    this.graceExpired[seat - 1] = false;
    const sessionId = newId('s', 16);
    this.sessions[seat - 1] = sessionId;
    state.connection = 'connected';
    state.graceEndsAt = null;
    state.program = program;
    state.lastSeenAt = this.host.now();
    state.latencyMs = null;
    this.logFrame(seat, 'from_program', helloText);
    const welcome: Welcome = {
      type: 'welcome',
      session_id: sessionId,
      seat,
      resumed,
      lobby: this.lobby.id,
      ruleset: toWireRuleset(this.lobby.ruleset),
      limits: {
        place_ms: this.host.limits.placeMs,
        move_ms: this.host.limits.moveMs,
        grace_ms: this.host.limits.graceMs,
        max_strikes: this.host.limits.maxStrikes,
      },
    };
    this.host.touch(this.lobby);
    this.wake();
    // The welcome goes out after the seat is registered, so it is always the first frame the program sees.
    this.send(seat, welcome);
    this.host.notify(this.lobby.id, true);
    return welcome;
  }

  /** The program's connection closed. Inside a running battery the seat gets a resume window. */
  detach(seat: Seat, link: SeatLink, note: string, quiet = false): void {
    if (this.links[seat - 1] !== link) return;
    this.links[seat - 1] = null;
    const state = this.lobby.seats[seat - 1] as Lobby['seats'][number];
    const now = this.host.now();
    state.lastSeenAt = now;
    state.latencyMs = null;
    this.resolvePending(seat, { kind: 'disconnected' });
    if (this.isRunning() && !this.stopped) {
      state.connection = 'grace';
      state.graceEndsAt = now + this.host.limits.graceMs;
      this.note(seat, `${note} Resume window started.`);
      this.clearGrace(seat);
      this.graceTimers[seat - 1] = setTimeout(() => this.expireGrace(seat), this.host.limits.graceMs);
    } else {
      state.connection = 'disconnected';
      state.graceEndsAt = null;
      this.note(seat, note);
    }
    if (!quiet) this.host.touch(this.lobby);
    this.host.notify(this.lobby.id, true);
  }

  /** Drops the program on a seat on the platform's initiative (token replaced, lobby expired). */
  dropSeat(seat: Seat, reason: string): void {
    const link = this.links[seat - 1];
    if (!link || link.kind === 'bot') return;
    link.close(CLOSE.CLOSED_BY_PLATFORM, reason);
    this.detach(seat, link, reason, true);
  }

  private clearGrace(seat: Seat): void {
    const timer = this.graceTimers[seat - 1];
    if (timer) clearTimeout(timer);
    this.graceTimers[seat - 1] = null;
  }

  private expireGrace(seat: Seat): void {
    this.graceTimers[seat - 1] = null;
    const state = this.lobby.seats[seat - 1] as Lobby['seats'][number];
    if (state.connection !== 'grace') return;
    this.note(seat, 'Resume window expired.');
    state.connection = 'disconnected';
    state.graceEndsAt = null;
    this.graceExpired[seat - 1] = true;
    this.wake();
    this.host.notify(this.lobby.id, true);
  }

  private wake(): void {
    const waiting = [...this.waiters];
    this.waiters.clear();
    for (const w of waiting) w();
  }

  private resolvePending(seat: Seat, result: PendingResult): void {
    const pending = this.pending[seat - 1];
    if (pending) pending.settle(result);
  }

  // --- inbound frames --------------------------------------------------------------------------

  /** Handles one text frame from the program on `seat`. */
  receive(seat: Seat, link: SeatLink, text: string): ReceiveResult {
    if (this.links[seat - 1] !== link) return { counted: false };
    const state = this.lobby.seats[seat - 1] as Lobby['seats'][number];
    state.lastSeenAt = this.host.now();
    this.logFrame(seat, 'from_program', text);
    const parsed = parseInbound(text);
    const pending = this.pending[seat - 1];

    const standalone = (code: 'bad_json' | 'unknown_type' | 'unexpected_message', message: string): ReceiveResult => {
      this.send(seat, { type: 'error', code, message, fatal: false });
      return { counted: true };
    };

    if (!parsed.ok) {
      if (parsed.code === 'bad_shape' && parsed.rid !== undefined && (parsed.type === 'placement' || parsed.type === 'fire')) {
        if (pending && pending.rid === parsed.rid) {
          pending.settle({ kind: 'invalid', message: parsed.message, raw: truncate(text) });
          return { counted: false };
        }
        return { counted: true }; // stale: ignored, logged only
      }
      if (parsed.code === 'frame_too_large') return { counted: true };
      return standalone(parsed.code === 'bad_json' ? 'bad_json' : 'unknown_type', parsed.message);
    }

    const frame = parsed.frame;
    if (frame.type === 'hello') return standalone('unexpected_message', 'Already said hello on this connection.');
    if (!pending) return standalone('unexpected_message', `No request is pending, so "${frame.type}" was not expected.`);
    if (frame.rid !== pending.rid) return { counted: true }; // stale reply: ignored
    if (frame.type !== pending.expect) {
      pending.settle({ kind: 'invalid', message: `Expected "${pending.expect}" for this request, got "${frame.type}".`, raw: truncate(text) });
      return { counted: false };
    }
    pending.settle({ kind: 'reply', frame });
    return { counted: false };
  }

  // --- asking a program for something -----------------------------------------------------------

  /**
   * Waits until both seats are connected (a game is paused while either program is away). Returns
   * 'ok', the seat whose resume window ran out, or 'cancelled'.
   */
  private async waitReady(token: CancelToken): Promise<'ok' | 'cancelled' | { gone: Seat }> {
    for (;;) {
      if (token.cancelled) return 'cancelled';
      const gone = ([1, 2] as const).find((s) => this.graceExpired[s - 1]);
      if (gone) return { gone };
      if (this.lobby.seats.every((s) => s.connection === 'connected')) return 'ok';
      await new Promise<void>((resolve) => {
        const off = token.onCancel(resolve);
        this.waiters.add(() => {
          off();
          resolve();
        });
      });
    }
  }

  /**
   * Sends the request built by `build` and waits for the matching reply. A disconnect re-issues the
   * request (new rid, fresh timer) once the program is back; a timeout is reported to the caller.
   */
  private async ask(
    seat: Seat,
    expect: 'placement' | 'fire',
    deadlineMs: number,
    token: CancelToken,
    build: (rid: number) => object,
  ): Promise<AskOutcome> {
    for (;;) {
      const ready = await this.waitReady(token);
      if (ready === 'cancelled') return { kind: 'cancelled' };
      if (ready !== 'ok') return { kind: 'gone', seat: ready.gone };
      const rid = ++this.rids[seat - 1]!;
      const sentAt = this.host.now();
      const result = await new Promise<PendingResult | { kind: 'timeout' } | { kind: 'cancelled' }>((resolve) => {
        let off: () => void = () => undefined;
        const finish = (r: PendingResult | { kind: 'timeout' } | { kind: 'cancelled' }) => {
          clearTimeout(timer);
          off();
          if (this.pending[seat - 1]?.rid === rid) this.pending[seat - 1] = null;
          resolve(r);
        };
        const timer = setTimeout(() => finish({ kind: 'timeout' }), deadlineMs);
        this.pending[seat - 1] = { rid, expect, settle: finish };
        off = token.onCancel(() => finish({ kind: 'cancelled' }));
        if (!token.cancelled) this.send(seat, build(rid));
      });
      const ms = this.host.now() - sentAt;
      switch (result.kind) {
        case 'reply':
          return { kind: 'reply', frame: result.frame, ms };
        case 'invalid':
          return { kind: 'invalid', message: result.message, raw: result.raw, ms };
        case 'timeout':
          return { kind: 'timeout', ms };
        case 'cancelled':
          return { kind: 'cancelled' };
        case 'disconnected':
          continue;
      }
    }
  }

  // --- the series loop -------------------------------------------------------------------------

  /** Starts playing the lobby's current (running) series. */
  startLoop(): void {
    if (this.loop || this.stopped) return;
    this.loop = this.runSeries().finally(() => {
      this.loop = null;
    });
  }

  private async runSeries(): Promise<void> {
    const series = this.lobby.currentSeries();
    if (!series) return;
    try {
      while (series.status === 'running' && series.played < series.target && !this.stopped) {
        const end = await this.playGame(series);
        if (end === 'aborted' || end === 'stopped') return;
      }
      if (series.status === 'running' && !this.stopped) {
        series.status = 'done';
        series.endedAt = this.host.now();
        await this.host.saveSeries(this.lobby, series);
        this.host.notify(this.lobby.id, true);
      }
    } catch (error) {
      this.host.log('error', `series ${series.id} crashed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
      if (series.status === 'running') {
        series.status = 'aborted';
        series.abortReason = 'The platform hit an internal error.';
        series.endedAt = this.host.now();
        this.lobby.live = null;
        await this.host.saveSeries(this.lobby, series).catch(() => undefined);
        this.host.notify(this.lobby.id, true);
      }
    }
  }

  private async playGame(series: SeriesRow): Promise<GameEnd> {
    const token = (this.token = new CancelToken());
    const ready = await this.waitReady(token);
    if (ready === 'cancelled') return token.reason === 'stop' ? 'stopped' : 'voided';
    if (ready !== 'ok') return this.giveUp(series, ready.gone, null);

    const index = series.played + 1;
    const first: Seat = index % 2 === 1 ? 1 : 2;
    const live: LiveGame = {
      id: newId('g'),
      seriesId: series.id,
      index,
      first,
      startedAt: this.host.now(),
      state: createGame(this.lobby.ruleset, first),
      events: [],
      times: [],
    };
    this.lobby.live = live;
    this.host.notify(this.lobby.id, true);
    const strikes: Record<Seat, number> = { 1: 0, 2: 0 };
    const gameInfo = { id: live.id, index, total: series.target };
    const push = (event: GameEvent) => {
      live.events.push(event);
      live.times.push(this.host.now());
      live.state = apply(live.state, event);
    };
    const infraction = (seat: Seat, code: string, message: string, raw: string | undefined, ms: number): boolean => {
      strikes[seat]++;
      push({ type: 'infraction', seat, code, message, strikes: strikes[seat], ...(raw ? { raw } : {}), ms });
      this.note(seat, `Infraction "${code}": ${message} Strike ${strikes[seat]}/${this.host.limits.maxStrikes}.`);
      if (strikes[seat] >= this.host.limits.maxStrikes) {
        forfeit(seat, 'strikes');
        return true;
      }
      return false;
    };
    const forfeit = (seat: Seat, reason: 'timeout' | 'strikes' | 'disconnect') => {
      const d = decide(live.state, { type: 'forfeit', seat, reason });
      if (d.ok) d.events.forEach(push);
      token.cancel('void'); // wakes the other seat's pending request, if any
    };

    // Both programs place at the same time.
    const place = async (seat: Seat): Promise<'ok' | 'ended' | { gone: Seat }> => {
      let error: FrameError | null = null;
      const opponent = this.lobby.seats[otherSeat(seat) - 1]?.program ?? null;
      const opponentName = this.opponentName(seat);
      for (;;) {
        const outcome = await this.ask(seat, 'placement', this.host.limits.placeMs, token, (rid) =>
          placeFrame({
            rid,
            deadlineMs: this.host.limits.placeMs,
            game: { ...gameInfo, first },
            seat,
            opponent: { name: opponentName, program: opponent },
            error,
            strikes: strikes[seat],
          }),
        );
        if (live.state.phase === 'over') return 'ended';
        if (outcome.kind === 'cancelled') return 'ended';
        if (outcome.kind === 'gone') return { gone: outcome.seat };
        if (outcome.kind === 'timeout') {
          push({ type: 'infraction', seat, code: 'timeout', message: `No reply within ${this.host.limits.placeMs} ms.`, strikes: strikes[seat], ms: outcome.ms });
          forfeit(seat, 'timeout');
          return 'ended';
        }
        let code: GameplayErrorCode = 'bad_shape';
        let message: string;
        let raw: string | undefined;
        if (outcome.kind === 'invalid') {
          message = outcome.message;
          raw = outcome.raw;
        } else {
          const frame = outcome.frame;
          if (frame.type !== 'placement') throw new Error('unreachable: the pending request only accepts placements');
          const d = decide(live.state, { type: 'place', seat, ships: frame.ships });
          if (d.ok) {
            const placed = d.events[0];
            if (placed?.type === 'placed') push({ ...placed, ms: outcome.ms });
            return 'ok';
          }
          code = d.error.code as GameplayErrorCode;
          message = d.error.message;
          raw = truncate(JSON.stringify(frame));
        }
        if (infraction(seat, code, message, raw, outcome.ms)) return 'ended';
        error = { code, message };
      }
    };
    const placed = await Promise.all([place(1), place(2)]);
    const gone = placed.find((p): p is { gone: Seat } => typeof p === 'object');
    if (gone) return this.giveUp(series, gone.gone, live);

    // Then the programs take turns until someone wins or forfeits.
    while (live.state.phase !== 'over' && !token.cancelled) {
      const seat = live.state.turn;
      if (seat === null) break;
      let error: FrameError | null = null;
      let moved = false;
      while (!moved) {
        const outcome = await this.ask(seat, 'fire', this.host.limits.moveMs, token, (rid) =>
          turnFrame({
            rid,
            deadlineMs: this.host.limits.moveMs,
            game: gameInfo,
            seat,
            state: live.state,
            events: live.events,
            error,
            strikes: strikes[seat],
          }),
        );
        if (outcome.kind === 'cancelled') break;
        if (outcome.kind === 'gone') return this.giveUp(series, outcome.seat, live);
        if (outcome.kind === 'timeout') {
          push({ type: 'infraction', seat, code: 'timeout', message: `No reply within ${this.host.limits.moveMs} ms.`, strikes: strikes[seat], ms: outcome.ms });
          forfeit(seat, 'timeout');
          break;
        }
        let code: GameplayErrorCode = 'bad_shape';
        let message: string;
        let raw: string | undefined;
        if (outcome.kind === 'invalid') {
          message = outcome.message;
          raw = outcome.raw;
        } else {
          const frame = outcome.frame;
          if (frame.type !== 'fire') throw new Error('unreachable: the pending request only accepts shots');
          const d = decide(live.state, { type: 'fire', seat, x: frame.x, y: frame.y });
          if (d.ok) {
            const [shot, ...rest] = d.events;
            if (shot?.type === 'shot') push({ ...shot, ms: outcome.ms });
            rest.forEach(push);
            moved = true;
            continue;
          }
          code = d.error.code as GameplayErrorCode;
          message = d.error.message;
          raw = truncate(JSON.stringify(frame));
        }
        if (infraction(seat, code, message, raw, outcome.ms)) break;
        error = { code, message };
      }
      this.host.notify(this.lobby.id);
    }

    if (live.state.phase !== 'over') {
      // Cancelled before the game ended: a restart voids it, a reset or deletion stops everything.
      await this.recordVoid(series, live);
      return token.reason === 'stop' ? 'stopped' : 'voided';
    }
    await this.finishGame(series, live);
    return 'finished';
  }

  private opponentName(seat: Seat): string {
    return this.host.ownerName(this.lobby.row.seats[otherSeat(seat) - 1] as SeatOwnerRow);
  }

  private async finishGame(series: SeriesRow, live: LiveGame): Promise<void> {
    const { state } = live;
    const endedAt = this.host.now();
    const summary = summarizeGame(live.index, state, live.events);
    // Work on a copy: the lobby only shows the game as finished once it is stored, so viewers never
    // see a series that is done while its last game is still "live" (or missing from the history).
    const next: SeriesRow = structuredClone(series);
    next.played++;
    if (state.winner) next.score[state.winner]++;
    addGameToHeatmap(next.heatmap, state);
    const done = next.played >= next.target;
    if (done) {
      next.status = 'done';
      next.endedAt = endedAt;
    }
    const row: GameRow = {
      id: live.id,
      lobbyId: this.lobby.id,
      seriesId: series.id,
      index: live.index,
      first: live.first,
      status: 'over',
      winner: state.winner,
      reason: state.endReason,
      startedAt: live.startedAt,
      endedAt,
      shots: summary.shots,
      infractions: summary.infractions,
      events: live.events,
      times: live.times,
      summary,
    };
    await this.persist(row, next);
    Object.assign(series, next);
    this.lobby.live = null;
    this.host.touch(this.lobby);
    const winner = state.winner as Seat;
    for (const seat of [1, 2] as const) {
      this.send(
        seat,
        gameOverFrame({
          game: { id: live.id, index: live.index, total: series.target },
          seat,
          state,
          events: live.events,
          winner,
          reason: state.endReason as 'sunk' | 'timeout' | 'strikes' | 'disconnect',
          score: { 1: series.score[1], 2: series.score[2] },
          done,
        }),
      );
    }
    this.host.notify(this.lobby.id, done);
  }

  private async recordVoid(series: SeriesRow, live: LiveGame): Promise<void> {
    const shots = { 1: live.state.shots[1].length, 2: live.state.shots[2].length };
    const infractions = (seat: Seat) => live.events.filter((e) => e.type === 'infraction' && e.seat === seat).length;
    const row: GameRow = {
      id: live.id,
      lobbyId: this.lobby.id,
      seriesId: series.id,
      index: live.index,
      first: live.first,
      status: 'void',
      winner: null,
      reason: null,
      startedAt: live.startedAt,
      endedAt: this.host.now(),
      shots,
      infractions: { 1: infractions(1), 2: infractions(2) },
      events: live.events,
      times: live.times,
      summary: null,
    };
    if (!this.stopped) await this.persist(row, series);
    this.lobby.live = null;
    this.host.notify(this.lobby.id, true);
  }

  /** A program did not come back within its resume window. */
  private async giveUp(series: SeriesRow, seat: Seat, live: LiveGame | null): Promise<GameEnd> {
    if (series.target === 1 && live && live.state.phase !== 'over') {
      const d = decide(live.state, { type: 'forfeit', seat, reason: 'disconnect' });
      if (d.ok) {
        for (const e of d.events) {
          live.events.push(e);
          live.times.push(this.host.now());
          live.state = apply(live.state, e);
        }
      }
      await this.finishGame(series, live);
      this.graceExpired = [false, false];
      return 'finished';
    }
    if (live) await this.recordVoid(series, live);
    series.status = 'aborted';
    series.abortReason = `${this.ownerName(seat)}'s program did not reconnect within ${this.host.limits.graceMs / 1000} s.`;
    series.endedAt = this.host.now();
    await this.host.saveSeries(this.lobby, series);
    this.graceExpired = [false, false];
    for (const s of this.lobby.seats) {
      if (s.connection === 'grace') {
        s.connection = 'disconnected';
        s.graceEndsAt = null;
      }
    }
    for (const seatNo of [1, 2] as const) this.clearGrace(seatNo);
    this.host.notify(this.lobby.id, true);
    return 'aborted';
  }

  private ownerName(seat: Seat): string {
    return this.host.ownerName(this.lobby.row.seats[seat - 1] as SeatOwnerRow);
  }

  private async persist(game: GameRow, series: SeriesRow): Promise<void> {
    this.unsaved.push({ game, series: structuredClone(series) });
    while (this.unsaved.length > 0 && !this.stopped) {
      const next = this.unsaved[0] as { game: GameRow; series: SeriesRow };
      try {
        await this.host.recordGame(next.game, next.series);
        this.unsaved.shift();
      } catch (error) {
        this.host.log('error', `could not save game ${next.game.id}: ${error instanceof Error ? error.message : String(error)} (will retry)`);
        break;
      }
    }
  }

  // --- control from the outside ----------------------------------------------------------------

  /** Voids the game in progress and plays the same game number again. */
  restartGame(): void {
    for (const seat of [1, 2] as const) this.notifyReset(seat, 'restart_game');
    this.token?.cancel('void');
  }

  /** Stops the battery (its results are about to be discarded) and waits until the loop has let go. */
  async stopSeries(): Promise<void> {
    this.stopped = true;
    this.token?.cancel('stop');
    this.wake();
    await this.loop;
    this.stopped = false;
    this.graceExpired = [false, false];
    for (const seat of [1, 2] as const) {
      this.clearGrace(seat);
      this.notifyReset(seat, 'reset_series');
      const state = this.lobby.seats[seat - 1] as Lobby['seats'][number];
      if (state.connection === 'grace') {
        state.connection = 'disconnected';
        state.graceEndsAt = null;
      }
    }
    this.lobby.live = null;
  }

  private notifyReset(seat: Seat, reason: 'restart_game' | 'reset_series'): void {
    this.send(seat, { type: 'reset', reason });
  }

  /** The lobby is gone (deleted, or the platform is shutting down): release everything. */
  destroy(reason: string): void {
    this.stopped = true;
    this.token?.cancel('stop');
    this.wake();
    for (const seat of [1, 2] as const) {
      this.clearGrace(seat);
      const link = this.links[seat - 1];
      this.links[seat - 1] = null;
      if (link) link.close(CLOSE.CLOSED_BY_PLATFORM, reason);
      this.resolvePending(seat, { kind: 'disconnected' });
    }
    this.lobby.live = null;
  }

  /** After a platform restart: a battery that was running waits for its programs to come back. */
  resumeAfterRestart(): void {
    if (!this.isRunning()) return;
    const now = this.host.now();
    for (const seat of [1, 2] as const) {
      if (this.lobby.isBotSeat(seat)) continue;
      const state = this.lobby.seats[seat - 1] as Lobby['seats'][number];
      state.connection = 'grace';
      state.graceEndsAt = now + this.host.limits.graceMs;
      this.graceTimers[seat - 1] = setTimeout(() => this.expireGrace(seat), this.host.limits.graceMs);
      this.note(seat, 'Platform restarted: waiting for the program to reconnect with hello.');
    }
    this.startLoop();
  }
}

import { createBrain } from '@bsc/bots';
import {
  addGameToHeatmap,
  apply,
  createGame,
  decide,
  randInt,
  seatView,
  seededRng,
  summarizeGame,
  type GameEvent,
  type GameState,
  type Rng,
  type Seat,
  type Ship,
} from '@bsc/engine';
import { addNote, MOCK_KEPT_GAMES, PLATFORM_CONSTANTS, type GameRec, type LobbyRec, type SeatRec, type SeriesRec } from './state';

export type Speed = 'watch' | 'fast' | 'instant';

export interface RunnerHost {
  now(): number;
  speed(): Speed;
  /** Push a live update to subscribers; `force` bypasses throttling. */
  emit(lobbyId: string, force?: boolean): void;
  /** Something worth persisting changed. */
  changed(): void;
  nextId(prefix: string): string;
}

interface LiveGame {
  rec: GameRec;
  state: GameState;
  strikes: Record<Seat, number>;
  rng: Rng;
  rid: number;
}

const thinkMs = (rng: Rng, brain: string): number =>
  brain === 'random' ? randInt(rng, 3) : 1 + randInt(rng, 5) + (rng() < 0.05 ? randInt(rng, 40) : 0);

/**
 * Plays the batteries of one lobby between simulated programs, one step per tick, so the
 * UI can watch a game live. Mock only: the real platform plays against real programs.
 */
export class LobbyRunner {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private live: LiveGame | null = null;

  constructor(
    readonly lobby: LobbyRec,
    private host: RunnerHost,
  ) {}

  series(): SeriesRec | undefined {
    return this.lobby.seriesList.at(-1);
  }

  isRunning(): boolean {
    return this.series()?.status === 'running';
  }

  liveGame(): { rec: GameRec; state: GameState } | null {
    return this.live ? { rec: this.live.rec, state: this.live.state } : null;
  }

  start(): void {
    this.schedule(0);
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Voids the game in progress (restart, reset, server restart). It is not counted. */
  voidLive(): void {
    if (!this.live) return;
    this.live.rec.status = 'void';
    this.live.rec.endedAt = this.host.now();
    this.live = null;
  }

  /** Called when connections changed while a battery is running. */
  poke(): void {
    if (this.isRunning() && !this.timer) this.schedule(0);
  }

  private schedule(delay: number): void {
    this.stop();
    this.timer = setTimeout(this.tick, delay);
  }

  private tick = (): void => {
    this.timer = null;
    const series = this.series();
    if (!series || series.status !== 'running') return;
    const now = this.host.now();
    const absent = this.lobby.seats.filter((s) => s.connection !== 'connected');
    if (absent.length > 0) {
      const deadline = Math.min(...absent.map((s) => s.graceEndsAt ?? now));
      if (now >= deadline) this.giveUp(absent.find((s) => (s.graceEndsAt ?? now) <= now) ?? (absent[0] as SeatRec));
      else this.schedule(250);
      return;
    }
    const speed = this.host.speed();
    const budgetEnd = performance.now() + (speed === 'instant' ? 12 : 0);
    do {
      this.stepOnce();
    } while (
      speed === 'instant' &&
      this.isRunning() &&
      this.lobby.seats.every((s) => s.connection === 'connected') &&
      performance.now() < budgetEnd
    );
    this.host.emit(this.lobby.id);
    if (this.isRunning()) this.schedule(speed === 'watch' ? 150 : speed === 'fast' ? 8 : 0);
  };

  /** Plays synchronously until the battery ends (or `untilPlayed` games are done). Used for seeding. */
  runToCompletion(untilPlayed = Infinity): void {
    let guard = 0;
    while (this.isRunning() && (this.series()?.played ?? 0) < untilPlayed && guard++ < 5_000_000) this.stepOnce();
  }

  stepOnce(): void {
    if (!this.live) this.beginGame();
    else if (this.live.state.phase === 'over') this.endGame();
    else this.move();
  }

  private push(event: GameEvent): void {
    const live = this.live as LiveGame;
    live.rec.events?.push(event);
    live.rec.times.push(this.host.now());
    live.state = apply(live.state, event);
  }

  private beginGame(): void {
    const series = this.series() as SeriesRec;
    const index = series.played + 1;
    const first: Seat = index % 2 === 1 ? 1 : 2;
    const rec: GameRec = {
      id: this.host.nextId('g'),
      seriesId: series.id,
      index,
      first,
      status: 'live',
      winner: null,
      reason: null,
      startedAt: this.host.now(),
      endedAt: null,
      events: [],
      times: [],
      summary: null,
    };
    this.lobby.games.push(rec);
    this.live = {
      rec,
      state: createGame(this.lobby.ruleset, first),
      strikes: { 1: 0, 2: 0 },
      rng: seededRng(Math.floor(Math.random() * 2 ** 31)),
      rid: 0,
    };
    this.host.emit(this.lobby.id, true);
    for (const seat of [1, 2] as Seat[]) {
      if (!this.placeFor(seat)) return;
    }
  }

  /** Returns false if the game ended during placement. */
  private placeFor(seat: Seat): boolean {
    const live = this.live as LiveGame;
    const { ruleset } = this.lobby;
    const rec = this.lobby.seats[seat - 1] as SeatRec;
    const ships = createBrain(rec.profile.brain).place(ruleset, live.rng);
    const ms = thinkMs(live.rng, rec.profile.brain);
    live.rid++;
    if (rec.profile.fault === 'invalid_moves' && live.rng() < 0.15) {
      const broken: Ship[] = ships.map((s, i) => (i === 0 ? { ...s, x: ruleset.width } : s));
      const decision = decide(live.state, { type: 'place', seat, ships: broken });
      if (!decision.ok) {
        const raw = `{"type":"placement","rid":${live.rid},"ships":[${JSON.stringify(broken[0])},…]}`;
        if (this.infraction(seat, decision.error.code, decision.error.message, raw, ms)) return false;
        live.rid++;
      }
    }
    const decision = decide(live.state, { type: 'place', seat, ships });
    if (!decision.ok) throw new Error(`simulated program produced an illegal placement: ${decision.error.message}`);
    this.push({ ...(decision.events[0] as Extract<GameEvent, { type: 'placed' }>), ms });
    return true;
  }

  /** Records an infraction; returns true if it ended the game. */
  private infraction(seat: Seat, code: string, message: string, raw: string, ms: number): boolean {
    const live = this.live as LiveGame;
    live.strikes[seat]++;
    this.push({ type: 'infraction', seat, code, message, strikes: live.strikes[seat], raw, ms });
    if (live.strikes[seat] >= PLATFORM_CONSTANTS.maxStrikes) {
      this.forfeit(seat, 'strikes');
      return true;
    }
    return false;
  }

  private forfeit(seat: Seat, reason: 'timeout' | 'strikes' | 'disconnect'): void {
    const live = this.live as LiveGame;
    const decision = decide(live.state, { type: 'forfeit', seat, reason });
    if (decision.ok) for (const e of decision.events) this.push(e);
  }

  private move(): void {
    const live = this.live as LiveGame;
    const { ruleset } = this.lobby;
    const state = live.state;
    const seat = state.turn as Seat;
    const rec = this.lobby.seats[seat - 1] as SeatRec;
    const { brain, fault } = rec.profile;
    const rng = live.rng;
    const ms = thinkMs(rng, brain);
    const roll = rng();
    live.rid++;

    if (fault === 'timeout' && roll < 0.02) {
      this.push({
        type: 'infraction',
        seat,
        code: 'timeout',
        message: `No reply within ${PLATFORM_CONSTANTS.moveTimeoutMs} ms.`,
        strikes: live.strikes[seat],
        ms: PLATFORM_CONSTANTS.moveTimeoutMs,
      });
      this.forfeit(seat, 'timeout');
      return;
    }
    if (fault === 'crash' && roll < 0.015) {
      rec.connection = 'grace';
      rec.graceEndsAt = this.host.now() + PLATFORM_CONSTANTS.graceMs;
      addNote(rec, this.host.now(), 'note', 'Connection lost (no pong within 30 s). Resume window started.');
      this.host.changed();
      this.host.emit(this.lobby.id, true);
      return;
    }
    if (fault === 'bad_shape' && roll < 0.06) {
      const raw = `{"type":"fire","rid":${live.rid},"x":"${randInt(rng, ruleset.width)}","y":${randInt(rng, ruleset.height)}}`;
      this.infraction(seat, 'bad_shape', 'Reply does not match the schema for "fire": x must be an integer.', raw, ms);
      return;
    }
    let cell = createBrain(brain).fire(ruleset, seatView(state, seat), rng);
    if ((fault === 'invalid_moves' && roll < 0.08) || (fault === 'repeat_shots' && roll < 0.06)) {
      const previous = state.shots[seat];
      if (previous.length > 0 && (fault === 'repeat_shots' || rng() < 0.5)) {
        cell = previous[randInt(rng, previous.length)] as { x: number; y: number };
      } else {
        cell = { x: ruleset.width + randInt(rng, 3), y: randInt(rng, ruleset.height) };
      }
    }
    const decision = decide(state, { type: 'fire', seat, x: cell.x, y: cell.y });
    if (!decision.ok) {
      const raw = `{"type":"fire","rid":${live.rid},"x":${cell.x},"y":${cell.y}}`;
      this.infraction(seat, decision.error.code, decision.error.message, raw, ms);
      return;
    }
    const [first, ...rest] = decision.events;
    this.push({ ...(first as Extract<GameEvent, { type: 'shot' }>), ms });
    for (const e of rest) this.push(e);
  }

  private endGame(): void {
    const live = this.live as LiveGame;
    const series = this.series() as SeriesRec;
    const { rec, state } = live;
    const now = this.host.now();
    rec.status = 'over';
    rec.winner = state.winner;
    rec.reason = state.endReason;
    rec.endedAt = now;
    rec.summary = summarizeGame(rec.index, state, rec.events ?? []);
    series.summaries.push(rec.summary);
    series.played++;
    if (state.winner) series.score[state.winner]++;
    addGameToHeatmap(series.heatmap, state);
    this.lobby.lastActivityAt = now;
    this.live = null;
    const kept = this.lobby.games.filter((g) => g.events !== null);
    for (const old of kept.slice(0, Math.max(0, kept.length - MOCK_KEPT_GAMES))) old.events = null;
    if (series.played >= series.target) {
      series.status = 'done';
      series.endedAt = now;
      this.host.emit(this.lobby.id, true);
    }
    this.host.changed();
  }

  private giveUp(seat: SeatRec): void {
    const series = this.series() as SeriesRec;
    const now = this.host.now();
    addNote(seat, now, 'note', 'Resume window expired.');
    seat.connection = 'disconnected';
    seat.graceEndsAt = null;
    if (series.target === 1 && this.live && this.live.state.phase !== 'over') {
      this.forfeit(seat.seat, 'disconnect');
      this.endGame();
    } else {
      this.voidLive();
      series.status = 'aborted';
      series.abortReason = `${seat.owner.name}'s program did not reconnect within ${PLATFORM_CONSTANTS.graceMs / 1000} s.`;
      series.endedAt = now;
    }
    for (const s of this.lobby.seats) if (s.connection === 'grace') s.connection = 'disconnected';
    this.host.changed();
    this.host.emit(this.lobby.id, true);
  }
}

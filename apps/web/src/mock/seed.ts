import { CLASSIC_10X10, emptyHeatmap, type Ruleset, type Seat } from '@bsc/engine';
import type { BotKind } from '@bsc/bots';
import { generateLobbyCode } from '@bsc/protocol';
import { LobbyRunner, type RunnerHost } from './runner';
import {
  addNote,
  PLATFORM_CONSTANTS,
  type Fault,
  type LobbyRec,
  type MockState,
  type ParticipantRec,
  type SeatRec,
  type SeriesRec,
} from './state';
import { newToken } from './util';

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

export const MOCK_SHARED_PASSWORD = 'battleship';
export const MOCK_ADMIN = { username: 'admin', password: 'admin' };

export function createSeedState(now: number): MockState {
  const state: MockState = {
    version: 1,
    sharedPassword: MOCK_SHARED_PASSWORD,
    admin: MOCK_ADMIN,
    settings: { allowGodMode: true, maxBatterySize: 1000, defaultRulesetId: 'classic-10x10' },
    participants: [],
    rulesets: [],
    lobbies: [],
    audit: [],
    counter: 100,
  };

  const person = (id: string, name: string, daysAgo: number): ParticipantRec => ({
    id,
    name,
    token: newToken(),
    tokenCreatedAt: now - (daysAgo - 0.1) * DAY,
    tokenReplaced: false,
    tokenNotice: null,
    createdAt: now - daysAgo * DAY,
  });
  state.participants.push(person('p_alice', 'Alice', 6), person('p_bruno', 'Bruno', 6), person('p_chen', 'Chen', 5), person('p_dana', 'Dana', 5));

  const bruno0 = state.participants.find((x) => x.id === 'p_bruno');
  if (bruno0) {
    bruno0.tokenCreatedAt = now - 2 * DAY;
    bruno0.tokenReplaced = true;
  }

  const ruleset = (over: Partial<Ruleset>): Ruleset => ({ ...CLASSIC_10X10, ...over });
  const quick = ruleset({
    id: 'quick-8x8',
    description: 'Small and fast: 8x8, fleet 4/3/3/2, no extra turn on hit.',
    width: 8,
    height: 8,
    fleet: [4, 3, 3, 2],
    extraTurnOnHit: false,
  });
  const touching = ruleset({
    id: 'classic-10x10-touching',
    description: 'Classic, but ships may touch. Sunk ships still announced.',
    touching: true,
  });
  const noReveal = ruleset({
    id: 'strict-10x10',
    description: 'Repeated shots waste the turn; the opponent layout is not revealed after a game.',
    repeatShot: 'waste',
    revealOnGameOver: false,
  });
  state.rulesets.push(
    { ruleset: quick, enabled: true, createdAt: now - 6 * DAY },
    { ruleset: touching, enabled: true, createdAt: now - 5 * DAY },
    { ruleset: noReveal, enabled: false, createdAt: now - 4 * DAY },
    { ruleset: CLASSIC_10X10, enabled: true, createdAt: now - 2 * DAY },
  );

  const host: RunnerHost = {
    now: () => Date.now(),
    speed: () => 'instant',
    emit: () => undefined,
    changed: () => undefined,
    nextId: (prefix) => `${prefix}_${(state.counter++).toString(36)}`,
  };

  const seat = (
    n: Seat,
    who: ParticipantRec | { bot: BotKind; name: string },
    brain: BotKind = 'hunt-target',
    fault: Fault = 'none',
  ): SeatRec => {
    const isBot = 'bot' in who;
    return {
      seat: n,
      owner: isBot
        ? { kind: 'bot', bot: who.bot, name: who.name }
        : { kind: 'participant', participantId: who.id, name: who.name },
      connection: isBot ? 'connected' : 'disconnected',
      program: isBot ? { name: `practice-${who.bot}`, version: '1' } : null,
      graceEndsAt: null,
      latencyMs: isBot ? 0 : null,
      lastSeenAt: isBot ? now : null,
      profile: { brain: isBot ? who.bot : brain, fault },
      notes: [],
    };
  };

  const [alice, bruno, chen, dana] = state.participants as [ParticipantRec, ParticipantRec, ParticipantRec, ParticipantRec];

  const makeLobby = (
    rules: Ruleset,
    s1: SeatRec,
    s2: SeatRec,
    createdBy: ParticipantRec,
    godMode: boolean,
    ageMs: number,
  ): LobbyRec => {
    const lobby: LobbyRec = {
      id: generateLobbyCode(),
      rulesetId: rules.id,
      ruleset: rules,
      godMode,
      createdAt: now - ageMs,
      createdBy: createdBy.id,
      seats: [s1, s2],
      seriesList: [],
      games: [],
      lastActivityAt: now - ageMs,
    };
    state.lobbies.push(lobby);
    return lobby;
  };

  /** Plays a battery synchronously, then moves its timestamps `ageMs` into the past. */
  const play = (lobby: LobbyRec, target: number, ageMs: number, untilPlayed?: number, abort?: string): void => {
    for (const s of lobby.seats) s.connection = 'connected';
    const series: SeriesRec = {
      id: host.nextId('s'),
      target,
      played: 0,
      score: { 1: 0, 2: 0 },
      status: 'running',
      abortReason: null,
      startedAt: Date.now(),
      endedAt: null,
      summaries: [],
      heatmap: emptyHeatmap(lobby.ruleset),
    };
    lobby.seriesList.push(series);
    const firstGame = lobby.games.length;
    const runner = new LobbyRunner(lobby, host);
    runner.runToCompletion(untilPlayed);
    if (abort) {
      runner.voidLive();
      series.status = 'aborted';
      series.abortReason = abort;
      series.endedAt = Date.now();
    }
    const delta = ageMs;
    series.startedAt -= delta;
    if (series.endedAt) series.endedAt -= delta;
    for (const g of lobby.games.slice(firstGame)) {
      g.startedAt -= delta;
      if (g.endedAt) g.endedAt -= delta;
      g.times = g.times.map((t) => t - delta);
    }
    lobby.lastActivityAt = Date.now() - delta;
    for (const s of lobby.seats) {
      if (s.owner.kind === 'participant') {
        s.connection = 'disconnected';
        s.lastSeenAt = lobby.lastActivityAt;
        s.program = { name: `sim-${s.profile.brain}`, version: '0.1.0' };
      }
    }
  };

  // A: Alice (hunt-target) vs Bruno (random): a finished battery plus a single game after it.
  const a = makeLobby(CLASSIC_10X10, seat(1, alice), seat(2, bruno, 'random'), alice, true, 3 * DAY);
  play(a, 50, 3 * DAY - HOUR);
  play(a, 1, 30 * 60 * 1000);
  addNote(a.seats[0], now - 30 * 60 * 1000, 'note', 'Connection closed by the program.');

  // B: Alice against herself.
  const b = makeLobby(CLASSIC_10X10, seat(1, alice), seat(2, alice, 'random'), alice, true, 2 * DAY);
  play(b, 1, 2 * DAY - 2 * HOUR);

  // C: Bruno vs Dana, restricted view; Dana's program makes mistakes.
  const c = makeLobby(quick, seat(1, bruno), seat(2, dana, 'random', 'invalid_moves'), bruno, false, DAY);
  play(c, 20, DAY - HOUR);

  // D: Chen vs Dana, restricted, aborted halfway because a program never came back.
  const d = makeLobby(touching, seat(1, chen), seat(2, dana, 'hunt-target', 'crash'), chen, false, 3 * HOUR);
  play(d, 30, 70 * 60 * 1000, 12, "Dana's program did not reconnect within 60 s.");
  d.seats[1].profile.fault = 'none';

  // E: Alice against a practice bot, nothing played yet.
  makeLobby(
    CLASSIC_10X10,
    seat(1, alice),
    seat(2, { bot: 'hunt-target', name: 'Practice bot: Hunt & target' }),
    alice,
    true,
    20 * 60 * 1000,
  );

  const audit = (at: number, actor: string, action: string, target: string | null = null, detail: string | null = null) =>
    state.audit.push({ id: host.nextId('a'), at, actor, action, target, detail });
  audit(now - 6 * DAY, 'admin:admin', 'participant_created', 'Alice');
  audit(now - 6 * DAY, 'admin:admin', 'ruleset_created', 'quick-8x8');
  audit(now - 3 * DAY, 'Alice', 'login');
  audit(now - 3 * DAY, 'Alice', 'lobby_created', a.id, 'ruleset classic-10x10, vs Bruno');
  audit(now - 3 * DAY, 'Alice', 'series_started', a.id, '50 games');
  audit(now - 6 * DAY + HOUR, 'Alice', 'token_created');
  audit(now - 6 * DAY + 2 * HOUR, 'Bruno', 'token_created');
  audit(now - 5 * DAY + HOUR, 'Chen', 'token_created');
  audit(now - 5 * DAY + 2 * HOUR, 'Dana', 'token_created');
  audit(now - 2 * DAY, 'Bruno', 'token_replaced');
  audit(now - 4 * HOUR, 'Chen', 'game_restarted', d.id);
  state.audit.sort((x, y) => x.at - y.at);
  void PLATFORM_CONSTANTS;
  return state;
}

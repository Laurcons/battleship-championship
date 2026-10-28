import {
  programShot,
  replay,
  seatView,
  apply,
  createGame,
  otherSeat,
  type GameEvent,
  type GameState,
  type Seat,
  type Shot,
} from '@bsc/engine';
import type { Frame } from '../api/types';
import { PLATFORM_CONSTANTS, type GameRec, type LobbyRec } from './state';

const MAX_FRAMES = 2000;

const j = (value: unknown): string => JSON.stringify(value);

function shotMsg(state: GameState, shot: Shot) {
  const s = programShot(state, shot);
  return s.len === undefined ? { x: s.x, y: s.y, result: s.result } : { x: s.x, y: s.y, result: s.result, len: s.len };
}

function gameInfo(game: GameRec, total: number, seat: Seat) {
  return { id: game.id, index: game.index, total, first: game.first === seat ? 'you' : 'opponent' };
}

/**
 * Reconstructs the frames the platform would have exchanged with the program on `seat`, from the
 * lobby's stored games (newest games only), plus the stored connection notes. The real platform
 * records the actual frames; the mock derives plausible ones from the same protocol.
 */
export function buildFrames(lobby: LobbyRec, seat: Seat): Frame[] {
  const frames: Frame[] = [...(lobby.seats[seat - 1]?.notes ?? [])];
  const opponent = lobby.seats[otherSeat(seat) - 1];
  const withEvents = lobby.games.filter((g) => g.events !== null);
  for (const game of withEvents.slice(-6)) frames.push(...gameFrames(lobby, game, seat, opponent?.owner.name ?? '?'));
  frames.sort((a, b) => a.at - b.at);
  return frames.slice(-MAX_FRAMES);
}

function gameFrames(lobby: LobbyRec, game: GameRec, seat: Seat, opponentName: string): Frame[] {
  const events = game.events as GameEvent[];
  const series = lobby.seriesList.find((s) => s.id === game.seriesId);
  const total = series?.target ?? 1;
  const out: Frame[] = [];
  const at = (i: number) => game.times[i] ?? game.startedAt;
  const opponentSeat = lobby.seats[otherSeat(seat) - 1];
  let state = createGame(lobby.ruleset, game.first);
  let rid = 0;
  let pendingTurn = false;
  let lastShotIdx = -1; // index of this seat's most recent shot event
  let incomingSince = 0; // index into events after which opponent shots count as "incoming"

  const sendTurn = (i: number, error: { code: string; message: string } | null, strikes: number) => {
    rid++;
    const view = seatView(state, seat);
    const mine = state.shots[seat];
    const last = lastShotIdx >= 0 ? mine[mine.length - 1] : undefined;
    const incoming = events
      .slice(incomingSince, i)
      .filter((e): e is Extract<GameEvent, { type: 'shot' }> => e.type === 'shot' && e.seat !== seat)
      .map((e) => shotMsg(state, e));
    out.push({
      at: at(i),
      dir: 'to_program',
      text: j({
        type: 'turn',
        rid,
        deadline_ms: PLATFORM_CONSTANTS.moveTimeoutMs,
        game: gameInfo(game, total, seat),
        you: view.you,
        enemy: view.enemy,
        enemy_remaining: view.enemyRemaining,
        last_shot: last ? shotMsg(state, last) : null,
        incoming,
        error,
        strikes,
      }),
    });
    pendingTurn = true;
  };

  out.push({
    at: game.startedAt,
    dir: 'to_program',
    text: j({
      type: 'place',
      rid: ++rid,
      deadline_ms: PLATFORM_CONSTANTS.placeTimeoutMs,
      game: gameInfo(game, total, seat),
      opponent: { name: opponentName, program: opponentSeat?.program ?? null },
      error: null,
    }),
  });

  events.forEach((event, i) => {
    if (event.type === 'placed') {
      if (event.seat === seat) out.push({ at: at(i), dir: 'from_program', text: j({ type: 'placement', rid, ships: event.ships }) });
    } else if (event.type === 'shot') {
      if (event.seat === seat) {
        if (!pendingTurn) sendTurn(i, null, 0);
        out.push({ at: at(i), dir: 'from_program', text: j({ type: 'fire', rid, x: event.x, y: event.y }) });
        pendingTurn = false;
        lastShotIdx = i;
        incomingSince = i + 1;
      }
    } else if (event.type === 'infraction') {
      if (event.seat === seat) {
        if (!pendingTurn && event.code !== 'timeout') sendTurn(i, null, 0);
        if (event.raw) out.push({ at: at(i), dir: 'from_program', text: event.raw });
        else out.push({ at: at(i), dir: 'note', text: `No reply received (${event.message})` });
        out.push({
          at: at(i),
          dir: 'note',
          text: `Infraction "${event.code}": ${event.message} Strike ${event.strikes}/${PLATFORM_CONSTANTS.maxStrikes}.`,
        });
        pendingTurn = false;
        const next = events[i + 1];
        const ends = next && (next.type === 'forfeit' || next.type === 'game_over');
        if (!ends && event.code !== 'timeout') sendTurn(i, { code: event.code, message: event.message }, event.strikes);
      }
    } else if (event.type === 'game_over') {
      const final = replay(lobby.ruleset, game.first, events);
      const wins = (s: Seat) => series?.summaries.filter((x) => x.index <= game.index && x.winner === s).length ?? 0;
      const lastMine = final.shots[seat].at(-1);
      const incoming = events
        .slice(incomingSince)
        .filter((e): e is Extract<GameEvent, { type: 'shot' }> => e.type === 'shot' && e.seat !== seat)
        .map((e) => shotMsg(final, e));
      out.push({
        at: at(i),
        dir: 'to_program',
        text: j({
          type: 'game_over',
          game: { id: game.id, index: game.index, total },
          winner: event.winner === seat ? 'you' : 'opponent',
          reason: event.reason,
          last_shot: lastMine && lastShotIdx >= 0 ? shotMsg(final, lastMine) : null,
          incoming,
          series: { score: { you: wins(seat), opponent: wins(otherSeat(seat)) }, done: game.index >= total },
          reveal: lobby.ruleset.revealOnGameOver
            ? {
                opponent_ships: final.ships[otherSeat(seat)],
                opponent_shots: final.shots[otherSeat(seat)].map((s) => shotMsg(final, s)),
              }
            : null,
        }),
      });
    }
    state = apply(state, event);
  });
  return out;
}

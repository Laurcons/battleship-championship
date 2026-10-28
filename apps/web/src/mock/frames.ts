import { apply, createGame, otherSeat, replay, type GameEvent, type Seat } from '@bsc/engine';
import { gameOverFrame, placeFrame, turnFrame } from '@bsc/protocol';
import type { FrameError } from '@bsc/protocol';
import type { Frame } from '../api/types';
import { PLATFORM_CONSTANTS, type GameRec, type LobbyRec } from './state';

const MAX_FRAMES = 2000;

const j = (value: unknown): string => JSON.stringify(value);

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

  const sendTurn = (i: number, error: { code: string; message: string } | null, strikes: number) => {
    rid++;
    out.push({
      at: at(i),
      dir: 'to_program',
      text: j(
        turnFrame({
          rid,
          deadlineMs: PLATFORM_CONSTANTS.moveTimeoutMs,
          game: { id: game.id, index: game.index, total },
          seat,
          state,
          events: events.slice(0, i),
          error: error as FrameError | null,
          strikes,
        }),
      ),
    });
    pendingTurn = true;
  };

  out.push({
    at: game.startedAt,
    dir: 'to_program',
    text: j(
      placeFrame({
        rid: ++rid,
        deadlineMs: PLATFORM_CONSTANTS.placeTimeoutMs,
        game: { id: game.id, index: game.index, total, first: game.first },
        seat,
        opponent: { name: opponentName, program: opponentSeat?.program ?? null },
        error: null,
        strikes: 0,
      }),
    ),
  });

  events.forEach((event, i) => {
    if (event.type === 'placed') {
      if (event.seat === seat) out.push({ at: at(i), dir: 'from_program', text: j({ type: 'placement', rid, ships: event.ships }) });
    } else if (event.type === 'shot') {
      if (event.seat === seat) {
        if (!pendingTurn) sendTurn(i, null, 0);
        out.push({ at: at(i), dir: 'from_program', text: j({ type: 'fire', rid, x: event.x, y: event.y }) });
        pendingTurn = false;
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
      out.push({
        at: at(i),
        dir: 'to_program',
        text: j(
          gameOverFrame({
            game: { id: game.id, index: game.index, total },
            seat,
            state: final,
            events,
            winner: event.winner,
            reason: event.reason,
            score: { 1: wins(1), 2: wins(2) },
            done: game.index >= total,
          }),
        ),
      });
    }
    state = apply(state, event);
  });
  return out;
}

import type { GameDetail, LobbySummary, Seat, ViewEvent } from '../api/types';

export type EventKind = 'placed' | 'shot' | 'infraction' | 'end';

export interface EventDescription {
  kind: EventKind;
  /** Bootstrap icon name. */
  icon: string;
  seat: Seat | null;
  text: string;
  /** True for events that point at a bug in a program (shown highlighted). */
  problem: boolean;
  /** Extra detail, e.g. the raw frame of an infraction. */
  detail?: string;
}

export const seatName = (lobby: LobbySummary, seat: Seat): string => lobby.seats[seat - 1]?.owner.name ?? `Seat ${seat}`;

export function describeEvent(event: ViewEvent, lobby: LobbySummary): EventDescription {
  const who = (seat: Seat) => seatName(lobby, seat);
  switch (event.type) {
    case 'placed':
      return {
        kind: 'placed',
        icon: 'grid-3x3-gap',
        seat: event.seat,
        text: `${who(event.seat)} placed their fleet`,
        problem: false,
      };
    case 'shot': {
      const at = `(${event.x},${event.y})`;
      const text =
        event.result === 'miss'
          ? `${who(event.seat)} fired at ${at}: miss`
          : event.result === 'hit'
            ? `${who(event.seat)} fired at ${at}: hit`
            : event.result === 'sunk'
              ? `${who(event.seat)} fired at ${at}: sunk a ship${event.len ? ` (length ${event.len})` : ''}`
              : `${who(event.seat)} fired at ${at} again: repeated shot, turn lost`;
      return { kind: 'shot', icon: 'crosshair', seat: event.seat, text, problem: event.result === 'repeat' };
    }
    case 'infraction':
      return {
        kind: 'infraction',
        icon: 'exclamation-triangle-fill',
        seat: event.seat,
        text: `${who(event.seat)}: ${event.code} (strike ${event.strikes})`,
        problem: true,
        detail: event.raw ? `${event.message} Received: ${event.raw}` : event.message,
      };
    case 'forfeit':
      return {
        kind: 'end',
        icon: 'flag-fill',
        seat: event.seat,
        text: `${who(event.seat)} forfeited (${event.reason})`,
        problem: true,
      };
    case 'game_over':
      return {
        kind: 'end',
        icon: 'trophy-fill',
        seat: event.winner,
        text: `Game over: ${who(event.winner)} wins (${event.reason === 'sunk' ? 'all ships sunk' : event.reason})`,
        problem: false,
      };
  }
}

/** The cell a move points at and the board it landed on, for highlighting. */
export function eventTarget(event: ViewEvent): { owner: Seat; x: number; y: number } | null {
  if (event.type !== 'shot') return null;
  return { owner: event.seat === 1 ? 2 : 1, x: event.x, y: event.y };
}

export function gameTitle(game: Pick<GameDetail, 'index'>): string {
  return `Game ${game.index}`;
}

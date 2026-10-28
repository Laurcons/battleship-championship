import { cellKey, shipCells } from './geometry.js';
import { sunkShipLengths } from './game.js';
import { otherSeat, type GameState, type Seat, type Shot } from './types.js';

/**
 * Renders the board of `owner` as row strings (see docs/protocol-v1.md, section 2).
 * `.` water/unknown, `o` miss, `S` intact ship (only if `revealShips`), `x` hit, `#` sunk ship cell
 * (only if `markSunk`).
 */
export function renderBoard(
  state: GameState,
  owner: Seat,
  options: { revealShips: boolean; markSunk: boolean },
): string[] {
  const { width, height } = state.rules;
  const ships = state.ships[owner] ?? [];
  const shotsAtOwner = state.shots[otherSeat(owner)];
  const shotAt = new Map<number, Shot>();
  for (const s of shotsAtOwner) if (s.result !== 'repeat') shotAt.set(cellKey(s.x, s.y), s);

  const shipAt = new Map<number, number>();
  ships.forEach((ship, i) => shipCells(ship).forEach((c) => shipAt.set(cellKey(c.x, c.y), i)));
  const sunkIdx = new Set<number>();
  if (options.markSunk) {
    ships.forEach((ship, i) => {
      if (shipCells(ship).every((c) => shotAt.has(cellKey(c.x, c.y)))) sunkIdx.add(i);
    });
  }

  const rows: string[] = [];
  for (let y = 0; y < height; y++) {
    let row = '';
    for (let x = 0; x < width; x++) {
      const key = cellKey(x, y);
      const ship = shipAt.get(key);
      const shot = shotAt.get(key);
      if (ship !== undefined && shot) row += sunkIdx.has(ship) ? '#' : 'x';
      else if (ship !== undefined) row += options.revealShips ? 'S' : '.';
      else if (shot) row += 'o';
      else row += '.';
    }
    rows.push(row);
  }
  return rows;
}

export interface SeatView {
  /** The seat's own board, ships visible. */
  you: string[];
  /** What the seat knows about the opponent's board. */
  enemy: string[];
  /** Lengths of the opponent's unsunk ships; null when sunk ships are not announced. */
  enemyRemaining: number[] | null;
}

/** Everything a program may know about the game: never includes the opponent's layout. */
export function seatView(state: GameState, seat: Seat): SeatView {
  const { announceSunk, fleet } = state.rules;
  let enemyRemaining: number[] | null = null;
  if (announceSunk) {
    enemyRemaining = [...fleet];
    for (const len of sunkShipLengths(state, otherSeat(seat))) {
      enemyRemaining.splice(enemyRemaining.indexOf(len), 1);
    }
    enemyRemaining.sort((a, b) => b - a);
  }
  return {
    you: renderBoard(state, seat, { revealShips: true, markSunk: false }),
    enemy: renderBoard(state, otherSeat(seat), { revealShips: false, markSunk: announceSunk }),
    enemyRemaining,
  };
}

/** Both boards with all ships visible and sunk ships marked, for god-mode viewers. */
export function godView(state: GameState): Record<Seat, string[]> {
  const options = { revealShips: true, markSunk: true };
  return { 1: renderBoard(state, 1, options), 2: renderBoard(state, 2, options) };
}

/** A shot as a program may see it: `sunk` is reported as `hit` unless sunk ships are announced. */
export function programShot(state: GameState, shot: Shot): Shot {
  if (shot.result !== 'sunk' || state.rules.announceSunk) return shot;
  return { x: shot.x, y: shot.y, result: 'hit' };
}

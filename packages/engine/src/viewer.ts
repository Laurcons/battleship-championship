import { cellKey, shipCells } from './geometry.js';
import type { EndReason, ForfeitReason, GameEvent, Ruleset, Seat, Ship, ShotResult } from './types.js';
import { otherSeat } from './types.js';

/**
 * A game event as shown to a viewer. Differs from `GameEvent` in that a seat's placement can be
 * hidden (`ships: null`), and a sunk shot may disclose the sunk ship.
 */
export type ViewEvent =
  | { type: 'placed'; seat: Seat; ships: Ship[] | null; ms?: number }
  | {
      type: 'shot';
      seat: Seat;
      x: number;
      y: number;
      result: ShotResult;
      len?: number;
      sunkShip?: Ship;
      ms?: number;
    }
  | {
      type: 'infraction';
      seat: Seat;
      code: string;
      message: string;
      strikes: number;
      raw?: string;
      ms?: number;
    }
  | { type: 'forfeit'; seat: Seat; reason: ForfeitReason }
  | { type: 'game_over'; winner: Seat; reason: EndReason };

/**
 * Board of each seat after the first `upTo` events, using only what the events disclose.
 * `.` water, `o` miss, `S` known intact ship, `x` hit, `#` cell of a sunk ship.
 * With full information this equals `godView` of the replayed state.
 */
export function deriveBoards(
  rules: Ruleset,
  events: readonly ViewEvent[],
  upTo: number = events.length,
): Record<Seat, string[]> {
  const known: Record<Seat, Ship[]> = { 1: [], 2: [] };
  const hitsAt: Record<Seat, Set<number>> = { 1: new Set(), 2: new Set() }; // keyed by board owner
  const missesAt: Record<Seat, Set<number>> = { 1: new Set(), 2: new Set() };
  const sunkCells: Record<Seat, Set<number>> = { 1: new Set(), 2: new Set() };

  for (const event of events.slice(0, upTo)) {
    if (event.type === 'placed' && event.ships) known[event.seat] = event.ships;
    if (event.type !== 'shot') continue;
    const owner = otherSeat(event.seat);
    const key = cellKey(event.x, event.y);
    if (event.result === 'miss') missesAt[owner].add(key);
    if (event.result === 'hit' || event.result === 'sunk') hitsAt[owner].add(key);
    if (event.sunkShip) for (const c of shipCells(event.sunkShip)) sunkCells[owner].add(cellKey(c.x, c.y));
  }

  const boards = { 1: [] as string[], 2: [] as string[] };
  for (const owner of [1, 2] as Seat[]) {
    const shipCellSet = new Map<number, Ship>();
    for (const ship of known[owner]) for (const c of shipCells(ship)) shipCellSet.set(cellKey(c.x, c.y), ship);
    for (const ship of known[owner]) {
      if (shipCells(ship).every((c) => hitsAt[owner].has(cellKey(c.x, c.y)))) {
        for (const c of shipCells(ship)) sunkCells[owner].add(cellKey(c.x, c.y));
      }
    }
    for (let y = 0; y < rules.height; y++) {
      let row = '';
      for (let x = 0; x < rules.width; x++) {
        const key = cellKey(x, y);
        if (sunkCells[owner].has(key)) row += '#';
        else if (hitsAt[owner].has(key)) row += 'x';
        else if (missesAt[owner].has(key)) row += 'o';
        else if (shipCellSet.has(key)) row += 'S';
        else row += '.';
      }
      boards[owner].push(row);
    }
  }
  return boards;
}

/**
 * Turns a full event log into what a viewer may see: if `hideSeats` lists seats, their placements
 * are hidden. Sunk shots disclose the ship only when `announceSunk`; otherwise they read as hits.
 */
export function redactEvents(
  rules: Ruleset,
  events: readonly GameEvent[],
  hideSeats: readonly Seat[],
  /** When true (a god-mode viewer), nothing about sunk ships is withheld. */
  seesAll: boolean,
): ViewEvent[] {
  const placed = new Map<Seat, Ship[]>();
  for (const e of events) if (e.type === 'placed') placed.set(e.seat, e.ships);
  return events.map((e): ViewEvent => {
    if (e.type === 'placed') return hideSeats.includes(e.seat) ? { ...e, ships: null } : e;
    if (e.type !== 'shot' || e.result !== 'sunk') return e;
    if (!seesAll && !rules.announceSunk) {
      const { len: _len, ...rest } = e;
      return { ...rest, result: 'hit' };
    }
    const owner = otherSeat(e.seat);
    const ship = placed
      .get(owner)
      ?.find((s) => s.len === e.len && shipCells(s).some((c) => c.x === e.x && c.y === e.y));
    return ship ? { ...e, sunkShip: ship } : e;
  });
}

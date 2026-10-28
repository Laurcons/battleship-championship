import { cellKey, inBounds, shipCells } from './geometry.js';
import { randInt, type Rng } from './rng.js';
import type { GameError, Ruleset, Ship } from './types.js';

const sortedLens = (lens: readonly number[]): string => [...lens].sort((a, b) => b - a).join(',');

function isShapeOk(ship: unknown): ship is Ship {
  if (typeof ship !== 'object' || ship === null) return false;
  const s = ship as Record<string, unknown>;
  return (
    Number.isInteger(s.len) &&
    Number.isInteger(s.x) &&
    Number.isInteger(s.y) &&
    (s.dir === 'h' || s.dir === 'v')
  );
}

/** Validates a full placement against the ruleset. Returns null when the placement is legal. */
export function validatePlacement(rules: Ruleset, ships: readonly Ship[]): GameError | null {
  if (!Array.isArray(ships) || !ships.every(isShapeOk)) {
    return { code: 'bad_fleet', message: 'Each ship must be {len, x, y, dir} with integer values.' };
  }
  if (sortedLens(ships.map((s) => s.len)) !== sortedLens(rules.fleet)) {
    return {
      code: 'bad_fleet',
      message: `Fleet must have exactly these ship lengths: ${sortedLens(rules.fleet)}.`,
    };
  }
  const owner = new Map<number, number>();
  for (const [index, ship] of ships.entries()) {
    for (const { x, y } of shipCells(ship)) {
      if (!inBounds(x, y, rules.width, rules.height)) {
        return {
          code: 'ship_out_of_bounds',
          message: `Ship ${index} (len ${ship.len}) leaves the ${rules.width}x${rules.height} board.`,
        };
      }
      if (owner.has(cellKey(x, y))) {
        return { code: 'ships_overlap', message: `Ships overlap at (${x},${y}).` };
      }
      owner.set(cellKey(x, y), index);
    }
  }
  if (!rules.touching) {
    for (const [key, index] of owner) {
      const x = key % 1000;
      const y = Math.floor(key / 1000);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const other = owner.get(cellKey(x + dx, y + dy));
          if (other !== undefined && other !== index) {
            return {
              code: 'ships_touching',
              message: `Ships touch near (${x},${y}); this ruleset forbids touching (diagonals included).`,
            };
          }
        }
      }
    }
  }
  return null;
}

/** Random legal placement, or null if none was found within the attempt budget. */
export function randomPlacement(rules: Ruleset, rng: Rng, attempts = 200): Ship[] | null {
  const lens = [...rules.fleet].sort((a, b) => b - a);
  for (let attempt = 0; attempt < attempts; attempt++) {
    const ships: Ship[] = [];
    let failed = false;
    for (const len of lens) {
      let placed = false;
      for (let tries = 0; tries < 100 && !placed; tries++) {
        const dir = rng() < 0.5 ? 'h' : 'v';
        const x = randInt(rng, rules.width - (dir === 'h' ? len - 1 : 0));
        const y = randInt(rng, rules.height - (dir === 'v' ? len - 1 : 0));
        const candidate = [...ships, { len, x, y, dir } as Ship];
        if (partialPlacementOk(rules, candidate)) {
          ships.push({ len, x, y, dir });
          placed = true;
        }
      }
      if (!placed) {
        failed = true;
        break;
      }
    }
    if (!failed) return ships;
  }
  return null;
}

/** Overlap/touching check for an incomplete fleet (used while building a placement). */
function partialPlacementOk(rules: Ruleset, ships: readonly Ship[]): boolean {
  const last = ships[ships.length - 1] as Ship;
  const others = new Set<number>();
  for (const ship of ships.slice(0, -1)) {
    for (const c of shipCells(ship)) others.add(cellKey(c.x, c.y));
  }
  for (const { x, y } of shipCells(last)) {
    if (!inBounds(x, y, rules.width, rules.height)) return false;
    const reach = rules.touching ? 0 : 1;
    for (let dy = -reach; dy <= reach; dy++) {
      for (let dx = -reach; dx <= reach; dx++) {
        if (others.has(cellKey(x + dx, y + dy))) return false;
      }
    }
  }
  return true;
}

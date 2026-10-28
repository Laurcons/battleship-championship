import type { Ruleset } from './types.js';
import { randomPlacement } from './placement.js';
import { seededRng } from './rng.js';

export const CLASSIC_10X10: Ruleset = {
  id: 'classic-10x10',
  description: 'Classic Battleship: 10x10, fleet 5/4/3/3/2, ships may not touch, extra turn on hit.',
  width: 10,
  height: 10,
  fleet: [5, 4, 3, 3, 2],
  touching: false,
  extraTurnOnHit: true,
  announceSunk: true,
  repeatShot: 'invalid',
  revealOnGameOver: true,
};

export const RULESET_ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,39}$/;
export const MAX_BOARD_SIDE = 20;
export const MIN_BOARD_SIDE = 5;
export const MAX_FLEET_SIZE = 10;

/** Returns human-readable problems; an empty array means the ruleset is acceptable. */
export function validateRuleset(rules: Ruleset): string[] {
  const problems: string[] = [];
  if (!RULESET_ID_PATTERN.test(rules.id)) {
    problems.push('id must be 3-40 characters: lowercase letters, digits and dashes.');
  }
  if (rules.description.length > 200) problems.push('description must be at most 200 characters.');
  for (const [name, value] of [
    ['width', rules.width],
    ['height', rules.height],
  ] as const) {
    if (!Number.isInteger(value) || value < MIN_BOARD_SIDE || value > MAX_BOARD_SIDE) {
      problems.push(`${name} must be an integer between ${MIN_BOARD_SIDE} and ${MAX_BOARD_SIDE}.`);
    }
  }
  if (rules.fleet.length < 1 || rules.fleet.length > MAX_FLEET_SIZE) {
    problems.push(`fleet must contain between 1 and ${MAX_FLEET_SIZE} ships.`);
  }
  const longest = Math.max(rules.width, rules.height);
  if (rules.fleet.some((len) => !Number.isInteger(len) || len < 1 || len > longest)) {
    problems.push('every ship length must be an integer between 1 and the longest board side.');
  }
  if (problems.length > 0) return problems;

  const area = rules.width * rules.height;
  const shipCellCount = rules.fleet.reduce((a, b) => a + b, 0);
  if (shipCellCount > area * 0.5) {
    problems.push('ships may cover at most half of the board.');
    return problems;
  }
  // Feasibility: a fleet that cannot be placed would make every game a protocol error.
  const rng = seededRng(1);
  for (let attempt = 0; attempt < 20; attempt++) {
    if (randomPlacement(rules, rng) !== null) return problems;
  }
  problems.push('the fleet could not be placed on this board with these rules.');
  return problems;
}

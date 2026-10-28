import { orthogonalNeighbours, randInt, randomPlacement, type Cell, type Rng, type Ruleset, type SeatView, type Ship } from '@bsc/engine';

export type BotKind = 'random' | 'hunt-target';

export const BOT_KINDS: readonly { kind: BotKind; label: string; description: string }[] = [
  { kind: 'random', label: 'Random', description: 'Fires at a random cell it has not tried yet.' },
  {
    kind: 'hunt-target',
    label: 'Hunt & target',
    description: 'Fires randomly until it hits, then probes the neighbouring cells.',
  },
];

/** A practice bot: stateless, deciding only from what a program may know. */
export interface Brain {
  place(rules: Ruleset, rng: Rng): Ship[];
  fire(rules: Ruleset, view: SeatView, rng: Rng): Cell;
}

function unknownCells(view: SeatView): Cell[] {
  const cells: Cell[] = [];
  view.enemy.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (ch === '.') cells.push({ x, y });
    }),
  );
  return cells;
}

function pick<T>(items: readonly T[], rng: Rng): T {
  return items[randInt(rng, items.length)] as T;
}

function placeRandomly(rules: Ruleset, rng: Rng): Ship[] {
  const ships = randomPlacement(rules, rng);
  if (!ships) throw new Error(`cannot place the fleet for ruleset ${rules.id}`);
  return ships;
}

const randomBrain: Brain = {
  place: placeRandomly,
  fire: (_rules, view, rng) => pick(unknownCells(view), rng),
};

const huntTargetBrain: Brain = {
  place: placeRandomly,
  fire(rules, view, rng) {
    const width = rules.width;
    const height = rules.height;
    const targets: Cell[] = [];
    view.enemy.forEach((row, y) =>
      [...row].forEach((ch, x) => {
        if (ch !== 'x') return;
        for (const n of orthogonalNeighbours(x, y, width, height)) {
          if (view.enemy[n.y]?.[n.x] === '.') targets.push(n);
        }
      }),
    );
    // Prefer continuing a line of two or more hits over probing an isolated hit.
    const inLine = targets.filter((t) => {
      const dx = [-1, 1];
      return (
        dx.some((d) => view.enemy[t.y]?.[t.x + d] === 'x' && view.enemy[t.y]?.[t.x + 2 * d] === 'x') ||
        dx.some((d) => view.enemy[t.y + d]?.[t.x] === 'x' && view.enemy[t.y + 2 * d]?.[t.x] === 'x')
      );
    });
    if (inLine.length > 0) return pick(inLine, rng);
    if (targets.length > 0) return pick(targets, rng);
    return pick(unknownCells(view), rng);
  },
};

export function createBrain(kind: BotKind): Brain {
  return kind === 'random' ? randomBrain : huntTargetBrain;
}

import type { Ship } from './types.js';

export interface Cell {
  x: number;
  y: number;
}

export const cellKey = (x: number, y: number): number => y * 1000 + x;

export function shipCells(ship: Ship): Cell[] {
  const cells: Cell[] = [];
  for (let i = 0; i < ship.len; i++) {
    cells.push(ship.dir === 'h' ? { x: ship.x + i, y: ship.y } : { x: ship.x, y: ship.y + i });
  }
  return cells;
}

export function inBounds(x: number, y: number, width: number, height: number): boolean {
  return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < width && y < height;
}

/** The 4 orthogonal neighbours that lie on the board. */
export function orthogonalNeighbours(x: number, y: number, width: number, height: number): Cell[] {
  return [
    { x: x - 1, y },
    { x: x + 1, y },
    { x, y: y - 1 },
    { x, y: y + 1 },
  ].filter((c) => inBounds(c.x, c.y, width, height));
}

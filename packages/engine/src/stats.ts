import type { EndReason, GameEvent, GameState, Ruleset, Seat } from './types.js';
import { otherSeat } from './types.js';
import { shipCells } from './geometry.js';

export interface GameSummary {
  index: number;
  first: Seat;
  winner: Seat | null;
  reason: EndReason | null;
  /** Shots fired by each seat (repeats included). */
  shots: Record<Seat, number>;
  /** Infraction events recorded against each seat. */
  infractions: Record<Seat, number>;
  /** Sum and count of reported think times per seat. */
  think: Record<Seat, { totalMs: number; count: number }>;
}

export function summarizeGame(index: number, state: GameState, events: readonly GameEvent[]): GameSummary {
  const summary: GameSummary = {
    index,
    first: state.first,
    winner: state.winner,
    reason: state.endReason,
    shots: { 1: state.shots[1].length, 2: state.shots[2].length },
    infractions: { 1: 0, 2: 0 },
    think: { 1: { totalMs: 0, count: 0 }, 2: { totalMs: 0, count: 0 } },
  };
  for (const e of events) {
    if (e.type === 'infraction') summary.infractions[e.seat]++;
    if ((e.type === 'shot' || e.type === 'placed' || e.type === 'infraction') && e.ms !== undefined) {
      summary.think[e.seat].totalMs += e.ms;
      summary.think[e.seat].count++;
    }
  }
  return summary;
}

/** Wilson score interval for a binomial proportion. */
export function wilsonInterval(wins: number, n: number, z = 1.96): { low: number; high: number } {
  if (n === 0) return { low: 0, high: 1 };
  const p = wins / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { low: Math.max(0, centre - margin), high: Math.min(1, centre + margin) };
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? (sorted[mid] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

const mean = (values: readonly number[]): number | null =>
  values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;

export interface SeatStats {
  wins: number;
  winRate: number;
  winRateLow: number;
  winRateHigh: number;
  avgShotsToWin: number | null;
  medianShotsToWin: number | null;
  /** Index = number of shots fired in a won game; value = number of such games. */
  shotsHistogram: number[];
  /** Games started / won when moving first and when moving second. */
  asFirst: { played: number; wins: number };
  asSecond: { played: number; wins: number };
  forfeits: number;
  infractions: number;
  avgThinkMs: number | null;
}

export interface SeriesStats {
  played: number;
  seats: Record<Seat, SeatStats>;
  verdict: Seat | 'tie' | null;
  /** True when the 95% confidence interval of seat 1's win rate excludes 50%. */
  significant: boolean;
}

export function aggregateSeries(games: readonly GameSummary[], rules: Ruleset): SeriesStats {
  const decided = games.filter((g) => g.winner !== null);
  const seats = {} as Record<Seat, SeatStats>;
  for (const seat of [1, 2] as Seat[]) {
    const won = decided.filter((g) => g.winner === seat);
    const wonBySunk = won.filter((g) => g.reason === 'sunk');
    const shotsToWin = wonBySunk.map((g) => g.shots[seat]);
    const histogram = new Array<number>(rules.width * rules.height + 1).fill(0);
    for (const n of shotsToWin) histogram[n] = (histogram[n] ?? 0) + 1;
    const ci = wilsonInterval(won.length, decided.length);
    const first = decided.filter((g) => g.first === seat);
    const second = decided.filter((g) => g.first === otherSeat(seat));
    const thinkTotal = games.reduce((a, g) => a + g.think[seat].totalMs, 0);
    const thinkCount = games.reduce((a, g) => a + g.think[seat].count, 0);
    seats[seat] = {
      wins: won.length,
      winRate: decided.length ? won.length / decided.length : 0,
      winRateLow: ci.low,
      winRateHigh: ci.high,
      avgShotsToWin: mean(shotsToWin),
      medianShotsToWin: median(shotsToWin),
      shotsHistogram: histogram,
      asFirst: { played: first.length, wins: first.filter((g) => g.winner === seat).length },
      asSecond: { played: second.length, wins: second.filter((g) => g.winner === seat).length },
      forfeits: decided.filter((g) => g.winner === otherSeat(seat) && g.reason !== 'sunk').length,
      infractions: games.reduce((a, g) => a + g.infractions[seat], 0),
      avgThinkMs: thinkCount ? thinkTotal / thinkCount : null,
    };
  }
  const ci1 = wilsonInterval(seats[1].wins, decided.length);
  let verdict: SeriesStats['verdict'] = null;
  if (decided.length > 0) {
    verdict = seats[1].wins === seats[2].wins ? 'tie' : seats[1].wins > seats[2].wins ? 1 : 2;
  }
  return {
    played: decided.length,
    seats,
    verdict,
    significant: decided.length > 0 && (ci1.low > 0.5 || ci1.high < 0.5),
  };
}

/** Per-cell counts of shots and ship placements, for each seat. */
export interface Heatmap {
  width: number;
  height: number;
  games: number;
  /** Shots fired BY the seat, per cell. */
  shots: Record<Seat, number[][]>;
  /** Ship cells placed BY the seat, per cell. */
  placements: Record<Seat, number[][]>;
}

const grid = (w: number, h: number): number[][] => Array.from({ length: h }, () => new Array<number>(w).fill(0));

export function emptyHeatmap(rules: Ruleset): Heatmap {
  const { width, height } = rules;
  return {
    width,
    height,
    games: 0,
    shots: { 1: grid(width, height), 2: grid(width, height) },
    placements: { 1: grid(width, height), 2: grid(width, height) },
  };
}

/** Adds one finished game to a heatmap (mutates and returns it). */
export function addGameToHeatmap(heat: Heatmap, state: GameState): Heatmap {
  heat.games++;
  for (const seat of [1, 2] as Seat[]) {
    for (const s of state.shots[seat]) {
      if (s.result !== 'repeat' && heat.shots[seat][s.y]) (heat.shots[seat][s.y] as number[])[s.x]!++;
    }
    for (const ship of state.ships[seat] ?? []) {
      for (const c of shipCells(ship)) (heat.placements[seat][c.y] as number[])[c.x]!++;
    }
  }
  return heat;
}

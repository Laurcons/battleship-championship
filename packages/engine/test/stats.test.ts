import { describe, expect, it } from 'vitest';
import {
  addGameToHeatmap,
  aggregateSeries,
  emptyHeatmap,
  median,
  summarizeGame,
  wilsonInterval,
  type GameSummary,
} from '../src/index.js';
import { playRandomGame, rules } from './helpers.js';

const summary = (over: Partial<GameSummary>): GameSummary => ({
  index: 1,
  first: 1,
  winner: 1,
  reason: 'sunk',
  shots: { 1: 40, 2: 50 },
  infractions: { 1: 0, 2: 0 },
  think: { 1: { totalMs: 0, count: 0 }, 2: { totalMs: 0, count: 0 } },
  ...over,
});

describe('wilsonInterval', () => {
  it('matches known values', () => {
    const ci = wilsonInterval(50, 100);
    expect(ci.low).toBeCloseTo(0.4038, 3);
    expect(ci.high).toBeCloseTo(0.5962, 3);
    const edge = wilsonInterval(10, 10);
    expect(edge.high).toBe(1);
    expect(edge.low).toBeCloseTo(0.7225, 3);
  });
  it('is the whole range with no data', () => {
    expect(wilsonInterval(0, 0)).toEqual({ low: 0, high: 1 });
  });
});

describe('median', () => {
  it('handles odd, even and empty inputs', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe('aggregateSeries', () => {
  const r = rules();

  it('counts wins, win rates, first/second mover splits and the verdict', () => {
    const games = [
      summary({ index: 1, first: 1, winner: 1, shots: { 1: 40, 2: 55 } }),
      summary({ index: 2, first: 2, winner: 1, shots: { 1: 44, 2: 60 } }),
      summary({ index: 3, first: 1, winner: 2, shots: { 1: 70, 2: 50 } }),
      summary({ index: 4, first: 2, winner: 1, reason: 'timeout', shots: { 1: 10, 2: 9 } }),
    ];
    const stats = aggregateSeries(games, r);
    expect(stats.played).toBe(4);
    expect(stats.seats[1].wins).toBe(3);
    expect(stats.seats[2].wins).toBe(1);
    expect(stats.verdict).toBe(1);
    expect(stats.seats[1].avgShotsToWin).toBe(42); // forfeit wins excluded
    expect(stats.seats[1].shotsHistogram[40]).toBe(1);
    expect(stats.seats[1].asFirst).toEqual({ played: 2, wins: 1 });
    expect(stats.seats[1].asSecond).toEqual({ played: 2, wins: 2 });
    expect(stats.seats[2].forfeits).toBe(1);
    expect(stats.significant).toBe(false);
  });

  it('reports a tie and ignores voided (winnerless) games', () => {
    const games = [summary({ winner: 1 }), summary({ index: 2, winner: 2 }), summary({ index: 3, winner: null, reason: null })];
    const stats = aggregateSeries(games, r);
    expect(stats.played).toBe(2);
    expect(stats.verdict).toBe('tie');
  });

  it('flags significance for a lopsided battery', () => {
    const games = Array.from({ length: 100 }, (_, i) => summary({ index: i + 1, winner: i < 70 ? 1 : 2 }));
    expect(aggregateSeries(games, r).significant).toBe(true);
  });

  it('has no verdict without games', () => {
    expect(aggregateSeries([], r)).toMatchObject({ played: 0, verdict: null, significant: false });
  });
});

describe('summarizeGame and heatmap', () => {
  it('summarizes a played game consistently', () => {
    const { final, events } = playRandomGame(rules(), 99);
    const s = summarizeGame(1, final, events);
    expect(s.winner).toBe(final.winner);
    expect(s.shots[1] + s.shots[2]).toBe(final.shots[1].length + final.shots[2].length);
  });

  it('counts each placed ship cell and each non-repeat shot once', () => {
    const { final } = playRandomGame(rules(), 4);
    const heat = addGameToHeatmap(emptyHeatmap(rules()), final);
    const sum = (g: number[][]) => g.flat().reduce((a, b) => a + b, 0);
    expect(heat.games).toBe(1);
    expect(sum(heat.placements[1])).toBe(17);
    expect(sum(heat.shots[1])).toBe(final.shots[1].length);
  });
});

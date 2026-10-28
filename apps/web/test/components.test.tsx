import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CLASSIC_10X10, createGame, step, type GameEvent, type Seat } from '@bsc/engine';
import { Board } from '../src/components/Board';
import { GameViewer } from '../src/components/GameViewer';
import { MoveList } from '../src/components/MoveList';
import type { GameDetail, LobbySummary, ViewEvent } from '../src/api/types';

const lobby = {
  id: 'ABCD-EFGH-1',
  seats: [
    { seat: 1, owner: { kind: 'participant', participantId: 'a', name: 'Alice' } },
    { seat: 2, owner: { kind: 'participant', participantId: 'b', name: 'Bruno' } },
  ],
  mySeats: [1],
} as unknown as LobbySummary;

/** Move items in chronological order (the list itself shows newest first). */
const chronological = () => [...screen.getAllByTestId('move-item')].reverse();

const row = (ch: string, n = 10) => ch.padEnd(n, '.');

describe('Board', () => {
  const rows = [row('Sox#'), ...Array.from({ length: 9 }, () => row(''))];

  it('draws every cell with an accessible state, plus axes', () => {
    render(<Board rows={rows} title="Alice's board" testId="b" />);
    const board = screen.getByTestId('b');
    expect(within(board).getAllByRole('gridcell')).toHaveLength(100);
    expect(board.querySelector('[data-cell="0,0"]')).toHaveAttribute('data-state', 'ship');
    expect(board.querySelector('[data-cell="1,0"]')).toHaveAttribute('data-state', 'miss');
    expect(board.querySelector('[data-cell="2,0"]')).toHaveAttribute('data-state', 'hit');
    expect(board.querySelector('[data-cell="3,0"]')).toHaveAttribute('data-state', 'sunk ship');
    expect(board.querySelector('[data-cell="9,9"]')).toHaveAttribute('data-state', 'water');
    expect(screen.getByLabelText('0,0: ship')).toBeInTheDocument();
  });

  it('does not rely on color alone: hits and sunk ships have symbols', () => {
    render(<Board rows={rows} testId="b" />);
    expect(screen.getByTestId('b').querySelector('[data-cell="2,0"]')).toHaveTextContent('✕');
    expect(screen.getByTestId('b').querySelector('[data-cell="3,0"]')).toHaveTextContent('▣');
  });

  it('highlights one cell', () => {
    render(<Board rows={rows} highlight={{ x: 4, y: 2 }} testId="b" />);
    const focused = screen.getByTestId('b').querySelectorAll('.cell-focus');
    expect(focused).toHaveLength(1);
    expect(focused[0]).toHaveAttribute('data-cell', '4,2');
  });

  it('adapts to non-square boards', () => {
    render(<Board rows={['.....', '.....', '.....']} testId="b" />);
    expect(within(screen.getByTestId('b')).getAllByRole('gridcell')).toHaveLength(15);
  });
});

const events: ViewEvent[] = [
  { type: 'placed', seat: 1, ships: [], ms: 2 },
  { type: 'shot', seat: 1, x: 3, y: 4, result: 'hit', ms: 4 },
  { type: 'infraction', seat: 2, code: 'already_fired', message: 'You already fired at (1,1).', strikes: 1, raw: '{"type":"fire","x":1,"y":1}', ms: 7 },
  { type: 'shot', seat: 2, x: 1, y: 1, result: 'repeat' },
  { type: 'shot', seat: 1, x: 3, y: 5, result: 'sunk', len: 2 },
  { type: 'forfeit', seat: 2, reason: 'strikes' },
  { type: 'game_over', winner: 1, reason: 'strikes' },
];

describe('MoveList', () => {
  it('describes every event and flags the ones that point to a bug', () => {
    render(<MoveList events={events} lobby={lobby} selected={0} onSelect={() => undefined} />);
    const items = chronological();
    expect(items).toHaveLength(7);
    expect(screen.getAllByTestId('move-item')[0]).toHaveAttribute('data-index', '6'); // newest on top
    expect(items[1]).toHaveTextContent('Alice fired at (3,4): hit');
    expect(items[2]).toHaveTextContent('Bruno: already_fired (strike 1)');
    expect(items[2]).toHaveTextContent('Received: {"type":"fire","x":1,"y":1}');
    expect(items[3]).toHaveTextContent('repeated shot, turn lost');
    expect(items[4]).toHaveTextContent('sunk a ship (length 2)');
    expect(items.map((i) => i.getAttribute('data-problem'))).toEqual(['false', 'false', 'true', 'true', 'false', 'true', 'false']);
    expect(items[1]).toHaveTextContent('4 ms');
  });

  it('reports the original index when clicking, also while filtered', async () => {
    const onSelect = vi.fn();
    render(<MoveList events={events} lobby={lobby} selected={0} onSelect={onSelect} />);
    await userEvent.click(chronological()[4]!);
    expect(onSelect).toHaveBeenLastCalledWith(4);
    await userEvent.click(screen.getByLabelText(/Only problems/));
    const shown = screen.getAllByTestId('move-item');
    expect(shown).toHaveLength(3);
    await userEvent.click(shown[1]!);
    expect(onSelect).toHaveBeenLastCalledWith(3);
  });

  it('marks the selected item for assistive technology', () => {
    render(<MoveList events={events} lobby={lobby} selected={2} onSelect={() => undefined} />);
    expect(screen.getAllByRole('option', { selected: true })).toHaveLength(1);
  });
});

function playedGame(): GameDetail {
  const rules = CLASSIC_10X10;
  const ships = rules.fleet.map((len, i) => ({ len, x: 0, y: i * 2, dir: 'h' as const }));
  const log: GameEvent[] = [];
  let state = createGame(rules, 1);
  const run = (command: Parameters<typeof step>[1]) => {
    const r = step(state, command);
    if (!r.ok) throw new Error(r.error.message);
    state = r.state;
    log.push(...r.events);
  };
  run({ type: 'place', seat: 1, ships });
  run({ type: 'place', seat: 2, ships });
  run({ type: 'fire', seat: 1, x: 0, y: 0 }); // hit (extra turn)
  run({ type: 'fire', seat: 1, x: 9, y: 9 }); // miss
  run({ type: 'fire', seat: 2, x: 5, y: 5 }); // miss
  return {
    id: 'g1', seriesId: 's1', index: 1, first: 1 as Seat, status: 'over', winner: null, reason: null,
    shots: { 1: 2, 2: 1 }, infractions: { 1: 0, 2: 0 }, startedAt: 0, durationMs: 10,
    viewerMode: 'god', rules, events: log as ViewEvent[], eventTimes: log.map((_, i) => i),
  };
}

const cells = (container: HTMLElement, state: string) => container.querySelectorAll(`[data-state="${state}"]`).length;

describe('GameViewer', () => {
  it('shows the board after the selected move, and before it on request', async () => {
    const { container } = render(<GameViewer game={playedGame()} lobby={lobby} />);
    // starts at the last event: 1 hit, 2 misses on the boards
    expect(cells(container, 'hit')).toBe(1);
    expect(cells(container, 'miss')).toBe(2);
    await userEvent.click(chronological()[2]!); // Alice's first shot (the hit)
    expect(cells(container, 'hit')).toBe(1);
    expect(cells(container, 'miss')).toBe(0);
    expect(container.querySelectorAll('.cell-focus')).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Before move' }));
    expect(cells(container, 'hit')).toBe(0);
  });

  it('steps with the buttons and the keyboard, staying inside the game', async () => {
    render(<GameViewer game={playedGame()} lobby={lobby} />);
    const position = screen.getByTestId('scrub-position');
    expect(position).toHaveTextContent('Move 5 of 5');
    await userEvent.click(screen.getByRole('button', { name: 'First move' }));
    expect(position).toHaveTextContent('Move 1 of 5');
    expect(screen.getByRole('button', { name: 'Previous move' })).toBeDisabled();
    screen.getByLabelText('Game viewer').focus();
    await userEvent.keyboard('{ArrowRight}{ArrowRight}');
    expect(position).toHaveTextContent('Move 3 of 5');
    await userEvent.keyboard('{End}{ArrowRight}');
    expect(position).toHaveTextContent('Move 5 of 5');
    expect(screen.getByRole('button', { name: 'Next move' })).toBeDisabled();
  });

  it('hides the ships of a seat the viewer is not allowed to see', () => {
    const game = playedGame();
    game.viewerMode = 'restricted';
    game.status = 'live';
    game.events = game.events.map((e) => (e.type === 'placed' && e.seat === 2 ? { ...e, ships: null } : e));
    const { container } = render(<GameViewer game={game} lobby={lobby} />);
    expect(container.querySelector('[data-testid="board-seat-1"] [data-state="ship"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="board-seat-2"] [data-state="ship"]')).toBeNull();
    expect(screen.getByTestId('board-seat-2')).toHaveTextContent('Ships hidden');
  });

  it('follows a live game until the user steps back', async () => {
    const game = playedGame();
    game.status = 'live';
    const partial = { ...game, events: game.events.slice(0, 4), eventTimes: [0, 1, 2, 3] };
    const { rerender } = render(<GameViewer game={partial} lobby={lobby} />);
    expect(screen.getByTestId('scrub-position')).toHaveTextContent('Move 4 of 4');
    rerender(<GameViewer game={game} lobby={lobby} />);
    expect(screen.getByTestId('scrub-position')).toHaveTextContent('Move 5 of 5'); // followed
    await userEvent.click(screen.getByRole('button', { name: 'Previous move' }));
    expect(screen.getByTestId('scrub-position')).toHaveTextContent('Move 4 of 5');
    const longer = { ...game, events: [...game.events, game.events.at(-1)!] };
    rerender(<GameViewer game={longer} lobby={lobby} />);
    expect(screen.getByTestId('scrub-position')).toHaveTextContent('Move 4 of 6'); // stays where the user is
  });
});

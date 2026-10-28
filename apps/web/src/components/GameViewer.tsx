import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Button, ButtonGroup, Form } from 'react-bootstrap';
import { deriveBoards } from '@bsc/engine';
import type { GameDetail, LobbySummary, Seat } from '../api/types';
import { eventTarget, seatName } from '../lib/events';
import { Board, BoardLegend } from './Board';
import { GameStatusBadge } from './Badges';
import { MoveList } from './MoveList';

/**
 * Shows one game: both boards, the move list, and a scrubber to see the board before or after any
 * event. While a game is live it follows the latest event until the user steps back.
 */
export function GameViewer({ game, lobby }: { game: GameDetail; lobby: LobbySummary }) {
  const count = game.events.length;
  const [picked, setPicked] = useState<number | null>(null);
  const [follow, setFollow] = useState(true);
  const [when, setWhen] = useState<'before' | 'after'>('after');
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Showing a different game resets the scrubber.
  useEffect(() => {
    setPicked(null);
    setFollow(true);
    setWhen('after');
  }, [game.id]);

  const live = game.status === 'live';
  const selected = count === 0 ? -1 : follow || picked === null ? count - 1 : Math.min(picked, count - 1);

  const select = (index: number) => {
    const clamped = Math.max(0, Math.min(count - 1, index));
    setPicked(clamped);
    setFollow(clamped === count - 1 && live);
  };

  const upTo = selected < 0 ? 0 : when === 'after' ? selected + 1 : selected;
  const boards = useMemo(() => deriveBoards(game.rules, game.events, upTo), [game.rules, game.events, upTo]);
  const target = selected >= 0 ? eventTarget(game.events[selected]!) : null;

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') select(selected - 1);
    else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') select(selected + 1);
    else if (e.key === 'Home') select(0);
    else if (e.key === 'End') select(count - 1);
    else if (e.key === 'b') setWhen('before');
    else if (e.key === 'a') setWhen('after');
    else return;
    e.preventDefault();
  };

  const boardFor = (seat: Seat) => {
    const mine = lobby.mySeats.includes(seat);
    const hiddenShips =
      game.viewerMode === 'restricted' && !mine && game.status !== 'over';
    return (
      <Board
        key={seat}
        testId={`board-seat-${seat}`}
        rows={boards[seat]}
        title={`${seatName(lobby, seat)}'s board${mine && lobby.mySeats.length === 1 ? ' (yours)' : ''}`}
        subtitle={hiddenShips ? 'Ships hidden: you only see shots' : 'Shots against this board'}
        highlight={target && target.owner === seat ? target : null}
      />
    );
  };

  return (
    <div ref={containerRef} tabIndex={0} onKeyDown={onKeyDown} aria-label="Game viewer" className="game-viewer">
      <div className="d-flex flex-wrap align-items-center gap-2 mb-2">
        <h2 className="h5 m-0">Game {game.index}</h2>
        <GameStatusBadge status={game.status} />
        <span className="text-body-secondary small">
          {seatName(lobby, game.first)} {game.status === 'live' ? 'moves first' : 'moved first'}
          {game.status === 'over' && game.winner && (
            <>
              {' '}
              · <strong className="text-body">{seatName(lobby, game.winner)} won</strong>
              {game.reason && game.reason !== 'sunk' ? ` (${game.reason})` : ''}
            </>
          )}
          {game.status === 'void' && ' · voided, not counted'}
        </span>
      </div>

      <div className="d-flex flex-wrap gap-4 mb-3">
        {boardFor(1)}
        {boardFor(2)}
      </div>
      <div className="mb-3">
        <BoardLegend />
      </div>

      <div className="d-flex flex-wrap align-items-center gap-2 mb-3">
        <ButtonGroup size="sm" aria-label="Step through the game">
          <Button variant="outline-secondary" onClick={() => select(0)} disabled={count === 0} aria-label="First move">
            <i className="bi bi-skip-start-fill" aria-hidden="true" />
          </Button>
          <Button variant="outline-secondary" onClick={() => select(selected - 1)} disabled={selected <= 0} aria-label="Previous move">
            <i className="bi bi-caret-left-fill" aria-hidden="true" />
          </Button>
          <Button
            variant="outline-secondary"
            onClick={() => select(selected + 1)}
            disabled={selected >= count - 1}
            aria-label="Next move"
          >
            <i className="bi bi-caret-right-fill" aria-hidden="true" />
          </Button>
          <Button variant="outline-secondary" onClick={() => select(count - 1)} disabled={selected >= count - 1} aria-label="Last move">
            <i className="bi bi-skip-end-fill" aria-hidden="true" />
          </Button>
        </ButtonGroup>
        <ButtonGroup size="sm" aria-label="Board state">
          <Button variant={when === 'before' ? 'info' : 'outline-secondary'} onClick={() => setWhen('before')} aria-pressed={when === 'before'}>
            Before move
          </Button>
          <Button variant={when === 'after' ? 'info' : 'outline-secondary'} onClick={() => setWhen('after')} aria-pressed={when === 'after'}>
            After move
          </Button>
        </ButtonGroup>
        {live && (
          <Form.Check
            type="switch"
            id="follow-live"
            label="Follow live"
            checked={follow}
            onChange={(e) => {
              setFollow(e.target.checked);
              if (e.target.checked) setPicked(null);
            }}
          />
        )}
        <span className="small text-body-secondary ms-auto" data-testid="scrub-position">
          {selected >= 0 ? `Move ${selected + 1} of ${count}` : 'No moves yet'} · arrow keys step, B/A switch
        </span>
      </div>

      <MoveList events={game.events} lobby={lobby} selected={selected} onSelect={select} />
    </div>
  );
}

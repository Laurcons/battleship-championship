import { Card } from 'react-bootstrap';
import type { LobbySummary, SeatInfo } from '../api/types';
import { useNow } from '../hooks/useNow';
import { timeAgo } from '../lib/format';
import { ConnectionBadge } from './Badges';

export function SeatCard({ seat, lobby }: { seat: SeatInfo; lobby: LobbySummary }) {
  const now = useNow();
  const mine = lobby.mySeats.includes(seat.seat);
  const graceLeft = seat.graceEndsAt ? Math.max(0, Math.ceil((seat.graceEndsAt - now) / 1000)) : null;
  return (
    <Card className="h-100" data-testid={`seat-card-${seat.seat}`}>
      <Card.Body className="py-2">
        <div className="d-flex align-items-center gap-2 flex-wrap">
          <i className={`bi bi-${seat.owner.kind === 'bot' ? 'robot' : 'person-fill'}`} aria-hidden="true" />
          <strong>{seat.owner.name}</strong>
          {mine && <span className="badge bg-light text-dark">you</span>}
          <span className="text-body-secondary small">Seat {seat.seat}</span>
          <span className="ms-auto">
            <ConnectionBadge state={seat.connection} />
          </span>
        </div>
        <div className="small text-body-secondary mt-1">
          {seat.program ? (
            <>
              {seat.program.name} {seat.program.version}
              {seat.latencyMs !== null && seat.owner.kind === 'participant' && ` · ${seat.latencyMs} ms`}
            </>
          ) : (
            'No program has connected yet'
          )}
          {seat.connection === 'disconnected' && seat.lastSeenAt && ` · last seen ${timeAgo(seat.lastSeenAt, now)}`}
          {seat.connection === 'grace' && graceLeft !== null && (
            <span className="text-warning" data-testid="grace-countdown">
              {' '}
              · resume window: {graceLeft} s left
            </span>
          )}
        </div>
      </Card.Body>
    </Card>
  );
}

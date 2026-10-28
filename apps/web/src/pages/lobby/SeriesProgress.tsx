import { Alert } from 'react-bootstrap';
import type { LobbySummary } from '../../api/types';
import { formatDuration } from '../../lib/format';

export function SeriesProgress({ lobby }: { lobby: LobbySummary }) {
  const s = lobby.series;
  if (!s) return null;
  const [a, b] = lobby.seats;
  const pct = Math.round((s.played / s.target) * 100);
  const leader = s.score[1] === s.score[2] ? null : s.score[1] > s.score[2] ? a.owner.name : b.owner.name;
  return (
    <div className="mb-3" data-testid="series-progress">
      <div className="d-flex flex-wrap justify-content-between small mb-1">
        <span>
          <strong>
            {a.owner.name} {s.score[1]} – {s.score[2]} {b.owner.name}
          </strong>{' '}
          <span className="text-body-secondary">
            · {s.played} of {s.target} game{s.target === 1 ? '' : 's'}
          </span>
        </span>
        <span className="text-body-secondary">
          {s.status === 'running' && s.etaMs !== null && `about ${formatDuration(s.etaMs)} left`}
          {s.status === 'running' && s.etaMs === null && 'estimating time left…'}
          {s.status === 'done' && (leader ? `${leader} wins the battery` : s.played > 0 ? 'The battery ended in a tie' : '')}
        </span>
      </div>
      <div
        className="progress"
        role="progressbar"
        aria-label="Battery progress"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={`progress-bar bg-${s.status === 'aborted' ? 'warning' : s.status === 'done' ? 'success' : 'primary'}${
            s.status === 'running' ? ' progress-bar-striped' : ''
          }${s.status === 'running' && lobby.status === 'running' ? ' progress-bar-animated' : ''}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {s.status === 'aborted' && (
        <Alert variant="warning" className="mt-2 py-2 mb-0" data-testid="series-aborted">
          <i className="bi bi-exclamation-triangle me-1" aria-hidden="true" />
          The battery was aborted after {s.played} game{s.played === 1 ? '' : 's'}: {s.abortReason} Partial results are kept.
        </Alert>
      )}
    </div>
  );
}

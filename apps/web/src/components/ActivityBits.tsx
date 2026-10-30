import { Badge } from 'react-bootstrap';
import type { ActivitySummary, SignalSeverity } from '../api/types';

const LABEL: Record<SignalSeverity, string> = { high: 'High', notice: 'Notice', info: 'Info' };
const ICON: Record<SignalSeverity, string> = { high: 'exclamation-triangle-fill', notice: 'exclamation-circle-fill', info: 'info-circle-fill' };

/** The severity of a signal, in words and with an icon, never by colour alone. */
export function SeverityBadge({ severity }: { severity: SignalSeverity }) {
  const bg = severity === 'high' ? 'danger' : severity === 'notice' ? 'warning' : 'secondary';
  return (
    <Badge bg={bg} text={severity === 'notice' ? 'dark' : undefined} className="text-nowrap" data-severity={severity}>
      <i className={`bi bi-${ICON[severity]} me-1`} aria-hidden="true" />
      {LABEL[severity]}
    </Badge>
  );
}

/** The most severe unreviewed signal of a participant, or null. */
export function worstUnreviewed(unreviewed: ActivitySummary['unreviewed']): SignalSeverity | null {
  return unreviewed.high > 0 ? 'high' : unreviewed.notice > 0 ? 'notice' : unreviewed.info > 0 ? 'info' : null;
}

export function unreviewedCount(unreviewed: ActivitySummary['unreviewed']): number {
  return unreviewed.high + unreviewed.notice + unreviewed.info;
}

export function describeUnreviewed(unreviewed: ActivitySummary['unreviewed']): string {
  return [
    unreviewed.high > 0 ? `${unreviewed.high} high` : null,
    unreviewed.notice > 0 ? `${unreviewed.notice} notice${unreviewed.notice === 1 ? '' : 's'}` : null,
    unreviewed.info > 0 ? `${unreviewed.info} info` : null,
  ]
    .filter(Boolean)
    .join(', ');
}

export function ModeBadge({ secure }: { secure: boolean }) {
  return secure ? (
    <span className="mono small">wss</span>
  ) : (
    <span className="mono small text-warning-emphasis" title="Plain ws://: the token travels unencrypted">
      ws
    </span>
  );
}

import { Badge } from 'react-bootstrap';
import type { ConnectionState, GameStatus, LobbyStatus, ViewerMode } from '../api/types';

const LOBBY: Record<LobbyStatus, { bg: string; label: string; icon: string }> = {
  waiting: { bg: 'secondary', label: 'Waiting for programs', icon: 'hourglass-split' },
  ready: { bg: 'success', label: 'Ready', icon: 'check-circle' },
  running: { bg: 'primary', label: 'Running', icon: 'play-fill' },
  paused: { bg: 'warning', label: 'Paused: program disconnected', icon: 'pause-fill' },
  expired: { bg: 'dark', label: 'Expired', icon: 'clock-history' },
};

export function LobbyStatusBadge({ status }: { status: LobbyStatus }) {
  const s = LOBBY[status];
  return (
    <Badge bg={s.bg} className={status === 'paused' ? 'text-dark' : undefined} data-testid="lobby-status">
      <i className={`bi bi-${s.icon} me-1`} aria-hidden="true" />
      {s.label}
    </Badge>
  );
}

const CONNECTION: Record<ConnectionState, { bg: string; label: string }> = {
  connected: { bg: 'success', label: 'Connected' },
  grace: { bg: 'warning', label: 'Disconnected (resume window)' },
  disconnected: { bg: 'secondary', label: 'Not connected' },
};

export function ConnectionBadge({ state }: { state: ConnectionState }) {
  const s = CONNECTION[state];
  return (
    <Badge bg={s.bg} className={state === 'grace' ? 'text-dark' : undefined}>
      {s.label}
    </Badge>
  );
}

export function ViewerModeBadge({ mode, godMode }: { mode: ViewerMode; godMode: boolean }) {
  if (mode === 'god') {
    return (
      <Badge bg="info" className="text-dark" title={godMode ? 'You see both fleets.' : 'As admin you see both fleets.'}>
        <i className="bi bi-eye me-1" aria-hidden="true" />
        God mode
      </Badge>
    );
  }
  return (
    <Badge bg="secondary" title="You only see what your own program knows, until a game ends.">
      <i className="bi bi-eye-slash me-1" aria-hidden="true" />
      Restricted view
    </Badge>
  );
}

export function GameStatusBadge({ status }: { status: GameStatus }) {
  if (status === 'live') return <Badge bg="primary">Live</Badge>;
  if (status === 'void') return <Badge bg="secondary">Voided</Badge>;
  return null;
}

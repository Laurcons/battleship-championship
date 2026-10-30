import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, Badge, Button, ButtonGroup, Form, Offcanvas } from 'react-bootstrap';
import { useMatch, useNavigate } from 'react-router-dom';
import type { Seat } from '../api/types';
import { useLobby, useSession } from '../hooks/queries';
import { useMockControls } from '../mock/controls';
import type { Speed } from '../mock/runner';
import type { Fault, SimProfile } from '../mock/state';
import { ConnectionBadge } from './Badges';

const SPEEDS: { value: Speed; label: string; hint: string }[] = [
  { value: 'watch', label: 'Watch', hint: '~150 ms per move: follow a game by eye' },
  { value: 'fast', label: 'Fast', hint: '~10 ms per move: a game takes about a second' },
  { value: 'instant', label: 'Instant', hint: 'as fast as the browser allows (batteries of hundreds)' },
];

const FAULTS: { value: Fault; label: string }[] = [
  { value: 'none', label: 'Behaves correctly' },
  { value: 'invalid_moves', label: 'Sends invalid moves' },
  { value: 'repeat_shots', label: 'Fires at the same cell again' },
  { value: 'bad_shape', label: 'Replies with a malformed frame' },
  { value: 'timeout', label: 'Sometimes stops replying (timeout)' },
  { value: 'crash', label: 'Sometimes loses its connection' },
];

/** Floating developer panel: the simulated outside world. Only rendered when running on the mock. */
export function MockPanel() {
  const controls = useMockControls();
  const [open, setOpen] = useState(false);
  if (!controls) return null;
  return (
    <>
      <Button className="mock-fab" variant="warning" style={{ color: '#000' }} onClick={() => setOpen(true)} aria-label="Open mock controls" data-testid="mock-fab">
        <i className="bi bi-tools me-1" aria-hidden="true" />
        Mock
      </Button>
      <Offcanvas show={open} onHide={() => setOpen(false)} placement="end" scroll backdrop={false} data-testid="mock-panel">
        <Offcanvas.Header closeButton>
          <Offcanvas.Title>Mock controls</Offcanvas.Title>
        </Offcanvas.Header>
        <Offcanvas.Body>
          <PanelBody />
        </Offcanvas.Body>
      </Offcanvas>
    </>
  );
}

function PanelBody() {
  const controls = useMockControls()!;
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: session } = useSession();
  const match = useMatch('/lobbies/:lobbyId');
  const lobbyId = match?.params.lobbyId && match.params.lobbyId !== 'new' ? match.params.lobbyId : undefined;
  const lobby = useLobby(lobbyId ?? '');
  const [speed, setSpeedState] = useState<Speed>(controls.getSpeed());
  const [message, setMessage] = useState<string | null>(null);
  const refresh = () => void qc.invalidateQueries();

  const act = (fn: () => void) => () => {
    try {
      setMessage(null);
      fn();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      refresh();
    }
  };

  const switchTo = (value: string) => {
    if (value === 'admin') controls.switchSession({ role: 'admin', username: controls.adminLogin().username });
    else if (value === 'none') controls.switchSession(null);
    else {
      const p = controls.participants().find((x) => x.id === value);
      if (p) controls.switchSession({ role: 'participant', participantId: p.id, name: p.name });
    }
    qc.clear();
    navigate(value === 'none' ? '/login' : '/lobbies');
  };

  const current = session ? (session.role === 'admin' ? 'admin' : session.participantId) : 'none';
  const l = lobby.data;

  return (
    <div className="d-grid gap-4">
      {message && (
        <Alert variant="warning" className="small mb-0" dismissible onClose={() => setMessage(null)} data-testid="mock-error">
          {message}
        </Alert>
      )}
      <Alert variant="secondary" className="small mb-0">
        Everything here is the <strong>simulated outside world</strong>: programs connecting, misbehaving and crashing. The real platform has no such panel. Data is kept in this browser (the last 30 games of each lobby keep their full move history). Reloading the page restarts the simulated platform: a game in progress is voided, as after a real restart.
      </Alert>

      <section>
        <h3 className="h6">Who am I?</h3>
        <Form.Select size="sm" value={current} onChange={(e) => switchTo(e.target.value)} aria-label="Switch user">
          <option value="none">Logged out</option>
          {controls.participants().map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
          <option value="admin">Admin</option>
        </Form.Select>
        <div className="small text-body-secondary mt-1">Switch to see the same lobby from another participant's point of view (restricted or god mode).</div>
        {session?.role === 'participant' && (
          <Button
            size="sm"
            variant="outline-secondary"
            className="mt-2"
            onClick={act(() => controls.simulateTokenReplacedElsewhere(session.participantId))}
          >
            Someone replaces my token elsewhere
          </Button>
        )}
      </section>

      <section>
        <h3 className="h6">Game speed</h3>
        <Form.Group>
          {SPEEDS.map((s) => (
            <Form.Check
              key={s.value}
              type="radio"
              name="speed"
              id={`speed-${s.value}`}
              label={
                <>
                  {s.label} <span className="small text-body-secondary">{s.hint}</span>
                </>
              }
              checked={speed === s.value}
              onChange={() => {
                controls.setSpeed(s.value);
                setSpeedState(s.value);
              }}
            />
          ))}
        </Form.Group>
      </section>

      {lobbyId && l && (
        <section data-testid="mock-lobby-controls">
          <h3 className="h6">
            Lobby <span className="mono">{l.id}</span>
          </h3>
          {l.seats.map((seat) => {
            if (seat.owner.kind !== 'participant') {
              return (
                <div key={seat.seat} className="small text-body-secondary mb-3">
                  Seat {seat.seat}: {seat.owner.name} is run by the platform and is always connected.
                </div>
              );
            }
            return (
              <SeatControls
                key={seat.seat}
                lobbyId={l.id}
                seat={seat.seat}
                name={seat.owner.name}
                connection={seat.connection}
                onChange={refresh}
                onError={setMessage}
              />
            );
          })}
          <ButtonGroup size="sm" className="d-flex flex-wrap gap-1">
            <Button
              variant="outline-success"
              onClick={act(() => {
                for (const s of l.seats) if (s.owner.kind === 'participant' && s.connection !== 'connected') controls.connectProgram(l.id, s.seat);
              })}
            >
              Connect all programs
            </Button>
            <Button variant="outline-warning" onClick={act(() => controls.simulateServerRestart())}>
              Restart the platform
            </Button>
            <Button variant="outline-danger" onClick={act(() => controls.expireLobby(l.id))}>
              Expire this lobby
            </Button>
            <Button
              variant="outline-secondary"
              onClick={act(() => {
                const inLobby = new Set(l.seats.map((s) => (s.owner.kind === 'participant' ? s.owner.participantId : '')));
                const outsider = controls.participants().find((p) => !inLobby.has(p.id));
                if (outsider) controls.simulateDeniedAttempt(outsider.id, l.id);
              })}
            >
              Someone else's token tries this lobby
            </Button>
          </ButtonGroup>
        </section>
      )}

      <section>
        <h3 className="h6">Data</h3>
        <Button
          size="sm"
          variant="outline-danger"
          onClick={() => {
            controls.resetData();
            qc.clear();
            navigate('/login');
          }}
        >
          Reset all mock data
        </Button>
        <div className="small text-body-secondary mt-2">
          Shared password: <code>{controls.sharedPassword()}</code> · admin: <code>{controls.adminLogin().username}</code> / <code>{controls.adminLogin().password}</code>
        </div>
      </section>
    </div>
  );
}

function SeatControls({
  lobbyId,
  seat,
  name,
  connection,
  onChange,
  onError,
}: {
  lobbyId: string;
  seat: Seat;
  name: string;
  connection: 'connected' | 'grace' | 'disconnected';
  onChange: () => void;
  onError: (message: string | null) => void;
}) {
  const controls = useMockControls()!;
  const [profile, setProfile] = useState<SimProfile>({ brain: 'hunt-target', fault: 'none' });
  const apply = (next: SimProfile) => {
    setProfile(next);
    controls.setProfile(lobbyId, seat, next);
    onChange();
  };
  return (
    <div className="border rounded p-2 mb-3" data-testid={`mock-seat-${seat}`}>
      <div className="d-flex align-items-center gap-2 mb-2">
        <strong>{name}</strong>
        <span className="small text-body-secondary">seat {seat}</span>
        <span className="ms-auto">
          <ConnectionBadge state={connection} />
        </span>
      </div>
      <Form.Select size="sm" className="mb-1" aria-label={`Strategy of seat ${seat}`} value={profile.brain} onChange={(e) => apply({ ...profile, brain: e.target.value as SimProfile['brain'] })}>
        <option value="hunt-target">Strategy: hunt & target</option>
        <option value="random">Strategy: random</option>
      </Form.Select>
      <Form.Select size="sm" className="mb-2" aria-label={`Behavior of seat ${seat}`} value={profile.fault} onChange={(e) => apply({ ...profile, fault: e.target.value as Fault })}>
        {FAULTS.map((f) => (
          <option key={f.value} value={f.value}>
            {f.label}
          </option>
        ))}
      </Form.Select>
      <ButtonGroup size="sm">
        <Button
          variant="outline-success"
          disabled={connection === 'connected'}
          onClick={() => {
            try {
              onError(null);
              controls.connectProgram(lobbyId, seat, profile);
            } catch (error) {
              onError(error instanceof Error ? error.message : String(error));
            }
            onChange();
          }}
        >
          {connection === 'grace' ? 'Reconnect' : 'Connect program'}
        </Button>
        <Button
          variant="outline-info"
          title="Connect from a second address of the same participant: the token is then in use from two places"
          onClick={() => {
            try {
              onError(null);
              controls.connectProgram(lobbyId, seat, profile, 'other');
            } catch (error) {
              onError(error instanceof Error ? error.message : String(error));
            }
            onChange();
          }}
        >
          From another address
        </Button>
        <Button
          variant="outline-warning"
          disabled={connection === 'disconnected'}
          onClick={() => {
            controls.disconnectProgram(lobbyId, seat);
            onChange();
          }}
        >
          Drop connection
        </Button>
      </ButtonGroup>
      {connection === 'grace' && <Badge bg="warning" className="text-dark ms-2">resume window</Badge>}
    </div>
  );
}

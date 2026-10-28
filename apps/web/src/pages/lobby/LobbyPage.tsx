import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, Button, Col, Row, Tab, Tabs } from 'react-bootstrap';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useApi } from '../../api/context';
import { ApiError, type LobbySummary } from '../../api/types';
import { LobbyStatusBadge, ViewerModeBadge } from '../../components/Badges';
import { ConfirmModal } from '../../components/ConfirmModal';
import { CopyButton } from '../../components/CopyButton';
import { ErrorAlert, Loading } from '../../components/ErrorAlert';
import { SeatCard } from '../../components/SeatCard';
import { keys, useLobby, useLobbyAction, useLobbyLive } from '../../hooks/queries';
import { useNow } from '../../hooks/useNow';
import { formatDuration } from '../../lib/format';
import { ConnectionTab } from './ConnectionTab';
import { HistoryTab } from './HistoryTab';
import { LiveTab } from './LiveTab';
import { ResultsTab } from './ResultsTab';
import { RulesTab } from './RulesTab';
import { SeriesProgress } from './SeriesProgress';
import { StartDialog } from './StartDialog';

type Confirming = 'restart' | 'reset' | 'delete' | null;

export function LobbyPage() {
  const { lobbyId = '' } = useParams();
  const api = useApi();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const lobbyQuery = useLobby(lobbyId);
  const liveGame = useLobbyLive(lobbyId);
  const [starting, setStarting] = useState(false);
  const [confirming, setConfirming] = useState<Confirming>(null);
  const [seriesId, setSeriesId] = useState<string | undefined>(undefined);
  const now = useNow();
  const lobby = lobbyQuery.data;

  const start = useLobbyAction(lobbyId, (games: number) => api.startSeries(lobbyId, games));
  const restart = useLobbyAction(lobbyId, () => api.restartGame(lobbyId));
  const reset = useLobbyAction(lobbyId, () => api.resetSeries(lobbyId));
  const remove = useMutation({
    mutationFn: () => api.deleteLobby(lobbyId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.lobbies });
      qc.removeQueries({ queryKey: keys.lobby(lobbyId) });
      navigate('/lobbies');
    },
  });
  const seriesList = useQuery({
    queryKey: keys.series(lobbyId),
    queryFn: () => api.listSeries(lobbyId),
    enabled: !!lobby,
  });

  if (lobbyQuery.isLoading) return <Loading />;
  if (lobbyQuery.error || !lobby) {
    const notFound = lobbyQuery.error instanceof ApiError && lobbyQuery.error.code === 'not_found';
    return (
      <Alert variant="warning" data-testid="lobby-not-found">
        {notFound ? 'This lobby does not exist, or you are not part of it.' : <ErrorAlert error={lobbyQuery.error} />}
      </Alert>
    );
  }

  const tab = params.get('tab') ?? 'live';
  const error = start.error ?? restart.error ?? reset.error ?? remove.error;
  const isMember = lobby.mySeats.length > 0;
  const running = lobby.status === 'running' || lobby.status === 'paused';
  const expiresIn = lobby.expiresAt - now;

  return (
    <>
      <div className="page-title mb-2">
        <h1 className="h3 m-0 mono" data-testid="lobby-id">
          {lobby.id}
        </h1>
        <CopyButton text={lobby.id} label="Copy id" />
        <LobbyStatusBadge status={lobby.status} />
        <ViewerModeBadge mode={lobby.viewerMode} godMode={lobby.godMode} />
        {lobby.stopOnInfraction && (
          <span className="badge text-bg-warning" title="A battery ends at the first invalid move, malformed reply or timeout." data-testid="stop-on-infraction">
            Stops on infraction
          </span>
        )}
        <span className="badge text-bg-secondary mono" title="Ruleset" data-testid="lobby-ruleset">
          {lobby.rulesetId}
        </span>
      </div>
      <p className="text-body-secondary small mb-3">
        Created by {lobby.createdBy.name}
        {lobby.status !== 'running' && lobby.status !== 'paused' && lobby.status !== 'expired' && (
          <> · expires after inactivity in {formatDuration(Math.max(0, expiresIn))}</>
        )}
        {lobby.status === 'expired' && ' · this lobby expired from inactivity: history stays available but it cannot be started again'}
      </p>

      {!isMember && (
        <Alert variant="info" className="py-2" data-testid="admin-banner">
          <i className="bi bi-shield-lock me-1" aria-hidden="true" />
          You are viewing this lobby as admin: both fleets are visible and the controls are read-only.
        </Alert>
      )}
      <ErrorAlert error={error} />

      <Row className="g-2 mb-3">
        {lobby.seats.map((seat) => (
          <Col md={6} key={seat.seat}>
            <SeatCard seat={seat} lobby={lobby} />
          </Col>
        ))}
      </Row>

      <div className="d-flex flex-wrap gap-2 mb-3" data-testid="lobby-actions">
        {isMember && lobby.status !== 'expired' && !running && (
          <Button variant="success" disabled={!lobby.canStart || start.isPending} onClick={() => setStarting(true)}>
            <i className="bi bi-play-fill me-1" aria-hidden="true" />
            {lobby.series ? 'Start again' : 'Start'}
          </Button>
        )}
        {isMember && !lobby.canStart && lobby.status === 'waiting' && (
          <span className="align-self-center small text-body-secondary">Waiting for both programs to connect (see the Connection tab).</span>
        )}
        {isMember && running && (
          <Button variant="outline-warning" onClick={() => setConfirming('restart')}>
            <i className="bi bi-arrow-counterclockwise me-1" aria-hidden="true" />
            Restart current game
          </Button>
        )}
        {isMember && lobby.series && (
          <Button variant="outline-warning" onClick={() => setConfirming('reset')}>
            <i className="bi bi-eraser me-1" aria-hidden="true" />
            Reset series
          </Button>
        )}
        <Button variant="outline-danger" className="ms-auto" onClick={() => setConfirming('delete')}>
          <i className="bi bi-trash me-1" aria-hidden="true" />
          Delete lobby
        </Button>
      </div>

      {lobby.series && <SeriesProgress lobby={lobby} />}

      <Tabs activeKey={tab} onSelect={(k) => setParams(k && k !== 'live' ? { tab: k } : {}, { replace: true })} className="mb-3" mountOnEnter unmountOnExit transition={false}>
        <Tab eventKey="live" title="Live">
          <LiveTab lobby={lobby} game={liveGame.data} />
        </Tab>
        <Tab eventKey="history" title="History">
          <HistoryTab lobby={lobby} seriesId={seriesId} onSeries={setSeriesId} seriesList={seriesList.data ?? []} />
        </Tab>
        <Tab eventKey="results" title="Results">
          <ResultsTab lobby={lobby} seriesId={seriesId} onSeries={setSeriesId} seriesList={seriesList.data ?? []} />
        </Tab>
        <Tab eventKey="rules" title="Rules">
          <RulesTab lobby={lobby} />
        </Tab>
        <Tab eventKey="connection" title="Connection">
          <ConnectionTab lobby={lobby} />
        </Tab>
      </Tabs>

      <StartDialog
        show={starting}
        lobby={lobby}
        busy={start.isPending}
        onCancel={() => setStarting(false)}
        onStart={(games) =>
          start.mutate([games], {
            onSuccess: () => {
              setStarting(false);
              setSeriesId(undefined);
              setParams({}, { replace: true });
            },
          })
        }
      />
      <ConfirmModal
        show={confirming === 'restart'}
        title="Restart the current game?"
        confirmLabel="Restart game"
        variant="warning"
        onCancel={() => setConfirming(null)}
        onConfirm={() => {
          setConfirming(null);
          restart.mutate([]);
        }}
      >
        The game in progress is voided and not counted. Both programs receive <code>reset</code> and the same game number is played again.
        This also interrupts your opponent.
      </ConfirmModal>
      <ConfirmModal
        show={confirming === 'reset'}
        title="Reset the series?"
        confirmLabel="Reset series"
        variant="warning"
        onCancel={() => setConfirming(null)}
        onConfirm={() => {
          setConfirming(null);
          reset.mutate([]);
        }}
      >
        All results and games of the latest battery are discarded permanently.
      </ConfirmModal>
      <ConfirmModal
        show={confirming === 'delete'}
        title="Delete this lobby?"
        confirmLabel="Delete lobby"
        onCancel={() => setConfirming(null)}
        onConfirm={() => {
          setConfirming(null);
          remove.mutate();
        }}
      >
        <p>
          The lobby <code>{lobby.id}</code> and all its games are deleted for both players. Connected programs are disconnected.
        </p>
      </ConfirmModal>
    </>
  );
}

export type { LobbySummary };

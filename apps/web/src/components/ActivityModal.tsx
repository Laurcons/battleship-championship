import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Badge, Button, ButtonGroup, Modal, Table } from 'react-bootstrap';
import { Link } from 'react-router-dom';
import { useApi } from '../api/context';
import type { ActivitySignal, ConnectionRecord, ParticipantRef } from '../api/types';
import { keys } from '../hooks/queries';
import { formatDateTime, formatDuration, timeAgo } from '../lib/format';
import { ModeBadge, SeverityBadge } from './ActivityBits';
import { ErrorAlert, Loading } from './ErrorAlert';
import { ResetTokenDialog } from './ResetTokenDialog';

function SignalRow({ signal, onShow, active }: { signal: ActivitySignal; onShow: () => void; active: boolean }) {
  return (
    <li className={`d-flex flex-wrap align-items-start gap-2 py-2 border-bottom ${signal.reviewed ? 'text-body-secondary' : ''}`} data-testid="signal-item" data-kind={signal.kind}>
      <SeverityBadge severity={signal.severity} />
      <span className="flex-grow-1">
        {signal.message}
        <span className="d-block small text-body-secondary" title={formatDateTime(signal.at)}>
          {timeAgo(signal.at)}
        </span>
      </span>
      <Button size="sm" variant={active ? 'secondary' : 'outline-secondary'} onClick={onShow} aria-pressed={active}>
        Show connections
      </Button>
    </li>
  );
}

function endedText(c: ConnectionRecord): string {
  if (c.endedAt === null) return 'Still connected';
  if (c.takeoverIp) return `Taken over by ${c.takeoverIp}`;
  return c.endReason ?? 'Closed';
}

/** Everything about how one participant's token has been used, with the means to act on it. */
export function ActivityModal({ participant, onHide }: { participant: ParticipantRef; onHide: () => void }) {
  const api = useApi();
  const qc = useQueryClient();
  const query = useQuery({ queryKey: keys.admin.activity(participant.id), queryFn: () => api.admin.getParticipantActivity(participant.id), refetchInterval: 5000 });
  const [evidence, setEvidence] = useState<string | null>(null); // a signal id
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [resetting, setResetting] = useState<ParticipantRef | null>(null);
  const review = useMutation({
    mutationFn: () => api.admin.reviewParticipantActivity(participant.id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.admin.activity(participant.id) });
      void qc.invalidateQueries({ queryKey: keys.admin.participants });
      void qc.invalidateQueries({ queryKey: keys.admin.monitor });
    },
  });

  const a = query.data;
  const unreviewed = a?.signals.filter((s) => !s.reviewed) ?? [];
  const reviewed = a?.signals.filter((s) => s.reviewed) ?? [];
  const shown = (a?.connections ?? []).filter((c) => (evidence ? c.flaggedBy.includes(evidence) : flaggedOnly ? c.flaggedBy.length > 0 : true));
  const evidenceSignal = a?.signals.find((s) => s.id === evidence);
  const show = (s: ActivitySignal) => {
    setFlaggedOnly(false);
    setEvidence(evidence === s.id ? null : s.id);
  };

  return (
    <>
      <Modal show size="xl" onHide={onHide} scrollable aria-labelledby="activity-title" data-testid="activity-modal">
        <Modal.Header closeButton>
          <Modal.Title id="activity-title" as="h2" className="h5">
            Token activity: {participant.name}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <ErrorAlert error={query.error ?? review.error} />
          {query.isLoading && <Loading />}
          {a && (
            <>
              <p className="text-body-secondary" data-testid="activity-summary">
                {a.tokenCreatedAt ? `Token created ${timeAgo(a.tokenCreatedAt)}` : 'No token'} · {a.lastConnection ? `last used ${timeAgo(a.lastConnection.at)}` : 'never used'} · {a.connections7d} connection{a.connections7d === 1 ? '' : 's'} in 7 days · {a.addresses7d} address
                {a.addresses7d === 1 ? '' : 'es'}
              </p>

              <h3 className="h6">
                Signals{' '}
                <Badge bg={unreviewed.length > 0 ? 'danger' : 'secondary'} pill data-testid="unreviewed-count">
                  {unreviewed.length} unreviewed
                </Badge>
              </h3>
              {unreviewed.length === 0 && <p className="text-body-secondary" data-testid="no-signals">Nothing to review.</p>}
              <ul className="list-unstyled mb-3" data-testid="signal-list">
                {unreviewed.map((s) => (
                  <SignalRow key={s.id} signal={s} onShow={() => show(s)} active={evidence === s.id} />
                ))}
              </ul>
              {reviewed.length > 0 && (
                <details className="mb-3" data-testid="reviewed-signals">
                  <summary className="small">{reviewed.length} reviewed</summary>
                  <ul className="list-unstyled mb-0">
                    {reviewed.map((s) => (
                      <SignalRow key={s.id} signal={s} onShow={() => show(s)} active={evidence === s.id} />
                    ))}
                  </ul>
                </details>
              )}

              <h3 className="h6 mt-4">Addresses</h3>
              <Table size="sm" responsive data-testid="address-table">
                <thead>
                  <tr>
                    <th scope="col">Address</th>
                    <th scope="col">First seen</th>
                    <th scope="col">Last seen</th>
                    <th scope="col">Connections</th>
                    <th scope="col">Mode</th>
                    <th scope="col">Also used by</th>
                  </tr>
                </thead>
                <tbody>
                  {a.addresses.length === 0 && (
                    <tr>
                      <td colSpan={6} className="text-body-secondary">
                        This token has not been used yet.
                      </td>
                    </tr>
                  )}
                  {a.addresses.map((x) => (
                    <tr key={x.ip}>
                      <td className="mono">{x.ip}</td>
                      <td className="small">{timeAgo(x.firstSeen)}</td>
                      <td className="small">{timeAgo(x.lastSeen)}</td>
                      <td>{x.connections}</td>
                      <td>
                        {x.modes.map((m) => (
                          <span key={m} className="me-1">
                            <ModeBadge secure={m === 'wss'} />
                          </span>
                        ))}
                      </td>
                      <td className="small">{x.alsoUsedBy.length ? x.alsoUsedBy.map((p) => p.name).join(', ') : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>

              <div className="d-flex flex-wrap align-items-center gap-2 mt-4 mb-2">
                <h3 className="h6 m-0">Connections</h3>
                <ButtonGroup size="sm" aria-label="Filter connections">
                  <Button variant={!flaggedOnly && !evidence ? 'secondary' : 'outline-secondary'} onClick={() => { setEvidence(null); setFlaggedOnly(false); }}>
                    All
                  </Button>
                  <Button variant={flaggedOnly && !evidence ? 'secondary' : 'outline-secondary'} onClick={() => { setEvidence(null); setFlaggedOnly(true); }}>
                    Flagged
                  </Button>
                </ButtonGroup>
                {evidenceSignal && (
                  <Badge bg="secondary" className="fw-normal" data-testid="evidence-chip">
                    Evidence for: {evidenceSignal.message}{' '}
                    <button type="button" className="btn-close btn-close-white ms-1" style={{ fontSize: '0.6rem' }} aria-label="Show all connections" onClick={() => setEvidence(null)} />
                  </Badge>
                )}
              </div>
              <Table size="sm" responsive data-testid="connection-table">
                <thead>
                  <tr>
                    <th scope="col">When</th>
                    <th scope="col">Duration</th>
                    <th scope="col">Address</th>
                    <th scope="col">Mode</th>
                    <th scope="col">Program</th>
                    <th scope="col">Lobby</th>
                    <th scope="col">Ended</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.length === 0 && (
                    <tr>
                      <td colSpan={7} className="text-body-secondary">
                        No connections to show.
                      </td>
                    </tr>
                  )}
                  {shown.map((c) => (
                    <tr key={c.id} className={c.flaggedBy.length > 0 ? 'row-flagged' : undefined} data-testid="connection-row" data-flagged={c.flaggedBy.length > 0}>
                      <td className="small text-nowrap">{formatDateTime(c.at)}</td>
                      <td className="small">{c.endedAt === null ? 'open' : formatDuration(c.endedAt - c.at)}</td>
                      <td className="mono">
                        {c.ip}
                        {c.flaggedBy.length > 0 && (
                          <i className="bi bi-flag-fill ms-1 text-danger" role="img" aria-label="Part of a signal" />
                        )}
                      </td>
                      <td>
                        <ModeBadge secure={c.secure} />
                      </td>
                      <td className="small">{c.program ? `${c.program.name} ${c.program.version}` : '—'}</td>
                      <td className="small">
                        <Link to={`/lobbies/${c.lobbyId}`} className="mono" onClick={onHide}>
                          {c.lobbyId}
                        </Link>
                        {c.seat ? ` · seat ${c.seat}` : ''}
                      </td>
                      <td className="small">{endedText(c)}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>

              {a.denied.length > 0 && (
                <>
                  <h3 className="h6 mt-4">Denied attempts</h3>
                  <p className="small text-body-secondary">A valid token was used on a lobby that is not theirs. The program was only told that authentication failed.</p>
                  <Table size="sm" responsive data-testid="denied-table">
                    <thead>
                      <tr>
                        <th scope="col">When</th>
                        <th scope="col">Address</th>
                        <th scope="col">Lobby</th>
                      </tr>
                    </thead>
                    <tbody>
                      {a.denied.map((c) => (
                        <tr key={c.id} className={c.flaggedBy.length > 0 ? 'row-flagged' : undefined}>
                          <td className="small text-nowrap">{formatDateTime(c.at)}</td>
                          <td className="mono">{c.ip}</td>
                          <td className="mono small">{c.lobbyId}</td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </>
              )}
            </>
          )}
        </Modal.Body>
        <Modal.Footer className="justify-content-between">
          <span>
            <Button variant="outline-light" className="me-2" disabled={!a || unreviewed.length === 0 || review.isPending} onClick={() => review.mutate()}>
              Mark all reviewed
            </Button>
            <Button variant="outline-warning" disabled={!a?.tokenCreatedAt} onClick={() => setResetting(participant)}>
              Reset token…
            </Button>
          </span>
          <Button variant="secondary" onClick={onHide}>
            Close
          </Button>
        </Modal.Footer>
      </Modal>
      <ResetTokenDialog participant={resetting} onClose={() => setResetting(null)} />
    </>
  );
}

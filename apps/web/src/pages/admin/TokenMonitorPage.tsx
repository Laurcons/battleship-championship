import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, Button, Card, Col, Form, Nav, Row, Table } from 'react-bootstrap';
import { useApi } from '../../api/context';
import type { ParticipantRef, SignalSeverity } from '../../api/types';
import { ModeBadge, SeverityBadge } from '../../components/ActivityBits';
import { ActivityModal } from '../../components/ActivityModal';
import { ErrorAlert, Loading } from '../../components/ErrorAlert';
import { keys, useSession } from '../../hooks/queries';
import { formatDateTime, formatDuration, timeAgo } from '../../lib/format';
import { AdminOnly } from './AdminOnly';

export function AdminTokenMonitorPage() {
  const { data: session } = useSession();
  if (session?.role !== 'admin') return <AdminOnly />;
  return <TokenMonitor />;
}

function Stat({ label, value, tone, testId }: { label: string; value: string | number; tone?: string; testId: string }) {
  return (
    <Card className={tone ? `border-${tone}` : undefined} data-testid={testId}>
      <Card.Body className="py-3">
        <div className={`display-6 ${tone ? `text-${tone}` : ''}`}>{value}</div>
        <div className="small text-body-secondary">{label}</div>
      </Card.Body>
    </Card>
  );
}

function TokenMonitor() {
  const api = useApi();
  const qc = useQueryClient();
  const [tab, setTab] = useState<'signals' | 'connections'>('signals');
  const [severity, setSeverity] = useState<'all' | SignalSeverity>('all');
  const [who, setWho] = useState('all');
  const [showReviewed, setShowReviewed] = useState(false);
  const [inspecting, setInspecting] = useState<ParticipantRef | null>(null);
  const monitor = useQuery({ queryKey: keys.admin.monitor, queryFn: () => api.admin.getTokenMonitor(), refetchInterval: 10_000 });
  const connections = useQuery({ queryKey: keys.admin.connections, queryFn: () => api.admin.listRecentConnections(), refetchInterval: 5000, enabled: tab === 'connections' });
  const review = useMutation({
    mutationFn: (id: string) => api.admin.reviewParticipantActivity(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.admin.monitor });
      void qc.invalidateQueries({ queryKey: keys.admin.participants });
    },
  });

  const m = monitor.data;
  const people = [...new Map((m?.signals ?? []).map((s) => [s.participant.id, s.participant])).values()].sort((a, b) => a.name.localeCompare(b.name));
  const signals = (m?.signals ?? []).filter((s) => (showReviewed || !s.reviewed) && (severity === 'all' || s.severity === severity) && (who === 'all' || s.participant.id === who));

  return (
    <>
      <h1 className="h3 mb-3">Token monitor</h1>
      <p className="text-body-secondary">
        Where each token has been used from, and what is worth a look. Signals are worked out from the connection history of the last 30 days. Marking a participant reviewed hides what has been raised so far; anything new shows up again.
      </p>
      <ErrorAlert error={monitor.error ?? review.error} />
      {m?.proxyWarning && (
        <Alert variant="warning" data-testid="proxy-warning">
          <i className="bi bi-exclamation-triangle-fill me-2" aria-hidden="true" />
          {m.proxyWarning}
        </Alert>
      )}
      {monitor.isLoading && <Loading />}
      {m && (
        <Row className="g-3 mb-4">
          <Col xs={6} md={3}>
            <Stat label="Need attention" value={m.summary.needsAttention} tone={m.summary.needsAttention > 0 ? 'danger' : undefined} testId="stat-attention" />
          </Col>
          <Col xs={6} md={3}>
            <Stat label="Notices" value={m.summary.notices} tone={m.summary.notices > 0 ? 'warning' : undefined} testId="stat-notices" />
          </Col>
          <Col xs={6} md={3}>
            <Stat label="Information" value={m.summary.infos} testId="stat-infos" />
          </Col>
          <Col xs={6} md={3}>
            <Stat label="Active in the last 24 h" value={`${m.summary.activeLast24h} of ${m.summary.participants}`} testId="stat-active" />
          </Col>
        </Row>
      )}

      <Nav variant="tabs" className="mb-3" role="tablist">
        <Nav.Item>
          <Nav.Link as="button" role="tab" aria-selected={tab === 'signals'} active={tab === 'signals'} onClick={() => setTab('signals')}>
            Signals
          </Nav.Link>
        </Nav.Item>
        <Nav.Item>
          <Nav.Link as="button" role="tab" aria-selected={tab === 'connections'} active={tab === 'connections'} onClick={() => setTab('connections')}>
            All connections
          </Nav.Link>
        </Nav.Item>
      </Nav>

      {tab === 'signals' && m && (
        <>
          <div className="d-flex flex-wrap gap-3 align-items-center mb-3">
            <Form.Select size="sm" style={{ width: 'auto' }} aria-label="Filter by severity" value={severity} onChange={(e) => setSeverity(e.target.value as typeof severity)}>
              <option value="all">All severities</option>
              <option value="high">High</option>
              <option value="notice">Notice</option>
              <option value="info">Info</option>
            </Form.Select>
            <Form.Select size="sm" style={{ width: 'auto' }} aria-label="Filter by participant" value={who} onChange={(e) => setWho(e.target.value)}>
              <option value="all">All participants</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Form.Select>
            <Form.Check type="checkbox" id="show-reviewed" label="Show reviewed" checked={showReviewed} onChange={(e) => setShowReviewed(e.target.checked)} />
          </div>
          <Table responsive className="align-middle" data-testid="signal-table">
            <thead>
              <tr>
                <th scope="col">Severity</th>
                <th scope="col">Participant</th>
                <th scope="col">What happened</th>
                <th scope="col">When</th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {signals.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-body-secondary py-4 text-center" data-testid="no-signals">
                    {m.signals.length === 0 ? 'Nothing to report.' : 'No unreviewed signals.'}
                  </td>
                </tr>
              )}
              {signals.map((s) => (
                <tr key={s.id} className={s.reviewed ? 'text-body-secondary' : undefined} data-testid="signal-row" data-kind={s.kind} data-participant={s.participant.name}>
                  <td>
                    <SeverityBadge severity={s.severity} />
                  </td>
                  <td>{s.participant.name}</td>
                  <td>
                    {s.message}
                    {s.reviewed && <span className="ms-2 badge text-bg-light">reviewed</span>}
                  </td>
                  <td className="small text-nowrap" title={formatDateTime(s.at)}>
                    {timeAgo(s.at)}
                  </td>
                  <td className="text-end text-nowrap">
                    <Button size="sm" variant="outline-secondary" className="me-2" onClick={() => setInspecting(s.participant)} aria-label={`Investigate ${s.participant.name}`}>
                      Investigate
                    </Button>
                    {!s.reviewed && (
                      <Button size="sm" variant="outline-light" disabled={review.isPending} onClick={() => review.mutate(s.participant.id)} aria-label={`Mark ${s.participant.name} reviewed`}>
                        Reviewed
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </>
      )}

      {tab === 'connections' && (
        <>
          <ErrorAlert error={connections.error} />
          {connections.isLoading && <Loading />}
          <Table size="sm" responsive data-testid="all-connections">
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Participant</th>
                <th scope="col">Address</th>
                <th scope="col">Mode</th>
                <th scope="col">Program</th>
                <th scope="col">Lobby</th>
                <th scope="col">Duration</th>
              </tr>
            </thead>
            <tbody>
              {connections.data?.map((c) => (
                <tr key={c.id} className={c.flaggedBy.length > 0 ? 'row-flagged' : undefined}>
                  <td className="small text-nowrap">{formatDateTime(c.at)}</td>
                  <td>
                    <Button variant="link" size="sm" className="p-0" onClick={() => setInspecting(c.participant)}>
                      {c.participant.name}
                    </Button>
                  </td>
                  <td className="mono">{c.ip}</td>
                  <td>
                    <ModeBadge secure={c.secure} />
                  </td>
                  <td className="small">{c.program ? `${c.program.name} ${c.program.version}` : '—'}</td>
                  <td className="mono small">{c.lobbyId}</td>
                  <td className="small">{c.endedAt === null ? 'open' : formatDuration(c.endedAt - c.at)}</td>
                </tr>
              ))}
              {connections.data?.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-body-secondary">
                    No program has connected yet.
                  </td>
                </tr>
              )}
            </tbody>
          </Table>
        </>
      )}

      {inspecting && <ActivityModal participant={inspecting} onHide={() => setInspecting(null)} />}
    </>
  );
}

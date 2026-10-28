import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, Card, Form } from 'react-bootstrap';
import { Link } from 'react-router-dom';
import { useApi } from '../../api/context';
import type { LobbySummary, Seat } from '../../api/types';
import { CopyButton } from '../../components/CopyButton';
import { ErrorAlert, Loading } from '../../components/ErrorAlert';
import { FrameLog } from '../../components/FrameLog';
import { keys } from '../../hooks/queries';

export function ConnectionTab({ lobby }: { lobby: LobbySummary }) {
  const api = useApi();
  const readable = lobby.seats.filter((s) => s.owner.kind === 'participant' && (lobby.mySeats.includes(s.seat) || lobby.mySeats.length === 0));
  const [seat, setSeat] = useState<Seat>((readable[0]?.seat ?? 1) as Seat);
  const frames = useQuery({
    queryKey: keys.frames(lobby.id, seat),
    queryFn: () => api.getFrameLog(lobby.id, seat),
    enabled: readable.length > 0,
    refetchInterval: lobby.status === 'running' ? 1500 : 4000,
  });
  const myToken = useQuery({ queryKey: keys.token, queryFn: () => api.getMyToken(), enabled: lobby.mySeats.length > 0 });
  const url = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/program/v1`;
  const envLines = `BSC_URL=${url}\nBSC_LOBBY=${lobby.id}\nBSC_RULESET=${lobby.rulesetId}\nBSC_TOKEN=<your token, from the Account page>`;

  return (
    <>
      <Card className="mb-4">
        <Card.Body>
          <Card.Title as="h2" className="h6">
            Connect a program to this lobby
          </Card.Title>
          <p className="small mb-2">
            Your program connects to <code>{url}</code> and sends <code>hello</code> with your{' '}
            <Link to="/account">account token</Link>, this lobby id and <code>accepts: ["{lobby.rulesetId}"]</code>. It takes the first free seat that belongs to you.
            See the <Link to="/docs/getting-started">docs</Link> and the <Link to="/docs/examples">examples</Link>.
          </p>
          <pre className="mono small bg-body border rounded p-2 mb-2" data-testid="connect-env">
            {envLines}
          </pre>
          <CopyButton text={envLines} label="Copy settings" />
          {myToken.data && !myToken.data.exists && (
            <Alert variant="warning" className="mt-3 mb-0 py-2" data-testid="no-token-hint">
              You don't have a token yet, and programs cannot connect without one. <Link to="/account">Create your token</Link> first.
            </Alert>
          )}
          {myToken.data?.exists && (
            <p className="small text-body-secondary mt-2 mb-0">
              Your token was shown once, when you created it. If you no longer have it, <Link to="/account">replace it on the Account page</Link>.
            </p>
          )}
        </Card.Body>
      </Card>

      <h2 className="h6">Frames exchanged with your program</h2>
      {readable.length === 0 ? (
        <Alert variant="secondary">This lobby has no participant programs (only a practice bot).</Alert>
      ) : (
        <>
          {readable.length > 1 && (
            <Form.Select size="sm" style={{ maxWidth: 320 }} className="mb-2" value={seat} aria-label="Program" onChange={(e) => setSeat(Number(e.target.value) as Seat)}>
              {readable.map((s) => (
                <option key={s.seat} value={s.seat}>
                  Seat {s.seat}: {s.owner.name}
                  {s.program ? ` (${s.program.name} ${s.program.version})` : ''}
                </option>
              ))}
            </Form.Select>
          )}
          <ErrorAlert error={frames.error} />
          {frames.isLoading ? <Loading /> : <FrameLog frames={frames.data ?? []} />}
        </>
      )}
    </>
  );
}

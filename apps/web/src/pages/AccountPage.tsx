import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, Button, Card } from 'react-bootstrap';
import { useApi } from '../api/context';
import { ConfirmModal } from '../components/ConfirmModal';
import { CopyButton } from '../components/CopyButton';
import { ErrorAlert, Loading } from '../components/ErrorAlert';
import { keys, useSession } from '../hooks/queries';
import { formatDateTime } from '../lib/format';

/**
 * Three states: no token yet (every new participant), a token exists, and "just created or
 * replaced" (the only moment the full token is visible).
 */
export function AccountPage() {
  const api = useApi();
  const qc = useQueryClient();
  const { data: session } = useSession();
  const [confirming, setConfirming] = useState(false);
  const [fresh, setFresh] = useState<{ value: string; replaced: boolean } | null>(null);
  const token = useQuery({ queryKey: keys.token, queryFn: () => api.getMyToken(), enabled: session?.role === 'participant' });

  const afterChange = (value: string, replaced: boolean) => {
    setFresh({ value, replaced });
    setConfirming(false);
    void qc.invalidateQueries({ queryKey: keys.token });
    void qc.invalidateQueries({ queryKey: keys.lobbies });
  };
  const create = useMutation({ mutationFn: () => api.createToken(), onSuccess: ({ token: t }) => afterChange(t, false) });
  const replace = useMutation({
    mutationFn: () => api.replaceToken(),
    onSuccess: ({ token: t }) => afterChange(t, true),
    onError: () => setConfirming(false),
  });
  const acknowledge = useMutation({
    mutationFn: () => api.acknowledgeTokenNotice(),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.token }),
  });

  if (session?.role === 'admin') return <Alert variant="info">Tokens belong to participants.</Alert>;
  if (token.isLoading) return <Loading />;
  const data = token.data;

  return (
    <div style={{ maxWidth: 720 }}>
      <h1 className="h3 mb-3">Program token</h1>
      <p>
        Your token proves to the platform that a program is yours. All your programs use the same one, together with the id of the lobby each should join.
      </p>
      <ErrorAlert error={token.error ?? create.error ?? replace.error} />

      {data?.notice && (
        <Alert variant="warning" data-testid="token-notice" dismissible onClose={() => acknowledge.mutate()}>
          <strong>Your token was replaced</strong> at {formatDateTime(data.notice.at)} from another session. Your running programs were disconnected. If that was not you, tell the admin.
        </Alert>
      )}

      {fresh && (
        <Card border="success" className="mb-3" data-testid="new-token">
          <Card.Body>
            <p className="mb-2">
              <i className="bi bi-check-circle-fill text-success me-1" aria-hidden="true" />
              <strong>{fresh.replaced ? 'Your new token.' : 'Your token is ready.'}</strong> Copy it now and put it where your programs can read it. The platform keeps only a fingerprint of it, so this is the only time the full token is shown.
            </p>
            <pre className="mono bg-body border rounded p-2 mb-2 text-break" style={{ whiteSpace: 'pre-wrap' }}>
              {fresh.value}
            </pre>
            <div className="d-flex gap-2">
              <CopyButton text={fresh.value} label="Copy token" />
              <Button size="sm" variant="outline-secondary" onClick={() => setFresh(null)}>
                I have saved it
              </Button>
            </div>
          </Card.Body>
        </Card>
      )}

      {data && !data.exists && !fresh && (
        <Card className="mb-3" data-testid="no-token">
          <Card.Body>
            <h2 className="h5">You don't have a token yet</h2>
            <p className="mb-3">
              Nothing was created for you in advance. When you create your token it is shown once: copy it into your program's settings. Programs cannot connect to a lobby until you have one.
            </p>
            <Button variant="success" onClick={() => create.mutate()} disabled={create.isPending}>
              <i className="bi bi-key me-1" aria-hidden="true" />
              Create my token
            </Button>
          </Card.Body>
        </Card>
      )}

      {data?.exists && !fresh && (
        <>
          <Card className="mb-3" data-testid="token-card">
            <Card.Body>
              <div className="small-label mb-1">Your token</div>
              <div className="mono fs-5" data-testid="token-preview" title="Only the last four characters are kept visible, to tell tokens apart">
                {data.preview}
              </div>
              <div className="small text-body-secondary mt-1">
                {data.replaced ? 'Replaced' : 'Created'} {data.createdAt ? formatDateTime(data.createdAt) : ''}. The full token was shown once, at that moment.
              </div>
            </Card.Body>
          </Card>
          <h2 className="h6">Lost it, or think someone saw it?</h2>
          <p className="small">
            Replace it with a new one. The old token stops working immediately, and <strong>every program using it is disconnected</strong>, in all your lobbies. A game in progress then follows the usual disconnect rules.
          </p>
          <Button variant="outline-warning" onClick={() => setConfirming(true)}>
            <i className="bi bi-arrow-repeat me-1" aria-hidden="true" />
            Replace token…
          </Button>
        </>
      )}

      <ConfirmModal
        show={confirming}
        title="Replace your token?"
        confirmLabel="Replace token"
        variant="warning"
        busy={replace.isPending}
        onCancel={() => setConfirming(false)}
        onConfirm={() => replace.mutate()}
      >
        The old token stops working immediately and your connected programs are disconnected. You will need to give the new token to your programs.
      </ConfirmModal>
    </div>
  );
}

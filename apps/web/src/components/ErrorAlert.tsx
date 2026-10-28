import { Alert } from 'react-bootstrap';
import { ApiError } from '../api/types';

export function ErrorAlert({ error, onClose }: { error: unknown; onClose?: () => void }) {
  if (!error) return null;
  const message = error instanceof ApiError || error instanceof Error ? error.message : String(error);
  return (
    <Alert variant="danger" dismissible={!!onClose} onClose={onClose} role="alert" data-testid="error-alert">
      {message}
    </Alert>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="text-body-secondary py-4" role="status">
      <span className="spinner-border spinner-border-sm me-2" aria-hidden="true" />
      {label}
    </div>
  );
}

import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, Button, Card, Container, Form } from 'react-bootstrap';
import { useForm } from 'react-hook-form';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { useApi } from '../api/context';
import { ApiError, type ParticipantRef } from '../api/types';
import { ErrorAlert } from '../components/ErrorAlert';
import { keys, useSession } from '../hooks/queries';
import { useMockControls } from '../mock/controls';

const passwordSchema = z.object({ password: z.string().min(1, 'Enter the shared password.') });
const nameSchema = z.object({ participantId: z.string().min(1, 'Pick your name.') });
const adminSchema = z.object({
  username: z.string().min(1, 'Enter the admin username.'),
  password: z.string().min(1, 'Enter the password.'),
});

function Frame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Container style={{ maxWidth: 440 }} className="py-5">
      <h1 className="h3 text-center mb-4">
        <i className="bi bi-grid-3x3-gap-fill me-2" aria-hidden="true" />
        Battleships Championship
      </h1>
      <Card>
        <Card.Body>
          <Card.Title as="h2" className="h5 mb-3">
            {title}
          </Card.Title>
          {children}
        </Card.Body>
      </Card>
      <p className="text-center small mt-3">
        <Link to="/docs">Read the documentation</Link>
      </p>
    </Container>
  );
}

export function LoginPage() {
  const api = useApi();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const mock = useMockControls();
  const { data: session } = useSession();
  const [participants, setParticipants] = useState<ParticipantRef[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const passwordForm = useForm({ resolver: zodResolver(passwordSchema), defaultValues: { password: '' } });
  const nameForm = useForm({ resolver: zodResolver(nameSchema), defaultValues: { participantId: '' } });
  const from = (location.state as { from?: string } | null)?.from ?? '/lobbies';

  if (session) return <Navigate to={session.role === 'admin' ? '/lobbies' : from} replace />;

  return (
    <Frame title={participants ? 'Who are you?' : 'Enter the shared password'}>
      <ErrorAlert error={error} />
      {!participants ? (
        <Form
          noValidate
          onSubmit={passwordForm.handleSubmit(async ({ password }) => {
            setBusy(true);
            setError(null);
            try {
              setParticipants(await api.verifySharedPassword(password));
            } catch (e) {
              setError(e);
              if (e instanceof ApiError && e.code === 'invalid_credentials') passwordForm.resetField('password');
            } finally {
              setBusy(false);
            }
          })}
        >
          <Form.Group className="mb-3" controlId="shared-password">
            <Form.Label>Shared password</Form.Label>
            <Form.Control type="password" autoComplete="off" autoFocus isInvalid={!!passwordForm.formState.errors.password} {...passwordForm.register('password')} />
            <Form.Control.Feedback type="invalid">{passwordForm.formState.errors.password?.message}</Form.Control.Feedback>
          </Form.Group>
          <Button type="submit" disabled={busy} className="w-100">
            Continue
          </Button>
        </Form>
      ) : (
        <Form
          noValidate
          onSubmit={nameForm.handleSubmit(async ({ participantId }) => {
            setBusy(true);
            setError(null);
            try {
              const next = await api.loginParticipant(participantId);
              qc.setQueryData(keys.session, next);
              navigate(from, { replace: true });
            } catch (e) {
              setError(e);
            } finally {
              setBusy(false);
            }
          })}
        >
          <Form.Group className="mb-3" controlId="participant">
            <Form.Label>Your name</Form.Label>
            <Form.Select isInvalid={!!nameForm.formState.errors.participantId} {...nameForm.register('participantId')}>
              <option value="">Select your name…</option>
              {participants.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Form.Select>
            <Form.Control.Feedback type="invalid">{nameForm.formState.errors.participantId?.message}</Form.Control.Feedback>
          </Form.Group>
          <Button type="submit" disabled={busy} className="w-100">
            Enter
          </Button>
        </Form>
      )}
      <div className="mt-3 small text-body-secondary d-flex justify-content-between">
        <Link to="/admin/login">Admin login</Link>
        {mock && <span>Mock password: <code>{mock.sharedPassword()}</code></span>}
      </div>
    </Frame>
  );
}

export function AdminLoginPage() {
  const api = useApi();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const mock = useMockControls();
  const { data: session } = useSession();
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const form = useForm({ resolver: zodResolver(adminSchema), defaultValues: { username: '', password: '' } });
  if (session?.role === 'admin') return <Navigate to="/admin/participants" replace />;
  return (
    <Frame title="Admin login">
      <ErrorAlert error={error} />
      {session?.role === 'participant' && <Alert variant="info">You are logged in as {session.name}. Logging in as admin replaces that session.</Alert>}
      <Form
        noValidate
        onSubmit={form.handleSubmit(async ({ username, password }) => {
          setBusy(true);
          setError(null);
          try {
            const next = await api.loginAdmin(username, password);
            qc.setQueryData(keys.session, next);
            navigate('/admin/participants', { replace: true });
          } catch (e) {
            setError(e);
          } finally {
            setBusy(false);
          }
        })}
      >
        <Form.Group className="mb-3" controlId="admin-username">
          <Form.Label>Username</Form.Label>
          <Form.Control autoComplete="username" isInvalid={!!form.formState.errors.username} {...form.register('username')} />
          <Form.Control.Feedback type="invalid">{form.formState.errors.username?.message}</Form.Control.Feedback>
        </Form.Group>
        <Form.Group className="mb-3" controlId="admin-password">
          <Form.Label>Password</Form.Label>
          <Form.Control type="password" autoComplete="current-password" isInvalid={!!form.formState.errors.password} {...form.register('password')} />
          <Form.Control.Feedback type="invalid">{form.formState.errors.password?.message}</Form.Control.Feedback>
        </Form.Group>
        <Button type="submit" disabled={busy} className="w-100">
          Log in
        </Button>
      </Form>
      <div className="mt-3 small text-body-secondary d-flex justify-content-between">
        <Link to="/login">Participant login</Link>
        {mock && <span>Mock: <code>{mock.adminLogin().username}</code> / <code>{mock.adminLogin().password}</code></span>}
      </div>
    </Frame>
  );
}

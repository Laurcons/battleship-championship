import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Badge, Button, Dropdown, Form, InputGroup, Modal, Table } from 'react-bootstrap';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { useApi } from '../../api/context';
import type { AdminParticipant } from '../../api/types';
import { ActivityModal } from '../../components/ActivityModal';
import { describeUnreviewed, ModeBadge, unreviewedCount, worstUnreviewed } from '../../components/ActivityBits';
import { ConfirmModal } from '../../components/ConfirmModal';
import { ErrorAlert, Loading } from '../../components/ErrorAlert';
import { ResetTokenDialog } from '../../components/ResetTokenDialog';
import { keys, useSession } from '../../hooks/queries';
import { formatDateTime, timeAgo } from '../../lib/format';
import { AdminOnly } from './AdminOnly';

const nameSchema = z.object({ name: z.string().trim().min(1, 'Enter a name.').max(24, 'At most 24 characters.') });

export function AdminParticipantsPage() {
  const { data: session } = useSession();
  if (session?.role !== 'admin') return <AdminOnly />;
  return <ParticipantsAdmin />;
}

function ParticipantsAdmin() {
  const api = useApi();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: keys.admin.participants, queryFn: () => api.admin.listParticipants() });
  const [renaming, setRenaming] = useState<AdminParticipant | null>(null);
  const [deleting, setDeleting] = useState<AdminParticipant | null>(null);
  const [resetting, setResetting] = useState<AdminParticipant | null>(null);
  const [inspecting, setInspecting] = useState<AdminParticipant | null>(null);
  const [resetError, setResetError] = useState<unknown>(null);
  // The lobbies that go with a deleted participant, so the dialog can say whose results are lost.
  const allLobbies = useQuery({ queryKey: keys.admin.lobbies, queryFn: () => api.admin.listAllLobbies(), enabled: !!deleting });
  const doomed = deleting ? (allLobbies.data ?? []).filter((l) => l.seats.some((s) => s.owner.kind === 'participant' && s.owner.participantId === deleting.id)) : [];
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: keys.admin.participants });
    void qc.invalidateQueries({ queryKey: keys.participants });
  };
  const create = useMutation({ mutationFn: (name: string) => api.admin.createParticipant(name), onSuccess: refresh });
  const rename = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => api.admin.renameParticipant(id, name),
    onSuccess: () => {
      setRenaming(null);
      refresh();
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.admin.deleteParticipant(id),
    onSuccess: () => {
      setDeleting(null);
      refresh();
      void qc.invalidateQueries({ queryKey: keys.admin.lobbies });
      void qc.invalidateQueries({ queryKey: keys.lobbies });
    },
    // close the dialog so the error is visible on the page
    onError: () => setDeleting(null),
  });
  const setInsecure = useMutation({
    mutationFn: ({ id, allowed }: { id: string; allowed: boolean }) => api.admin.setParticipantInsecure(id, allowed),
    onSuccess: refresh,
  });
  const addForm = useForm({ resolver: zodResolver(nameSchema), defaultValues: { name: '' } });
  const renameForm = useForm({ resolver: zodResolver(nameSchema), values: { name: renaming?.name ?? '' } });

  return (
    <>
      <h1 className="h3 mb-3">Participants</h1>
      <p className="text-body-secondary">These names appear in the login dropdown once the shared password has been entered.</p>
      <p className="text-body-secondary">
        Programs must connect over <code>wss://</code> (TLS). Switch on <em>Allow ws://</em> for a participant whose program cannot do TLS: their token then travels unencrypted, so use it on a trusted network only.
        Switching it off disconnects that participant&apos;s plain connections.
      </p>
      <ErrorAlert error={list.error ?? create.error ?? remove.error ?? resetError ?? setInsecure.error} />
      <Form
        noValidate
        className="mb-4"
        style={{ maxWidth: 420 }}
        onSubmit={addForm.handleSubmit((v) => {
          remove.reset();
          create.mutate(v.name, { onSuccess: () => addForm.reset() });
        })}
      >
        <Form.Label htmlFor="new-participant">Add a participant</Form.Label>
        <InputGroup hasValidation>
          <Form.Control id="new-participant" placeholder="Name" isInvalid={!!addForm.formState.errors.name} {...addForm.register('name')} />
          <Button type="submit" disabled={create.isPending}>
            Add
          </Button>
          <Form.Control.Feedback type="invalid">{addForm.formState.errors.name?.message}</Form.Control.Feedback>
        </InputGroup>
      </Form>
      {list.isLoading && <Loading />}
      {list.data && (
        <Table responsive className="align-middle" data-testid="participants-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Lobbies</th>
              <th>Created</th>
              <th>Token</th>
              <th>Last connection</th>
              <th>Allow ws://</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.data.map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td>{p.lobbyCount}</td>
                <td className="small">{formatDateTime(p.createdAt)}</td>
                <td className="small">{p.tokenCreatedAt ? `Created ${formatDateTime(p.tokenCreatedAt)}` : <span className="text-body-secondary">Not created yet</span>}</td>
                <td className="small" data-testid="last-connection">
                  {p.activity.lastConnection ? (
                    <>
                      {timeAgo(p.activity.lastConnection.at)} · <span className="mono">{p.activity.lastConnection.ip}</span> <ModeBadge secure={p.activity.lastConnection.secure} />
                    </>
                  ) : (
                    <span className="text-body-secondary">Never</span>
                  )}
                  {worstUnreviewed(p.activity.unreviewed) && (
                    <Button
                      variant="link"
                      size="sm"
                      className="p-0 ms-2 align-baseline text-decoration-none"
                      onClick={() => setInspecting(p)}
                      aria-label={`Open activity of ${p.name}: ${describeUnreviewed(p.activity.unreviewed)}`}
                      data-testid={`signal-badge-${p.name}`}
                    >
                      <Badge bg={worstUnreviewed(p.activity.unreviewed) === 'high' ? 'danger' : worstUnreviewed(p.activity.unreviewed) === 'notice' ? 'warning' : 'secondary'} text={worstUnreviewed(p.activity.unreviewed) === 'notice' ? 'dark' : undefined}>
                        <i className="bi bi-flag-fill me-1" aria-hidden="true" />
                        {unreviewedCount(p.activity.unreviewed)}
                      </Badge>
                    </Button>
                  )}
                </td>
                <td>
                  <Form.Check
                    type="switch"
                    id={`insecure-${p.id}`}
                    aria-label={`Allow ws:// for ${p.name}`}
                    checked={p.allowInsecure}
                    disabled={setInsecure.isPending}
                    onChange={(e) => {
                      create.reset();
                      remove.reset();
                      setInsecure.mutate({ id: p.id, allowed: e.target.checked });
                    }}
                  />
                </td>
                <td className="text-end">
                  <Dropdown align="end">
                    <Dropdown.Toggle variant="outline-secondary" size="sm" className="no-caret position-relative" aria-label={`Actions for ${p.name}`}>
                      <i className="bi bi-three-dots" aria-hidden="true" />
                      {worstUnreviewed(p.activity.unreviewed) && (
                        <span className={`position-absolute top-0 start-100 translate-middle p-1 border border-light rounded-circle bg-${worstUnreviewed(p.activity.unreviewed) === 'high' ? 'danger' : 'warning'}`} data-testid="signal-dot">
                          <span className="visually-hidden">unreviewed signals</span>
                        </span>
                      )}
                    </Dropdown.Toggle>
                    <Dropdown.Menu role="menu" popperConfig={{ strategy: 'fixed' }}>
                      <Dropdown.Item as="button" role="menuitem" onClick={() => setInspecting(p)}>
                        Activity…
                      </Dropdown.Item>
                      <Dropdown.Item as="button" role="menuitem" onClick={() => setRenaming(p)}>
                        Rename…
                      </Dropdown.Item>
                      <Dropdown.Item as="button" role="menuitem" disabled={!p.tokenCreatedAt} onClick={() => setResetting(p)}>
                        Reset token…
                      </Dropdown.Item>
                      <Dropdown.Divider />
                      <Dropdown.Item as="button" role="menuitem" className="text-danger" onClick={() => setDeleting(p)}>
                        Delete…
                      </Dropdown.Item>
                    </Dropdown.Menu>
                  </Dropdown>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <Modal show={!!renaming} onHide={() => setRenaming(null)} centered>
        <Form noValidate onSubmit={renameForm.handleSubmit((v) => renaming && rename.mutate({ id: renaming.id, name: v.name }))}>
          <Modal.Header closeButton>
            <Modal.Title>Rename {renaming?.name}</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <ErrorAlert error={rename.error} />
            <Form.Group controlId="rename-name">
              <Form.Label>New name</Form.Label>
              <Form.Control isInvalid={!!renameForm.formState.errors.name} {...renameForm.register('name')} />
              <Form.Control.Feedback type="invalid">{renameForm.formState.errors.name?.message}</Form.Control.Feedback>
            </Form.Group>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setRenaming(null)}>
              Cancel
            </Button>
            <Button type="submit" disabled={rename.isPending}>
              Save
            </Button>
          </Modal.Footer>
        </Form>
      </Modal>
      <ConfirmModal
        show={!!deleting}
        title={`Delete ${deleting?.name}?`}
        confirmLabel="Delete participant"
        busy={remove.isPending}
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (!deleting) return;
          create.reset();
          remove.mutate(deleting.id);
        }}
      >
        {doomed.length === 0 ? (
          <p className="mb-0">{allLobbies.isLoading ? 'Checking their lobbies…' : `${deleting?.name} is not part of any lobby.`}</p>
        ) : (
          <>
            <p>
              This also deletes <strong data-testid="doomed-count">{doomed.length}</strong> lobb{doomed.length === 1 ? 'y' : 'ies'} with their games and results, including lobbies created by other participants:
            </p>
            <ul className="mb-0" data-testid="doomed-lobbies">
              {doomed.map((l) => (
                <li key={l.id}>
                  <span className="mono">{l.id}</span>: {l.seats[0].owner.name} vs {l.seats[1].owner.name}
                  {l.createdBy.id !== deleting?.id && <span className="text-body-secondary"> (created by {l.createdBy.name})</span>}
                </li>
              ))}
            </ul>
          </>
        )}
      </ConfirmModal>
      <ResetTokenDialog participant={resetting} onClose={() => setResetting(null)} onError={setResetError} />
      {inspecting && <ActivityModal participant={inspecting} onHide={() => setInspecting(null)} />}
    </>
  );
}

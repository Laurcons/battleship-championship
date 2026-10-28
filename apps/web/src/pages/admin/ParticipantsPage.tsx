import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button, Form, InputGroup, Modal, Table } from 'react-bootstrap';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { useApi } from '../../api/context';
import type { AdminParticipant } from '../../api/types';
import { ConfirmModal } from '../../components/ConfirmModal';
import { ErrorAlert, Loading } from '../../components/ErrorAlert';
import { keys, useSession } from '../../hooks/queries';
import { formatDateTime } from '../../lib/format';
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
    },
    // close the dialog so the error is visible on the page
    onError: () => setDeleting(null),
  });
  const addForm = useForm({ resolver: zodResolver(nameSchema), defaultValues: { name: '' } });
  const renameForm = useForm({ resolver: zodResolver(nameSchema), values: { name: renaming?.name ?? '' } });

  return (
    <>
      <h1 className="h3 mb-3">Participants</h1>
      <p className="text-body-secondary">These names appear in the login dropdown once the shared password has been entered.</p>
      <ErrorAlert error={list.error ?? create.error ?? remove.error} />
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
                <td className="text-end">
                  <Button size="sm" variant="outline-secondary" className="me-2" onClick={() => setRenaming(p)} aria-label={`Rename ${p.name}`}>
                    Rename
                  </Button>
                  <Button size="sm" variant="outline-danger" onClick={() => setDeleting(p)} aria-label={`Delete ${p.name}`}>
                    Delete
                  </Button>
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
        A participant who is part of any lobby cannot be deleted: delete those lobbies first.
      </ConfirmModal>
    </>
  );
}

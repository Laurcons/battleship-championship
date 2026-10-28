import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CLASSIC_10X10, type Ruleset } from '@bsc/engine';
import { useState } from 'react';
import { Badge, Button, Form, Modal, Table } from 'react-bootstrap';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { useApi } from '../../api/context';
import type { RulesetInfo } from '../../api/types';
import { ErrorAlert, Loading } from '../../components/ErrorAlert';
import { keys, useSession } from '../../hooks/queries';
import { formatDateTime } from '../../lib/format';
import { AdminOnly } from './AdminOnly';

const formSchema = z.object({
  id: z.string().trim().min(1, 'Enter an id.'),
  description: z.string().trim().max(200, 'At most 200 characters.'),
  width: z.coerce.number<number>().int('Whole number.'),
  height: z.coerce.number<number>().int('Whole number.'),
  fleet: z
    .string()
    .trim()
    .regex(/^\d+(\s*,\s*\d+)*$/, 'Comma-separated ship lengths, e.g. 5,4,3,3,2.'),
  touching: z.boolean(),
  extraTurnOnHit: z.boolean(),
  announceSunk: z.boolean(),
  repeatShot: z.enum(['invalid', 'waste']),
  revealOnGameOver: z.boolean(),
});
type FormValues = z.infer<typeof formSchema>;

const toForm = (r: Ruleset): FormValues => ({ ...r, fleet: r.fleet.join(',') });
const toRuleset = (v: FormValues): Ruleset => ({
  ...v,
  fleet: v.fleet.split(',').map((n) => Number(n.trim())),
});

export function AdminRulesetsPage() {
  const { data: session } = useSession();
  if (session?.role !== 'admin') return <AdminOnly />;
  return <Rulesets />;
}

function Rulesets() {
  const api = useApi();
  const qc = useQueryClient();
  const list = useRulesets();
  const [editing, setEditing] = useState<{ source: Ruleset | null } | null>(null);
  const makeDefault = useMutation({
    mutationFn: (id: string) => api.admin.setDefaultRuleset(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.rulesets });
      void qc.invalidateQueries({ queryKey: keys.admin.audit });
    },
  });
  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => api.admin.setRulesetEnabled(id, enabled),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.rulesets }),
  });
  return (
    <>
      <div className="page-title mb-3">
        <h1 className="h3 m-0">Rulesets</h1>
        <Button className="ms-auto" onClick={() => setEditing({ source: null })}>
          <i className="bi bi-plus-lg me-1" aria-hidden="true" />
          New ruleset
        </Button>
      </div>
      <p className="text-body-secondary">
        A ruleset is a game mode. Rulesets cannot be edited once created: to change a rule, clone it into a new one. Disabling a ruleset only affects <strong>new</strong> lobbies. The <strong>default</strong> is preselected when someone creates a lobby; you choose it, and it must be enabled. At least one ruleset must stay enabled.
      </p>
      <ErrorAlert error={list.error ?? toggle.error ?? makeDefault.error} />
      {list.isLoading && <Loading />}
      <Table responsive className="align-middle" data-testid="rulesets-table">
        <thead>
          <tr>
            <th>Ruleset</th>
            <th>Board and fleet</th>
            <th>Rules</th>
            <th>Lobbies</th>
            <th>Enabled</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {list.data?.map((r) => (
            <tr key={r.ruleset.id} data-testid="ruleset-row">
              <td>
                <span className="mono fw-semibold">{r.ruleset.id}</span>
                {r.isDefault && <Badge bg="info" className="text-dark ms-2">default for new lobbies</Badge>}
                {!r.enabled && <Badge bg="secondary" className="ms-2">disabled</Badge>}
                <div className="small text-body-secondary">{r.ruleset.description}</div>
                <div className="small text-body-secondary">Created {formatDateTime(r.createdAt)}</div>
              </td>
              <td className="small">
                {r.ruleset.width}×{r.ruleset.height}
                <br />
                {r.ruleset.fleet.join('/')}
              </td>
              <td className="small">
                <RuleBadges r={r.ruleset} />
              </td>
              <td>{r.lobbyCount ?? 0}</td>
              <td>
                <Form.Check
                  type="switch"
                  id={`enabled-${r.ruleset.id}`}
                  aria-label={`${r.ruleset.id} enabled`}
                  checked={r.enabled}
                  disabled={toggle.isPending || r.isDefault}
                  title={r.isDefault ? 'This is the default ruleset. Make another one the default to disable it.' : undefined}
                  onChange={(e) => toggle.mutate({ id: r.ruleset.id, enabled: e.target.checked })}
                />
              </td>
              <td className="text-end text-nowrap">
                {!r.isDefault && r.enabled && (
                  <Button
                    size="sm"
                    variant="outline-info"
                    className="me-2"
                    disabled={makeDefault.isPending}
                    onClick={() => makeDefault.mutate(r.ruleset.id)}
                    aria-label={`Make ${r.ruleset.id} the default`}
                  >
                    Make default
                  </Button>
                )}
                <Button size="sm" variant="outline-secondary" onClick={() => setEditing({ source: r.ruleset })} aria-label={`Clone ${r.ruleset.id}`}>
                  Clone
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
      {editing && <RulesetModal source={editing.source} onClose={() => setEditing(null)} />}
    </>
  );
}

function useRulesets() {
  const api = useApi();
  return useQuery<RulesetInfo[]>({ queryKey: keys.rulesets, queryFn: () => api.listRulesets() });
}

function RuleBadges({ r }: { r: Ruleset }) {
  const b = (on: boolean, label: string) => (
    <Badge key={label} bg={on ? 'secondary' : 'dark'} className={`me-1 mb-1 ${on ? '' : 'text-body-secondary'}`}>
      {label}
    </Badge>
  );
  return (
    <>
      {b(r.touching, 'ships may touch')}
      {b(r.extraTurnOnHit, 'extra turn on hit')}
      {b(r.announceSunk, 'sunk announced')}
      {b(r.revealOnGameOver, 'layout revealed after game')}
      <Badge bg="secondary" className="me-1 mb-1">
        repeat shot: {r.repeatShot}
      </Badge>
    </>
  );
}

function RulesetModal({ source, onClose }: { source: Ruleset | null; onClose: () => void }) {
  const api = useApi();
  const qc = useQueryClient();
  const base = source ?? CLASSIC_10X10;
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: toForm(source ? { ...base, id: `${base.id}-2` } : { ...base, id: '', description: '' }),
  });
  const create = useMutation({
    mutationFn: (ruleset: Ruleset) => api.admin.createRuleset(ruleset),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.rulesets });
      void qc.invalidateQueries({ queryKey: keys.admin.audit });
      onClose();
    },
  });
  const errors = form.formState.errors;
  return (
    <Modal show onHide={onClose} centered size="lg">
      <Form noValidate onSubmit={form.handleSubmit((v) => create.mutate(toRuleset(v)))}>
        <Modal.Header closeButton>
          <Modal.Title>{source ? `Clone ${source.id}` : 'New ruleset'}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <ErrorAlert error={create.error} />
          <Form.Group className="mb-3" controlId="rs-id">
            <Form.Label>Id</Form.Label>
            <Form.Control placeholder="e.g. classic-10x10" isInvalid={!!errors.id} {...form.register('id')} />
            <Form.Control.Feedback type="invalid">{errors.id?.message}</Form.Control.Feedback>
            <Form.Text>A short description of the game mode; programs list it in <code>accepts</code>. Lowercase letters, digits and dashes.</Form.Text>
          </Form.Group>
          <Form.Group className="mb-3" controlId="rs-description">
            <Form.Label>Description</Form.Label>
            <Form.Control isInvalid={!!errors.description} {...form.register('description')} />
            <Form.Control.Feedback type="invalid">{errors.description?.message}</Form.Control.Feedback>
          </Form.Group>
          <div className="row">
            <Form.Group className="mb-3 col-sm-3" controlId="rs-width">
              <Form.Label>Width</Form.Label>
              <Form.Control type="number" isInvalid={!!errors.width} {...form.register('width')} />
              <Form.Control.Feedback type="invalid">{errors.width?.message}</Form.Control.Feedback>
            </Form.Group>
            <Form.Group className="mb-3 col-sm-3" controlId="rs-height">
              <Form.Label>Height</Form.Label>
              <Form.Control type="number" isInvalid={!!errors.height} {...form.register('height')} />
              <Form.Control.Feedback type="invalid">{errors.height?.message}</Form.Control.Feedback>
            </Form.Group>
            <Form.Group className="mb-3 col-sm-6" controlId="rs-fleet">
              <Form.Label>Fleet (ship lengths)</Form.Label>
              <Form.Control isInvalid={!!errors.fleet} {...form.register('fleet')} />
              <Form.Control.Feedback type="invalid">{errors.fleet?.message}</Form.Control.Feedback>
            </Form.Group>
          </div>
          <div className="row">
            <div className="col-sm-6">
              <Form.Check type="switch" id="rs-touching" label="Ships may touch" className="mb-2" {...form.register('touching')} />
              <Form.Check type="switch" id="rs-extra" label="Extra turn on hit" className="mb-2" {...form.register('extraTurnOnHit')} />
              <Form.Check type="switch" id="rs-sunk" label="Announce sunk ships (with length)" className="mb-2" {...form.register('announceSunk')} />
              <Form.Check type="switch" id="rs-reveal" label="Reveal opponent layout to programs after a game" className="mb-2" {...form.register('revealOnGameOver')} />
            </div>
            <Form.Group className="col-sm-6" controlId="rs-repeat">
              <Form.Label>Repeated shot</Form.Label>
              <Form.Select {...form.register('repeatShot')}>
                <option value="invalid">Invalid move (a strike)</option>
                <option value="waste">Wastes the turn</option>
              </Form.Select>
              <Form.Text>Either way the move is highlighted in the move history.</Form.Text>
            </Form.Group>
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={create.isPending}>
            Create ruleset
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
}

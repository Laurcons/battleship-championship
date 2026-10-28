import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, Form, InputGroup, Table } from 'react-bootstrap';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { useApi } from '../../api/context';
import { ErrorAlert, Loading } from '../../components/ErrorAlert';
import { keys, useSession } from '../../hooks/queries';
import { AdminOnly } from './AdminOnly';

export function AdminSettingsPage() {
  const { data: session } = useSession();
  if (session?.role !== 'admin') return <AdminOnly />;
  return <Settings />;
}

function Settings() {
  const api = useApi();
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: keys.admin.settings, queryFn: () => api.admin.getSettings() });
  const update = useMutation({
    mutationFn: (patch: { allowGodMode?: boolean; maxBatterySize?: number }) => api.admin.updateSettings(patch),
    onSuccess: (next) => {
      qc.setQueryData(keys.admin.settings, next);
      void qc.invalidateQueries({ queryKey: keys.platform });
      void qc.invalidateQueries({ queryKey: keys.admin.audit });
    },
  });
  const schema = z.object({ maxBatterySize: z.coerce.number<number>().int('Use a whole number.').min(1, 'At least 1.').max(10000, 'At most 10000.') });
  const form = useForm({ resolver: zodResolver(schema), values: { maxBatterySize: settings.data?.maxBatterySize ?? 1000 } });
  if (settings.isLoading || !settings.data) return <Loading />;
  const s = settings.data;
  return (
    <div style={{ maxWidth: 720 }}>
      <h1 className="h3 mb-3">Platform settings</h1>
      <ErrorAlert error={settings.error ?? update.error} />
      <Card className="mb-4">
        <Card.Body>
          <Form.Check
            type="switch"
            id="allow-god-mode"
            label="Allow participants to choose god mode"
            checked={s.allowGodMode}
            disabled={update.isPending}
            onChange={(e) => update.mutate({ allowGodMode: e.target.checked })}
          />
          <Form.Text className="d-block">
            When off, new lobbies between participants are always restricted and creators cannot choose god mode (lobbies against yourself or a practice bot are unaffected). Applies to new lobbies only.
          </Form.Text>
        </Card.Body>
      </Card>
      <Card className="mb-4">
        <Card.Body>
          <Form noValidate onSubmit={form.handleSubmit((v) => update.mutate({ maxBatterySize: v.maxBatterySize }))}>
            <Form.Label htmlFor="max-battery">Maximum battery size (games)</Form.Label>
            <InputGroup hasValidation style={{ maxWidth: 260 }}>
              <Form.Control id="max-battery" type="number" isInvalid={!!form.formState.errors.maxBatterySize} {...form.register('maxBatterySize')} />
              <Button type="submit" disabled={update.isPending}>
                Save
              </Button>
              <Form.Control.Feedback type="invalid">{form.formState.errors.maxBatterySize?.message}</Form.Control.Feedback>
            </InputGroup>
            {update.isSuccess && update.variables?.maxBatterySize !== undefined && (
              <Form.Text className="text-success" role="status">
                Saved.
              </Form.Text>
            )}
          </Form>
        </Card.Body>
      </Card>
      <h2 className="h5">Platform constants</h2>
      <Alert variant="secondary" className="small">
        These are set through environment variables when the platform is deployed and cannot be changed here.
      </Alert>
      <Table size="sm" data-testid="constants-table">
        <tbody>
          {s.constants.map((c) => (
            <tr key={c.label}>
              <th scope="row" className="fw-normal">
                {c.label}
              </th>
              <td className="mono">{c.value}</td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}

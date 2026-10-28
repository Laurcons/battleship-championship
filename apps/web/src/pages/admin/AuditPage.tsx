import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Form, Table } from 'react-bootstrap';
import { Link } from 'react-router-dom';
import { useApi } from '../../api/context';
import { ErrorAlert, Loading } from '../../components/ErrorAlert';
import { keys, useSession } from '../../hooks/queries';
import { formatDateTime } from '../../lib/format';
import { AdminOnly } from './AdminOnly';

export function AdminAuditPage() {
  const { data: session } = useSession();
  if (session?.role !== 'admin') return <AdminOnly />;
  return <Audit />;
}

function Audit() {
  const api = useApi();
  const [filter, setFilter] = useState('');
  const log = useQuery({ queryKey: keys.admin.audit, queryFn: () => api.admin.listAuditLog(), refetchInterval: 4000 });
  const entries = (log.data ?? []).filter((e) => !filter || `${e.actor} ${e.action} ${e.target ?? ''} ${e.detail ?? ''}`.toLowerCase().includes(filter.toLowerCase()));
  return (
    <>
      <h1 className="h3 mb-3">Audit log</h1>
      <Form.Control className="mb-3" style={{ maxWidth: 320 }} placeholder="Filter, e.g. token or Alice" aria-label="Filter audit log" value={filter} onChange={(e) => setFilter(e.target.value)} />
      <ErrorAlert error={log.error} />
      {log.isLoading && <Loading />}
      <Table size="sm" responsive data-testid="audit-table">
        <thead>
          <tr>
            <th>When</th>
            <th>Who</th>
            <th>Action</th>
            <th>Target</th>
            <th>Detail</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id}>
              <td className="small text-nowrap">{formatDateTime(e.at)}</td>
              <td>{e.actor}</td>
              <td className="mono small">{e.action}</td>
              <td>{e.target && /^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]$/.test(e.target) ? <Link to={`/lobbies/${e.target}`} className="mono">{e.target}</Link> : e.target}</td>
              <td className="small text-body-secondary">{e.detail}</td>
            </tr>
          ))}
        </tbody>
      </Table>
    </>
  );
}

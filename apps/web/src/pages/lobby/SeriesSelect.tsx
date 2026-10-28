import { Form } from 'react-bootstrap';
import type { SeriesInfo } from '../../api/types';
import { formatDateTime } from '../../lib/format';

export function SeriesSelect({
  seriesList,
  value,
  onChange,
}: {
  seriesList: SeriesInfo[];
  value: string | undefined;
  onChange: (id: string | undefined) => void;
}) {
  if (seriesList.length < 2) return null;
  const current = seriesList.at(-1)?.id;
  return (
    <Form.Group className="mb-3 d-flex align-items-center gap-2" controlId="series-select">
      <Form.Label className="m-0 small">Battery</Form.Label>
      <Form.Select size="sm" style={{ maxWidth: 340 }} value={value ?? current} onChange={(e) => onChange(e.target.value === current ? undefined : e.target.value)}>
        {[...seriesList].reverse().map((s) => (
          <option key={s.id} value={s.id}>
            {formatDateTime(s.startedAt)} · {s.played}/{s.target} games · {s.status}
            {s.id === current ? ' (latest)' : ''}
          </option>
        ))}
      </Form.Select>
    </Form.Group>
  );
}

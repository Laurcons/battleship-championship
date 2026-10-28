import { useMemo, useState } from 'react';
import { Form } from 'react-bootstrap';
import type { Frame } from '../api/types';
import { CopyButton } from './CopyButton';

const pad = (n: number, w = 2) => String(n).padStart(w, '0');
const stamp = (at: number) => {
  const d = new Date(at);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
};

function pretty(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

export function FrameLog({ frames }: { frames: Frame[] }) {
  const [filter, setFilter] = useState('');
  const [hideNotes, setHideNotes] = useState(false);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const shown = useMemo(
    () =>
      frames
        .map((f, i) => ({ f, i }))
        .filter(
          ({ f }) =>
            (!hideNotes || f.dir !== 'note') &&
            (!filter || f.text.toLowerCase().includes(filter.toLowerCase())),
        ),
    [frames, filter, hideNotes],
  );
  return (
    <div>
      <div className="d-flex flex-wrap gap-3 align-items-center mb-2">
        <Form.Control
          size="sm"
          style={{ maxWidth: 260 }}
          placeholder="Filter frames, e.g. fire or error"
          aria-label="Filter frames"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <Form.Check
          type="switch"
          id="hide-notes"
          label="Hide platform notes"
          checked={hideNotes}
          onChange={(e) => setHideNotes(e.target.checked)}
        />
        <span className="small text-body-secondary">
          {shown.length} of {frames.length} frames, newest first · the latest 2000 are kept for 7
          days
        </span>
        <span className="ms-auto">
          <CopyButton
            label="Copy log (oldest first)"
            text={shown.map(({ f }) => `${stamp(f.at)} ${f.dir} ${f.text}`).join('\n')}
          />
        </span>
      </div>
      <div
        className="frame-log"
        data-testid="frame-log"
        tabIndex={0}
        role="region"
        aria-label="Frame log"
      >
        {shown.length === 0 && (
          <div className="p-3 text-body-secondary">No frames recorded yet.</div>
        )}
        {shown
          .slice()
          .reverse()
          .map(({ f, i }) => (
            <div
              key={i}
              className={`frame-row frame-${f.dir}`}
              onClick={() =>
                setOpen((s) => new Set(s.has(i) ? [...s].filter((x) => x !== i) : [...s, i]))
              }
            >
              <span className="frame-time">{stamp(f.at)}</span>
              <span
                className="frame-dir"
                title={
                  f.dir === 'to_program'
                    ? 'platform to program'
                    : f.dir === 'from_program'
                      ? 'program to platform'
                      : 'platform note'
                }
              >
                {f.dir === 'to_program' ? '→' : f.dir === 'from_program' ? '←' : '·'}
              </span>
              <span className={f.dir === 'note' ? 'frame-note' : undefined}>
                {open.has(i) ? pretty(f.text) : f.text}
              </span>
            </div>
          ))}
      </div>
      <div className="small text-body-secondary mt-1">
        → platform to program · ← program to platform · click a line to pretty-print it
      </div>
    </div>
  );
}
